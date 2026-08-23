/**
 * 单路线生成管线（重构版）：
 * 分类 → 单一预设 → 缩放采样 → 自适应色板 → 量化 → 背景处理 → 裁剪 → 轻量清理。
 * 不做多候选评分，一次生成、结果可预期。
 */
import type { BeadPalette } from '../../types'
import { applyOutline, backgroundFromHex, bridgeLineGaps, buildBgMask, buildBorderBgMask, buildGrowBgMask, cropEmptyBorders, computeUsedCounts, emptyOuterBackground, fillSmallHoles, imageToGridColors, limitColorCount, mergePatternColors, quantizeImageAsync, removeSpeckles, selectAdaptivePalette } from '../quantize'
import { analyzeImage } from './image'
import type { CandidateConfig, GenerateBestPatternResult, GenerateCandidateResult, GenerateOptions, ImageType } from './types'

/** 图片类型 → 用户可读名称 */
export const IMAGE_TYPE_LABELS: Record<ImageType, string> = {
  'line-art': '线稿',
  'pixel-art': '像素画',
  'flat-art': '插画/卡通',
  photo: '照片',
}

function chooseAutoWidth(detail: number, ratio: number): number {
  const base = detail < 50 ? 56 : detail < 170 ? 80 : 100
  return Math.min(144, Math.max(base, Math.round(base / Math.max(0.5, ratio))))
}

function baseConfig(label: string): CandidateConfig {
  return {
    label,
    width: 0,
    detail: 2,
    enhance: true,
    saturate: 1.2,
    sharpen: false,
    contrast: 4,
    brightness: 0,
    protectDark: 0.84,
    maxColors: 24,
    removeBg: true,
    bgThreshold: 16,
    smartBg: true,
    borderTol: 28,
    denoise: true,
    outline: false,
    mode: 'nearest',
    autoCrop: true,
    onlyOwnedColors: false,
    weight: 1,
  }
}

/** 图片分类 → 默认参数。全部为「不过度处理」的稳妥值，用户显式传参时覆盖。 */
function presetFor(type: ImageType): CandidateConfig {
  switch (type) {
    case 'line-art':
      return {
        ...baseConfig('line-art'),
        saturate: 1.15,
        contrast: 6,
        protectDark: 1.0,
        maxColors: 10,
        bgThreshold: 14,
        borderTol: 20,
        denoise: true,
        mode: 'nearest',
      }
    case 'pixel-art':
      return {
        ...baseConfig('pixel-art'),
        detail: 1,
        saturate: 1.05,
        contrast: 3,
        protectDark: 0.6,
        maxColors: 16,
        bgThreshold: 16,
        borderTol: 22,
        denoise: true,
        mode: 'nearest',
      }
    case 'flat-art':
      return {
        ...baseConfig('flat-art'),
        saturate: 1.2,
        contrast: 4,
        protectDark: 0.8,
        maxColors: 24,
        bgThreshold: 16,
        borderTol: 26,
        denoise: true,
        mode: 'nearest',
      }
    case 'photo':
      return {
        ...baseConfig('photo'),
        saturate: 1.1,
        contrast: 5,
        protectDark: 0.75,
        maxColors: 36,
        bgThreshold: 18,
        borderTol: 30,
        denoise: true,
        mode: 'nearest',
      }
  }
}

function resolveNum(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && isFinite(v) ? v : fallback
}

