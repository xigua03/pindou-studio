import type { BeadPalette, BeadColor, GenMode } from '../types'
import {
  backgroundFromHex,
  bridgeLineGaps,
  buildBorderBgMask,
  buildGrowBgMask,
  computeUsedCounts,
  cropEmptyBorders,
  detectBackgroundColor,
  emptyOuterBackground,
  estimateContentRatio,
  imageToGridColors,
  isLineArt,
  isPixelArt,
  limitColorCount,
  mergePatternColors,
  quantizeImageAsync,
  removeSpeckles,
  selectAdaptivePalette,
  applyOutline,
} from './quantize'

// ============================================================================
// 通用自动生成器：候选方案 + 评分 + 自动选最优
// ============================================================================

export interface CandidateConfig {
  label: string
  width: number
  detail: number
  enhance: boolean
  saturate: number
  sharpen: boolean
  contrast: number
  brightness: number
  protectDark: number
  maxColors: number
  removeBg: boolean
  bgThreshold: number
  smartBg: boolean
  borderTol: number
  denoise: boolean
  outline: boolean
  mode: GenMode
  autoCrop: boolean
  onlyOwnedColors: boolean
  weight?: number
}

export const CANDIDATE_PRESETS: CandidateConfig[] = [
  {
    label: 'universal',
    width: 0,
    detail: 2,
    enhance: true,
    saturate: 1.5,
    sharpen: true,
    contrast: 8,
    brightness: 0,
    protectDark: 0.8,
    maxColors: 32,
    removeBg: true,
    bgThreshold: 18,
    smartBg: true,
    borderTol: 30,
    denoise: true,
    outline: false,
    mode: 'nearest',
    autoCrop: true,
    onlyOwnedColors: false,
    weight: 1.0,
  },
  {
    label: 'clean',
    width: 0,
    detail: 2,
    enhance: true,
    saturate: 1.45,
    sharpen: false,
    contrast: 5,
    brightness: 0,
    protectDark: 0.9,
    maxColors: 24,
    removeBg: true,
    bgThreshold: 18,
    smartBg: true,
    borderTol: 30,
    denoise: true,
    outline: false,
    mode: 'nearest',
    autoCrop: true,
    onlyOwnedColors: false,
    weight: 1.2,
  },
  {
    label: 'detailed',
    width: 0,
    detail: 2,
    enhance: true,
    saturate: 1.4,
    sharpen: true,
    contrast: 8,
    brightness: 0,
    protectDark: 0.75,
    maxColors: 40,
    removeBg: true,
    bgThreshold: 18,
    smartBg: true,
    borderTol: 30,
    denoise: false,
    outline: false,
    mode: 'nearest',
    autoCrop: true,
    onlyOwnedColors: false,
    weight: 0.92,
  },
  {
    label: 'outline',
    width: 0,
    detail: 2,
    enhance: true,
    saturate: 1.45,
    sharpen: false,
    contrast: 5,
    brightness: 0,
    protectDark: 1.0,
    maxColors: 28,
    removeBg: true,
    bgThreshold: 18,
    smartBg: true,
    borderTol: 30,
    denoise: true,
    outline: true,
    mode: 'nearest',
    autoCrop: true,
    onlyOwnedColors: false,
    weight: 1.08,
  },
  {
    label: 'bgClean',
    width: 0,
    detail: 2,
    enhance: true,
    saturate: 1.45,
    sharpen: false,
    contrast: 6,
    brightness: 0,
    protectDark: 0.8,
    maxColors: 28,
    removeBg: true,
    bgThreshold: 15,
    smartBg: true,
    borderTol: 25,
    denoise: true,
    outline: false,
    mode: 'nearest',
    autoCrop: true,
    onlyOwnedColors: false,
    weight: 1.0,
  },
]

export interface ScoringWeights {
  color: number
  speckle: number
  hole: number
  line: number
  bg: number
  detail: number
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  color: 18,
  speckle: 22,
  hole: 20,
  line: 20,
  bg: 12,
  detail: 8,
}

