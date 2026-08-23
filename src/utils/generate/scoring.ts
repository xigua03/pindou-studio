import type { BeadColor, BeadPalette } from '../../types'
import { ciede2000, rgbToLab } from '../color'
import type { GenerateCandidateResult, PatternScore, ScoringWeights } from './types'

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
  const border = Math.min(4, Math.floor(Math.min(w, h) / 4))
  let badCells = 0
  let totalCells = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const isBorder = x < border || y < border || x >= w - border || y >= h - border
      if (isBorder) {
        totalCells++
        if (rows[y][x] === '.') badCells++
        continue
      }
      if (rows[y][x] === '.') {
        let surrounded = true
        for (const [dx, dy] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]] as const) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || rows[ny][nx] === '.') { surrounded = false; break }
        }
        if (surrounded) badCells++
        totalCells++
      }
    }
  }
  return totalCells > 0 ? 1 - badCells / totalCells : 1
}

function measureDetailPreservation(rows: string[][]): number {
  const h = rows.length
  if (h === 0) return 1
  const w = rows[0].length
  const visited = new Uint8Array(w * h)
  let total = 0
  let tiny = 0
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
      // 只有 1~2 格的色块才算噪声；3 格以上是细节（眼睛/描边/高光），不扣分
      if (n <= 2) tiny++
    }
  }
  return total > 0 ? 1 - tiny / total : 1
}

/** 颜色保真度：按 2x2 块平均对比「最终色号颜色」与「源图采样像素颜色」的 CIEDE2000 误差。
 *  块级平均能消除抖动算法（误差扩散）的逐像素贴近优势——它不该因为「碎得更细」
 *  而在像不像上占便宜；对拼豆而言，块级颜色一致才真正还原观感。 */
function measureFidelity(
  rows: string[][],
  source: { pixels: Uint8ClampedArray; w: number; h: number; palette: BeadPalette; crop?: { x: number; y: number; w: number; h: number } | null }
): number {
  const h = rows.length
  if (h === 0) return 15
  const w = rows[0].length
  const ox = source.crop?.x ?? 0
  const oy = source.crop?.y ?? 0
  if (ox < 0 || oy < 0 || ox + w > source.w || oy + h > source.h) return 15
  const byCode = new Map<string, BeadColor>(source.palette.colors.map((c) => [c.code, c]))
  const B = 2
  const bw = Math.floor(w / B)
  const bh = Math.floor(h / B)
  let sum = 0
  let n = 0
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let srcR = 0
      let srcG = 0
      let srcB = 0
      let dstR = 0
      let dstG = 0
      let dstB = 0
      let cells = 0
      for (let dy = 0; dy < B; dy++) {
        for (let dx = 0; dx < B; dx++) {
          const y = by * B + dy
          const x = bx * B + dx
          const code = rows[y][x]
          const si = ((oy + y) * source.w + (ox + x)) * 4
          srcR += source.pixels[si]
          srcG += source.pixels[si + 1]
          srcB += source.pixels[si + 2]
          if (!code || code === '.') continue
          const bead = byCode.get(code)
          if (!bead) continue
          dstR += bead.rgb[0]
          dstG += bead.rgb[1]
          dstB += bead.rgb[2]
          cells++
        }
      }
      if (cells === 0) continue
      const srcLab = rgbToLab(srcR / (B * B), srcG / (B * B), srcB / (B * B))
      const dstLab = rgbToLab(dstR / cells, dstG / cells, dstB / cells)
      sum += ciede2000(srcLab, dstLab)
      n++
    }
  }
  if (n === 0) return 15
  const avg = sum / n
  return Math.max(0, Math.min(20, 20 * (1 - avg / 32)))
}

interface FidelitySource {
  pixels: Uint8ClampedArray
  w: number
  h: number
  palette: BeadPalette
  crop?: { x: number; y: number; w: number; h: number } | null
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  color: 14,
  speckle: 26,
  hole: 22,
  line: 12,
  bg: 12,
  detail: 18,
}

export function scorePattern(
  rows: string[][],
  totalBeads: number,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  maxColors = 32,
  source?: FidelitySource | null
): PatternScore {
  const colorCount = countColors(rows)
  const { cells: speckleCells, clusters: speckleClusters } = countSpeckles(rows)
  const holes = countHoles(rows)
  const lineContinuity = measureLineContinuity(rows)
  const bgResidual = measureBgResidual(rows)
  const detailPreservation = measureDetailPreservation(rows)
  const fidelity = source ? measureFidelity(rows, source) : -1

  const colorScore = Math.max(0, 20 * (1 - Math.min(1, Math.max(0, colorCount - 4) / Math.max(maxColors * 1.15, 10))))
  const speckleScore = Math.max(0, 20 * (1 - Math.min(1, speckleCells / Math.max(totalBeads * 0.003, 2))))
  const holeScore = Math.max(0, 20 * (1 - Math.min(1, holes / Math.max(totalBeads * 0.006, 2))))
  const lineScore = lineContinuity * 20
  const bgScore = bgResidual * 20
  // 有源图时用「颜色保真度」作为 detail 维度，否则退回结构性度量
  const detailScore = fidelity >= 0 ? fidelity : detailPreservation * 20

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
  maxColors = 32,
  palette?: BeadPalette | null
): { pattern: GenerateCandidateResult; score: PatternScore } {
  let best: { pattern: GenerateCandidateResult; score: PatternScore } | null = null
  let bestScore = -Infinity
  for (const c of candidates) {
    const source =
      palette && c.previewPixels
        ? { pixels: c.previewPixels, w: c.previewW, h: c.previewH, palette, crop: c.crop ?? null }
        : null
    const score = scorePattern(c.rows, c.totalBeads, weights, maxColors, source)
    const weighted = score.total * (c.config.weight ?? 1)
    if (weighted > bestScore) {
      bestScore = weighted
      best = { pattern: c, score }
    }
  }
  if (!best) throw new Error('no candidates')
  return best
}