function resolveBool(v: boolean | undefined, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** 把用户显式参数合并到图片类型预设上 */
function mergeUserConfig(preset: CandidateConfig, opts: GenerateOptions): CandidateConfig {
  return {
    ...preset,
    detail: resolveNum(opts.detail, preset.detail),
    enhance: resolveBool(opts.enhance, preset.enhance),
    saturate: resolveNum(opts.saturate, preset.saturate),
    sharpen: resolveBool(opts.sharpen, preset.sharpen),
    contrast: resolveNum(opts.contrast, preset.contrast),
    brightness: resolveNum(opts.brightness, preset.brightness),
    protectDark: opts.protectDark === false ? 0 : typeof opts.protectDark === 'number' ? opts.protectDark : preset.protectDark,
    maxColors: opts.userMaxColors !== undefined && opts.userMaxColors >= 0 ? opts.userMaxColors : preset.maxColors,
    mode: opts.mode ?? preset.mode,
    removeBg: resolveBool(opts.removeBg, preset.removeBg),
    bgThreshold: resolveNum(opts.bgThreshold, preset.bgThreshold),
    smartBg: resolveBool(opts.smartBg, preset.smartBg),
    borderTol: resolveNum(opts.borderTol, preset.borderTol),
    denoise: resolveBool(opts.denoise, preset.denoise),
    outline: resolveBool(opts.outline, preset.outline),
    autoCrop: resolveBool(opts.autoCrop, preset.autoCrop),
  }
}

function imageTypeFromAnalysis(analysis: { lineArt: boolean; pixelArt: boolean; detailScore: number }): ImageType {
  if (analysis.lineArt) return 'line-art'
  if (analysis.pixelArt) return 'pixel-art'
  if (analysis.detailScore < 120) return 'flat-art'
  return 'photo'
}

/**
 * 单次生成（核心）：给定图片 + 一份完整参数，输出一张图纸。
 * 返回的 previewPixels 是「裁剪前」网格的采样像素（供原色预览使用），
 * crop 记录裁剪偏移，宽度/高度为裁剪后的实际尺寸。
 */
export async function generateCandidate(
  opts: GenerateOptions,
  config: CandidateConfig,
  onProgress?: (p: number) => void,
  analysisOverride?: ReturnType<typeof analyzeImage>,
  strategyMeta?: { id: string; label: string; family: string; reason: string }
): Promise<GenerateCandidateResult> {
  const { image, palette, srcRect } = opts
  const analysis = analysisOverride ?? analyzeImage(image, srcRect)
  const requestedWidth = opts.userWidth && opts.userWidth > 0 ? opts.userWidth : 0
  const autoWidth = requestedWidth > 0 ? requestedWidth : config.width > 0 ? config.width : chooseAutoWidth(analysis.detailScore, analysis.contentRatio)
  const effectiveSrc = srcRect && srcRect.w > 0 && srcRect.h > 0 ? srcRect : null
  const sourceW = effectiveSrc ? effectiveSrc.w : image.naturalWidth
  const sourceH = effectiveSrc ? effectiveSrc.h : image.naturalHeight
  const height = Math.max(2, Math.round((autoWidth * sourceH) / sourceW))
  const lineArt = analysis.lineArt

  const pixels = imageToGridColors(image, autoWidth, height, config.detail, config.enhance ? config.saturate : 1, config.sharpen ? 0.8 : 0, config.contrast, srcRect, config.protectDark, config.brightness, lineArt)

  const bgHex = opts.bgColor || '#FFFFFF'
  const background = backgroundFromHex(bgHex, config.bgThreshold)
  const exclude = opts.exclude ?? null
  const targetMaxColors = config.maxColors
  let quantPalette = palette
  if (targetMaxColors > 0 && palette.colors.length > targetMaxColors) {
    const selected = selectAdaptivePalette(pixels, autoWidth, height, palette, targetMaxColors, background, exclude)
    quantPalette = { ...palette, colors: selected }
  }

  // 背景安全预检：泛洪覆盖率大本身不危险（线稿/白底 emoji 背景就是很大），
  // 危险的是「背景色与主体色太接近导致泛洪穿过主体」——
  // 用紧阈值（只算几乎等于背景色的格子）覆盖率对比：远小于泛洪覆盖率
  // 说明泛洪吃进了主体（如浅绿背景+绿兔子），此时跳过背景去除保住主体。
  let safeBg = true
  if (config.removeBg || config.smartBg) {
    const totalCells = autoWidth * height
    const coverageOf = (m: boolean[][]) => {
      let n = 0
      for (const row of m) for (const v of row) if (v) n++
      return n / totalCells
    }
    const growCov = config.removeBg ? coverageOf(buildGrowBgMask(pixels, autoWidth, height, background)) : 0
    const borderCov = config.smartBg ? coverageOf(buildBorderBgMask(pixels, autoWidth, height, config.borderTol)) : 0
    const aggrCov = Math.max(growCov, borderCov)
    const tightCov = config.removeBg
      ? coverageOf(buildBgMask(pixels, autoWidth, height, { ...background, threshold: Math.max(3, Math.round(config.bgThreshold * 0.33)) }))
      : 0
    // 泛洪吃穿主体 = 泛洪遮罩明显大于「紧贴背景色」的区域。
    // 如果泛洪多出来的部分占非背景区域过半，说明背景色与主体太接近，跳过背景去除。
    const nonBg = 1 - tightCov
    const floodThrough = Math.max(0, aggrCov - tightCov)
    safeBg = aggrCov <= 0.7 || (nonBg > 0.05 && floodThrough / nonBg < 0.5)
  }

  const quant = await quantizeImageAsync(pixels, autoWidth, height, quantPalette, lineArt ? 'nearest' : config.mode, onProgress, safeBg ? background : null, exclude)
  let finalRows = quant.rows

  // 背景去除（仅在安全时执行）
  if (safeBg && config.removeBg) finalRows = emptyOuterBackground(finalRows, buildGrowBgMask(pixels, autoWidth, height, background))
  if (safeBg && config.smartBg) finalRows = emptyOuterBackground(finalRows, buildBorderBgMask(pixels, autoWidth, height, config.borderTol))

  // 裁剪空白
  let crop: { x: number; y: number; w: number; h: number } | null = null
  let outW = autoWidth
  let outH = height
  if (config.autoCrop) {
    const cropped = cropEmptyBorders(finalRows)
    if (cropped) {
      crop = { x: cropped.x, y: cropped.y, w: cropped.w, h: cropped.h }
      finalRows = cropped.rows
      outW = cropped.w
      outH = cropped.h
    }
  }

  // 颜色上限兜底（自适应色板已保证用量，这里仅防超限）
  if (targetMaxColors > 0) {
    finalRows = limitColorCount(finalRows, palette, targetMaxColors).rows
  }

  // 轻量清理（单轮）
  if (lineArt) {
    if (config.denoise) finalRows = removeSpeckles(finalRows, 4)
    finalRows = bridgeLineGaps(finalRows, palette)
  } else {
    const isFloyd = config.mode === 'floyd'
    if (config.denoise) {
      if (!isFloyd) {
        const counts = computeUsedCounts(finalRows)
        let total = 0
        for (const n of counts.values()) total += n
        const noiseMin = Math.max(3, Math.min(8, Math.round(total * 0.0008)))
        if (noiseMin > 2) {
          finalRows = mergePatternColors(finalRows, palette, { mergeThreshold: 0, noiseMinCount: noiseMin }).rows
        }
      }
      finalRows = removeSpeckles(finalRows, isFloyd ? 4 : 3)
    }
    finalRows = fillSmallHoles(finalRows)
  }
  if (config.outline && !lineArt) finalRows = applyOutline(finalRows, palette)

  const totalBeads = finalRows.reduce((sum: number, row: string[]) => sum + row.filter((c: string) => c !== '.').length, 0)
  return {
    rows: finalRows,
    totalBeads,
    config,
    width: outW,
    height: outH,
    previewPixels: pixels,
    previewW: autoWidth,
    previewH: height,
    detailScore: analysis.detailScore,
    lineArt,
    crop,
    imageType: strategyMeta?.family as ImageType | undefined,
    strategyId: strategyMeta?.id,
    strategyLabel: strategyMeta?.label,
    strategyFamily: strategyMeta?.family,
    strategyReason: strategyMeta?.reason,
  }
}

/**
 * 一键生成：识别图片类型 → 选单一预设（合并用户参数）→ 单次生成。
 * 返回 score: null（无候选评分，结果即最终图纸）。
 */
export async function generateBestPattern(
  opts: GenerateOptions,
  onProgress?: (p: number) => void
): Promise<GenerateBestPatternResult> {
  const analysis = analyzeImage(opts.image, opts.srcRect)
  const type = imageTypeFromAnalysis(analysis)
  const preset = presetFor(type)
  const config = mergeUserConfig(preset, opts)
  const result = await generateCandidate(
    opts,
    config,
    onProgress,
    analysis,
    { id: type, label: IMAGE_TYPE_LABELS[type], family: type, reason: '' }
  )
  return { ...result, score: null }
}

export const CANDIDATE_PRESETS: CandidateConfig[] = [
  presetFor('flat-art'),
  { ...presetFor('flat-art'), label: 'compact', maxColors: 14, saturate: 1.2, contrast: 3, bgThreshold: 14, borderTol: 24, weight: 1.35 },
  { ...presetFor('photo'), label: 'floyd', maxColors: 32, saturate: 1.1, contrast: 4, bgThreshold: 16, borderTol: 28, mode: 'floyd', weight: 1.15 },
  { ...presetFor('photo'), label: 'minimal', maxColors: 18, saturate: 1.2, contrast: 4, bgThreshold: 18, borderTol: 30, weight: 1.2 },
  { ...presetFor('photo'), label: 'detailed', maxColors: 40, saturate: 1.15, sharpen: false, contrast: 5, denoise: false, weight: 0.85 },
  { ...presetFor('flat-art'), label: 'outline', maxColors: 28, saturate: 1.2, bgThreshold: 16, borderTol: 26, outline: true, weight: 0.95 },
]