export interface PatternScore {
  total: number
  colorScore: number
  speckleScore: number
  holeScore: number
  lineScore: number
  bgScore: number
  detailScore: number
  raw: {
    colorCount: number
    totalBeads: number
    speckleCells: number
    speckleClusters: number
    holes: number
    lineContinuity: number
    bgResidual: number
    detailPreservation: number
  }
}

export interface GenerateOptions {
  image: HTMLImageElement
  palette: BeadPalette
  srcRect: { x: number; y: number; w: number; h: number } | null
  userWidth?: number
  userMaxColors?: number
  exclude?: Set<string> | null
  mode?: GenMode
  paletteId?: string
  bgColor?: string
  bgThreshold?: number
}

export interface GenerateCandidateResult {
  rows: string[][]
  totalBeads: number
  config: CandidateConfig
  width: number
  height: number
  previewPixels: Uint8ClampedArray
  previewW: number
  previewH: number
  detailScore: number
  lineArt: boolean
}

export interface GenerateBestPatternResult extends GenerateCandidateResult {
  score: PatternScore
}

function countColors(rows: string[][]): number {
  const set = new Set<string>()
  for (const row of rows) for (const c of row) if (c && c !== '.') set.add(c)
  return set.size
}

function countHoles(rows: string[][]): number {
  let n = 0
  for (const row of rows) for (const c of row) if (c === '.') n++
  return n
}

function countSpeckles(rows: string[][]): { cells: number; clusters: number } {
  const h = rows.length
  if (h === 0) return { cells: 0, clusters: 0 }
  const w = rows[0].length
  const visited = new Uint8Array(w * h)
  let speckleCells = 0
  let speckleClusters = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const code = rows[y][x]
      if (code === '.' || visited[y * w + x]) continue
      const stack = [[x, y]]
      visited[y * w + x] = 1
      let n = 0
      while (stack.length) {
        const [cx, cy] = stack.pop()!
        n++
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && !visited[ny * w + nx] && rows[ny][nx] === code) {
            visited[ny * w + nx] = 1
            stack.push([nx, ny])
          }
        }
      }
      if (n <= 2) {
        speckleCells += n
        speckleClusters++
      }
    }
  }
  return { cells: speckleCells, clusters: speckleClusters }
}

function measureLineContinuity(rows: string[][]): number {
  const h = rows.length
  if (h === 0) return 1
  const w = rows[0].length
  let total = 0
  let good = 0
  const scan = (get: (i: number, j: number) => string) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; ) {
        const code = get(x, y)
        if (code === '.') { x++; continue }
        let len = 0
        while (x < w && get(x, y) === code) { len++; x++ }
        total++
        if (len >= 3) good++
      }
    }
  }
  scan((x, y) => rows[y][x])
  // vertical
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; ) {
      const code = rows[y][x]
      if (code === '.') { y++; continue }
      let len = 0
      while (y < h && rows[y][x] === code) { len++; y++ }
      total++
      if (len >= 3) good++
    }
  }
  return total > 0 ? good / total : 1
}

function measureBgResidual(rows: string[][]): number {
  const h = rows.length
  if (h === 0) return 1
  const w = rows[0].length
  const border = Math.min(2, Math.floor(Math.min(w, h) / 4))
  let borderHoles = 0
  let borderCells = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const isBorder = x < border || y < border || x >= w - border || y >= h - border
      if (!isBorder) continue
      borderCells++
      if (rows[y][x] === '.') borderHoles++
    }
  }
  return borderCells > 0 ? 1 - borderHoles / borderCells : 1
}

function measureDetailPreservation(rows: string[][]): number {
  const h = rows.length
  if (h === 0) return 1
  const w = rows[0].length
  const visited = new Uint8Array(w * h)
  let total = 0
  let small = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const code = rows[y][x]
      if (code === '.' || visited[y * w + x]) continue
      const stack = [[x, y]]
      visited[y * w + x] = 1
      let n = 0
      while (stack.length) {
        const [cx, cy] = stack.pop()!
        n++
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && !visited[ny * w + nx] && rows[ny][nx] === code) {
            visited[ny * w + nx] = 1
            stack.push([nx, ny])
          }
        }
      }
      total++
      if (n >= 3 && n <= 5) small++
    }
  }
  return total > 0 ? 1 - small / total : 1
}

