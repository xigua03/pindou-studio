import type { BeadPalette } from '../../types'
import { backgroundFromHex, bridgeLineGaps, buildBorderBgMask, buildGrowBgMask, cropEmptyBorders, computeUsedCounts, emptyOuterBackground, fillSmallHoles, imageToGridColors, limitColorCount, mergePatternColors, quantizeImageAsync, removeSpeckles, selectAdaptivePalette, applyOutline } from '../quantize'
import { analyzeImage } from './image'
import { DEFAULT_WEIGHTS, scorePattern } from './scoring'
import type { CandidateConfig, GenerateBestPatternResult, GenerateCandidateResult, GenerateOptions, ScoringWeights, StrategyAnalysis, StrategyFamily, StrategySpec } from './types'

function chooseAutoWidth(detail: number, ratio: number): number {
  const base = detail < 50 ? 56 : detail < 170 ? 80 : 100
  return Math.min(144, Math.max(base, Math.round(base / Math.max(0.5, ratio))))
}

function cloneConfig(base: CandidateConfig, patch: Partial<CandidateConfig>): CandidateConfig {
  return { ...base, ...patch }
}

function baseCandidate(label: string): CandidateConfig {
  return {
    label,
    width: 0,
    detail: 2,
    enhance: true,
    saturate: 1.4,
    sharpen: false,
    contrast: 5,
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

function familyFromAnalysis(analysis: ReturnType<typeof analyzeImage>): StrategyFamily {
  if (analysis.lineArt) return 'line-art'
  if (analysis.pixelArt) return 'pixel-art'
  if (analysis.detailScore < 120) return 'flat-art'
  return 'photo'
}

function buildStrategyAnalysis(analysis: ReturnType<typeof analyzeImage>): StrategyAnalysis {
  const family = familyFromAnalysis(analysis)
  return {
    family,
    lineArt: analysis.lineArt,
    pixelArt: analysis.pixelArt,
    detailScore: analysis.detailScore,
    contentRatio: analysis.contentRatio,
    source: family === 'line-art' ? 'shape+tone classifier' : family === 'pixel-art' ? 'pixel-structure classifier' : 'detail+ratio heuristic',
  }
}

function buildStrategySpecs(family: StrategyFamily, analysis: ReturnType<typeof analyzeImage>, opts: GenerateOptions): StrategySpec[] {
  const requestedWidth = opts.userWidth && opts.userWidth > 0 ? opts.userWidth : 0
  const baseWidth = requestedWidth > 0 ? requestedWidth : chooseAutoWidth(analysis.detailScore, analysis.contentRatio)

  const strategy = (id: string, label: string, reason: string, weights: ScoringWeights, candidates: CandidateConfig[]): StrategySpec => ({
    id,
    label,
    family,
    reason,
    weights,
    candidates,
  })

  const w = (offset: number) => Math.max(32, Math.min(160, Math.round(baseWidth + offset)))

  if (family === 'line-art') {
    return [
      strategy('line-tight', '线稿紧致', '偏向保线、补洞和强背景清理，适合轮廓明确的黑白/简笔画。', { color: 10, speckle: 30, hole: 30, line: 24, bg: 20, detail: 6 }, [
        cloneConfig(baseCandidate('line-tight-a'), { width: w(8), saturate: 1.25, contrast: 8, protectDark: 0.95, maxColors: 12, bgThreshold: 14, borderTol: 20, denoise: true, mode: 'nearest', weight: 1.1 }),
        cloneConfig(baseCandidate('line-tight-b'), { width: w(0), saturate: 1.2, contrast: 6, protectDark: 0.9, maxColors: 10, bgThreshold: 12, borderTol: 18, denoise: true, mode: 'nearest', weight: 1.0 }),
      ]),
      strategy('line-safe', '线稿保守', '更少重处理，优先维持线条连续性，避免复杂边缘被误清。', { color: 8, speckle: 24, hole: 26, line: 28, bg: 18, detail: 5 }, [
        cloneConfig(baseCandidate('line-safe-a'), { width: w(-4), saturate: 1.15, contrast: 5, protectDark: 1.0, maxColors: 14, bgThreshold: 18, borderTol: 24, denoise: false, mode: 'nearest', weight: 0.95 }),
      ]),
    ]
  }

  if (family === 'pixel-art') {
    return [
      strategy('pixel-crisp', '像素锐利', '偏向少处理，保留块面边界和颜色边缘，适合像素画与 Logo。', { color: 16, speckle: 24, hole: 18, line: 12, bg: 12, detail: 10 }, [
        cloneConfig(baseCandidate('pixel-crisp-a'), { width: w(0), detail: 1, saturate: 1.1, sharpen: false, contrast: 4, protectDark: 0.7, maxColors: 20, bgThreshold: 16, borderTol: 22, denoise: true, mode: 'nearest', weight: 1.2 }),
        cloneConfig(baseCandidate('pixel-crisp-b'), { width: w(4), detail: 1, saturate: 1.05, sharpen: false, contrast: 2, protectDark: 0.65, maxColors: 16, bgThreshold: 14, borderTol: 20, denoise: true, mode: 'nearest', weight: 1.0 }),
      ]),
      strategy('pixel-contrast', '像素对比', '稍微强化对比和颜色分离，用来防止小图块糊成一片。', { color: 15, speckle: 20, hole: 18, line: 10, bg: 10, detail: 12 }, [
        cloneConfig(baseCandidate('pixel-contrast-a'), { width: w(6), detail: 1, saturate: 1.2, sharpen: false, contrast: 8, protectDark: 0.7, maxColors: 18, bgThreshold: 15, borderTol: 22, denoise: true, mode: 'nearest', weight: 0.95 }),
      ]),
    ]
  }

  if (family === 'flat-art') {
    return [
      strategy('flat-balanced', '扁平均衡', '适合插画、头像、卡通图，平衡色数、碎点和主体轮廓。', { color: 22, speckle: 22, hole: 22, line: 12, bg: 14, detail: 8 }, [
        cloneConfig(baseCandidate('flat-balanced-a'), { width: w(0), saturate: 1.35, sharpen: false, contrast: 5, protectDark: 0.86, maxColors: 18, bgThreshold: 16, borderTol: 26, denoise: true, mode: 'nearest', weight: 1.2 }),
        cloneConfig(baseCandidate('flat-balanced-b'), { width: w(6), saturate: 1.3, sharpen: false, contrast: 4, protectDark: 0.82, maxColors: 16, bgThreshold: 14, borderTol: 24, denoise: true, mode: 'nearest', weight: 1.0 }),
      ]),
      strategy('flat-compact', '扁平紧凑', '尽量减少颜色与空洞，更适合需要直接打印和快速拼装的版本。', { color: 28, speckle: 26, hole: 26, line: 10, bg: 10, detail: 6 }, [
        cloneConfig(baseCandidate('flat-compact-a'), { width: w(-4), saturate: 1.28, sharpen: false, contrast: 3, protectDark: 0.88, maxColors: 12, bgThreshold: 14, borderTol: 22, denoise: true, mode: 'nearest', weight: 1.15 }),
        cloneConfig(baseCandidate('flat-compact-b'), { width: w(2), saturate: 1.25, sharpen: false, contrast: 4, protectDark: 0.9, maxColors: 14, bgThreshold: 15, borderTol: 24, denoise: true, mode: 'floyd', weight: 0.95 }),
      ]),
      strategy('flat-detail', '扁平细节', '更重视边缘和小结构，适合卡通主体和需要保轮廓的插画。', { color: 20, speckle: 18, hole: 18, line: 18, bg: 12, detail: 14 }, [
        cloneConfig(baseCandidate('flat-detail-a'), { width: w(8), saturate: 1.42, sharpen: true, contrast: 6, protectDark: 0.78, maxColors: 22, bgThreshold: 16, borderTol: 28, denoise: false, mode: 'nearest', weight: 0.9 }),
      ]),
    ]
  }

  return [
    strategy('photo-natural', '照片自然', '先保住主体层次，再做背景清理和轻微收色。', { color: 16, speckle: 26, hole: 24, line: 10, bg: 16, detail: 10 }, [
      cloneConfig(baseCandidate('photo-natural-a'), { width: w(0), saturate: 1.5, sharpen: true, contrast: 8, protectDark: 0.8, maxColors: 32, bgThreshold: 18, borderTol: 30, denoise: true, mode: 'nearest', weight: 1.0 }),
      cloneConfig(baseCandidate('photo-natural-b'), { width: w(8), saturate: 1.45, sharpen: true, contrast: 6, protectDark: 0.76, maxColors: 28, bgThreshold: 16, borderTol: 28, denoise: true, mode: 'nearest', weight: 0.95 }),
    ]),
    strategy('photo-floyd', '照片抖动', '用抖动保留渐变和肤色过渡，减少色带。', { color: 14, speckle: 20, hole: 18, line: 8, bg: 14, detail: 14 }, [
      cloneConfig(baseCandidate('photo-floyd-a'), { width: w(4), saturate: 1.42, sharpen: false, contrast: 6, protectDark: 0.82, maxColors: 24, bgThreshold: 16, borderTol: 28, denoise: true, mode: 'floyd', weight: 1.1 }),
      cloneConfig(baseCandidate('photo-floyd-b'), { width: w(10), saturate: 1.38, sharpen: false, contrast: 5, protectDark: 0.8, maxColors: 20, bgThreshold: 15, borderTol: 26, denoise: true, mode: 'floyd', weight: 0.95 }),
    ]),
    strategy('photo-compact', '照片紧凑', '减少颜色和碎点，生成更容易买料和拼装的版本。', { color: 24, speckle: 24, hole: 24, line: 10, bg: 14, detail: 4 }, [
      cloneConfig(baseCandidate('photo-compact-a'), { width: w(-6), saturate: 1.35, sharpen: false, contrast: 4, protectDark: 0.86, maxColors: 16, bgThreshold: 14, borderTol: 24, denoise: true, mode: 'nearest', weight: 1.05 }),
    ]),
  ]
}

export async function generateCandidate(
  opts: GenerateOptions,
  config: CandidateConfig,
  onProgress?: (p: number) => void,
  analysisOverride?: ReturnType<typeof analyzeImage>,
  strategyMeta?: { id: string; label: string; family: StrategyFamily; reason: string }
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
  const background = backgroundFromHex(bgHex, opts.bgThreshold ?? config.bgThreshold)
  const exclude = opts.exclude ?? null
  const userMax = opts.userMaxColors && opts.userMaxColors > 0 ? opts.userMaxColors : 0
  const targetMaxColors = userMax > 0 ? userMax : config.maxColors
  let quantPalette = palette
  if (targetMaxColors > 0 && palette.colors.length > targetMaxColors) {
    const selected = selectAdaptivePalette(pixels, autoWidth, height, palette, targetMaxColors, background, exclude)
    quantPalette = { ...palette, colors: selected }
  }

  const quant = await quantizeImageAsync(pixels, autoWidth, height, quantPalette, lineArt ? 'nearest' : config.mode, onProgress, background, exclude)
  let finalRows = quant.rows

  if (config.removeBg) finalRows = emptyOuterBackground(finalRows, buildGrowBgMask(pixels, autoWidth, height, background))
  if (config.smartBg) finalRows = emptyOuterBackground(finalRows, buildBorderBgMask(pixels, autoWidth, height, config.borderTol))
  if (config.autoCrop) {
    const cropped = cropEmptyBorders(finalRows)
    if (cropped) finalRows = cropped.rows
  }

  if (targetMaxColors > 0) {
    finalRows = limitColorCount(finalRows, palette, targetMaxColors).rows
    if (!lineArt) {
      const counts = computeUsedCounts(finalRows)
      let total = 0
      for (const n of counts.values()) total += n
      const noiseMin = Math.max(4, Math.min(16, Math.round(total * 0.0025)))
      finalRows = mergePatternColors(finalRows, palette, { mergeThreshold: 0, noiseMinCount: noiseMin }).rows
    }
  }

  if (config.denoise) finalRows = removeSpeckles(finalRows, 4)
  if (!lineArt) finalRows = fillSmallHoles(finalRows)
  if (lineArt) finalRows = bridgeLineGaps(finalRows, palette)
  if (config.outline && !lineArt) finalRows = applyOutline(finalRows, palette)
  if (!lineArt) {
    const counts = computeUsedCounts(finalRows)
    let total = 0
    for (const n of counts.values()) total += n
    const minKeep = Math.max(4, Math.min(10, Math.round(total * 0.002)))
    if (minKeep > 2) {
      finalRows = mergePatternColors(finalRows, palette, { mergeThreshold: 0, noiseMinCount: minKeep }).rows
      finalRows = removeSpeckles(finalRows, 3)
      finalRows = fillSmallHoles(finalRows)
    }
  }

  const totalBeads = finalRows.reduce((sum: number, row: string[]) => sum + row.filter((c: string) => c !== '.').length, 0)
  return {
    rows: finalRows,
    totalBeads,
    config,
    width: autoWidth,
    height,
    previewPixels: pixels,
    previewW: autoWidth,
    previewH: height,
    detailScore: analysis.detailScore,
    lineArt,
    strategyId: strategyMeta?.id,
    strategyLabel: strategyMeta?.label,
    strategyFamily: strategyMeta?.family,
    strategyReason: strategyMeta?.reason,
  }
}

export async function generateBestPattern(
  opts: GenerateOptions,
  onProgress?: (p: number) => void
): Promise<GenerateBestPatternResult> {
  const analysis = analyzeImage(opts.image, opts.srcRect)
  const strategyAnalysis = {
    family: familyFromAnalysis(analysis),
    lineArt: analysis.lineArt,
    pixelArt: analysis.pixelArt,
    detailScore: analysis.detailScore,
    contentRatio: analysis.contentRatio,
    source: 'heuristic classifier',
  } as const
  const family = strategyAnalysis.family
  const strategies = buildStrategySpecs(family, analysis, opts)
  const candidates: GenerateCandidateResult[] = []
  const totalCandidates = strategies.reduce((sum, s) => sum + s.candidates.length, 0)
  let done = 0

  for (const spec of strategies) {
    for (const preset of spec.candidates) {
      const result = await generateCandidate(
        opts,
        preset,
        (p) => {
          if (onProgress && totalCandidates > 0) {
            const phase = done / totalCandidates
            onProgress(Math.min(0.99, phase + p / totalCandidates))
          }
        },
        analysis,
        { id: spec.id, label: spec.label, family: spec.family, reason: spec.reason }
      )
      candidates.push(result)
      done++
    }
  }

  let best: { pattern: GenerateCandidateResult; score: ReturnType<typeof scorePattern> } | null = null
  let bestWeighted = -Infinity
  for (const c of candidates) {
    const weights = strategies.find((s) => s.id === c.strategyId)?.weights ?? DEFAULT_WEIGHTS
    const score = scorePattern(c.rows, c.totalBeads, weights)
    const weighted = score.total * (c.config.weight ?? 1)
    if (weighted > bestWeighted) {
      bestWeighted = weighted
      best = { pattern: c, score }
    }
  }

  if (!best) throw new Error('no candidates')
  if (onProgress) onProgress(1)
  return { ...best.pattern, score: best.score }
}

export const CANDIDATE_PRESETS: CandidateConfig[] = [
  baseCandidate('universal'),
  cloneConfig(baseCandidate('compact'), { maxColors: 14, saturate: 1.35, contrast: 4, bgThreshold: 14, borderTol: 24, weight: 1.35 }),
  cloneConfig(baseCandidate('floyd'), { maxColors: 24, saturate: 1.42, contrast: 6, bgThreshold: 16, borderTol: 28, mode: 'floyd', weight: 1.15 }),
  cloneConfig(baseCandidate('minimal'), { maxColors: 16, saturate: 1.4, contrast: 5, bgThreshold: 18, borderTol: 30, weight: 1.2 }),
  cloneConfig(baseCandidate('detailed'), { maxColors: 40, saturate: 1.4, sharpen: true, contrast: 8, denoise: false, weight: 0.85 }),
  cloneConfig(baseCandidate('outline'), { maxColors: 28, saturate: 1.45, bgThreshold: 16, borderTol: 26, outline: true, weight: 0.95 }),
]