export function scorePattern(
  rows: string[][],
  totalBeads: number,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  maxColors: number = 32
): PatternScore {
  const colorCount = countColors(rows)
  const { cells: speckleCells, clusters: speckleClusters } = countSpeckles(rows)
  const holes = countHoles(rows)
  const lineContinuity = measureLineContinuity(rows)
  const bgResidual = measureBgResidual(rows)
  const detailPreservation = measureDetailPreservation(rows)

  const colorScore = Math.max(0, 20 * (1 - Math.min(1, colorCount / Math.max(maxColors, 8))))
  const speckleScore = Math.max(0, 20 * (1 - Math.min(1, speckleCells / Math.max(totalBeads * 0.01, 1))))
  const holeScore = Math.max(0, 20 * (1 - Math.min(1, holes / Math.max(totalBeads * 0.05, 1))))
  const lineScore = lineContinuity * 20
  const bgScore = bgResidual * 20
  const detailScore = detailPreservation * 20

  const total = (
    colorScore * weights.color +
    speckleScore * weights.speckle +
    holeScore * weights.hole +
    lineScore * weights.line +
    bgScore * weights.bg +
    detailScore * weights.detail
  ) / 100

  return {
    total,
    colorScore,
    speckleScore,
    holeScore,
    lineScore,
    bgScore,
    detailScore,
    raw: {
      colorCount,
      totalBeads,
      speckleCells,
      speckleClusters,
      holes,
      lineContinuity,
      bgResidual,
      detailPreservation,
    },
  }
}

export function selectBestPattern(
  candidates: GenerateCandidateResult[],
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  maxColors: number = 32
): { pattern: GenerateCandidateResult; score: PatternScore } {
  let best: { pattern: GenerateCandidateResult; score: PatternScore } | null = null
  let bestScore = -Infinity
  for (const c of candidates) {
    const score = scorePattern(c.rows, c.totalBeads, weights, maxColors)
    const weighted = score.total * (c.config.weight ?? 1)
    if (weighted > bestScore) {
      bestScore = weighted
      best = { pattern: c, score }
    }
  }
  if (!best) throw new Error('no candidates')
  return best
}

function chooseAutoWidth(detail: number, ratio: number): number {
  const base = detail < 50 ? 58 : detail < 170 ? 87 : 116
  const boosted = Math.min(256, Math.max(base, Math.round(base / Math.max(0.5, ratio))))
  return boosted
}

function estimateDetailScore(el: HTMLImageElement, src?: { x: number; y: number; w: number; h: number } | null): number {
  const S = 128
  const canvas = document.createElement('canvas')
  const sxx = src && src.w > 0 && src.h > 0 ? src.x : 0
  const syy = src && src.w > 0 && src.h > 0 ? src.y : 0
  const sw0 = src && src.w > 0 && src.h > 0 ? src.w : el.naturalWidth
  const sh0 = src && src.w > 0 && src.h > 0 ? src.h : el.naturalHeight
  const w = S
  const h = Math.max(2, Math.round((S * sh0) / sw0))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 0
  ctx.drawImage(el, sxx, syy, sw0, sh0, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  const cols = new Set<number>()
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    cols.add(((data[o] >> 4) << 8) | ((data[o + 1] >> 4) << 4) | (data[o + 2] >> 4))
  }
  return cols.size
}

export async function generateCandidate(
  opts: GenerateOptions,
  config: CandidateConfig,
  onProgress?: (p: number) => void
): Promise<GenerateCandidateResult> {
  const { image, palette, srcRect } = opts
  const lineArt = isLineArt(image, srcRect)
  const detailScore = estimateDetailScore(image, srcRect)
  const contentRatio = estimateContentRatio(image)
  const requestedWidth = opts.userWidth && opts.userWidth > 0 ? opts.userWidth : 0
  const autoWidth = requestedWidth > 0 ? requestedWidth : config.width > 0 ? config.width : chooseAutoWidth(detailScore, contentRatio)
  const effectiveSrc = srcRect && srcRect.w > 0 && srcRect.h > 0 ? srcRect : null
  const sourceW = effectiveSrc ? effectiveSrc.w : image.naturalWidth
  const sourceH = effectiveSrc ? effectiveSrc.h : image.naturalHeight
  const height = Math.max(2, Math.round((autoWidth * sourceH) / sourceW))

  const pixels = imageToGridColors(
    image,
    autoWidth,
    height,
    config.detail,
    config.enhance ? config.saturate : 1,
    config.sharpen ? 0.8 : 0,
    config.contrast,
    srcRect,
    config.protectDark,
    config.brightness,
    lineArt
  )

  const bgHex = opts.bgColor || '#FFFFFF'
  const bgThreshold = opts.bgThreshold ?? config.bgThreshold
  const background = backgroundFromHex(bgHex, bgThreshold)
  const exclude = opts.exclude ?? null

  const userMax = opts.userMaxColors && opts.userMaxColors > 0 ? opts.userMaxColors : 0
  const targetMaxColors = userMax > 0 ? userMax : config.maxColors
  let quantPalette = palette
  if (targetMaxColors > 0 && palette.colors.length > targetMaxColors) {
    const selected = selectAdaptivePalette(pixels, autoWidth, height, palette, targetMaxColors, background, exclude)
    quantPalette = { ...palette, colors: selected }
  }

  const quant = await quantizeImageAsync(
    pixels,
    autoWidth,
    height,
    quantPalette,
    lineArt ? 'nearest' : config.mode,
    onProgress,
    background,
    exclude
  )
  let finalRows = quant.rows

  if (config.removeBg) {
    finalRows = emptyOuterBackground(finalRows, buildGrowBgMask(pixels, autoWidth, height, background))
  }
  if (config.smartBg) {
    finalRows = emptyOuterBackground(finalRows, buildBorderBgMask(pixels, autoWidth, height, config.borderTol))
  }

  let outW = autoWidth
  let outH = height
  if (config.autoCrop) {
    const cropped = cropEmptyBorders(finalRows)
    if (cropped) {
      finalRows = cropped.rows
      outW = cropped.w
      outH = cropped.h
    }
  }

  if (targetMaxColors > 0) {
    finalRows = limitColorCount(finalRows, palette, targetMaxColors).rows
    if (!lineArt && !isPixelArt(image, srcRect)) {
      const counts = computeUsedCounts(finalRows)
      let total = 0
      for (const n of counts.values()) total += n
      const noiseMin = Math.max(3, Math.min(12, Math.round(total * 0.001)))
      finalRows = mergePatternColors(finalRows, palette, { mergeThreshold: 0, noiseMinCount: noiseMin }).rows
    }
  }

  if (config.denoise) finalRows = removeSpeckles(finalRows, 4)
  if (lineArt) finalRows = bridgeLineGaps(finalRows, palette)
  if (config.outline && !lineArt) finalRows = applyOutline(finalRows, palette)

  const totalBeads = finalRows.reduce((sum, row) => sum + row.filter((c) => c !== '.').length, 0)
  return {
    rows: finalRows,
    totalBeads,
    config,
    width: outW,
    height: outH,
    previewPixels: pixels,
    previewW: autoWidth,
    previewH: height,
    detailScore,
    lineArt,
  }
}

export async function generateBestPattern(
  opts: GenerateOptions,
  onProgress?: (p: number) => void
): Promise<GenerateBestPatternResult> {
  const candidates: GenerateCandidateResult[] = []
  const total = CANDIDATE_PRESETS.length
  for (let i = 0; i < total; i++) {
    const preset = CANDIDATE_PRESETS[i]
    const result = await generateCandidate(opts, preset, (p) => {
      if (onProgress) {
        const phase = i / total
        onProgress(Math.min(0.99, phase + p / total))
      }
    })
    candidates.push(result)
  }

  const best = selectBestPattern(candidates)
  if (onProgress) onProgress(1)
  return {
    ...best.pattern,
    score: best.score,
  }
}
