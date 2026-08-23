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

export const DEFAULT_WEIGHTS: ScoringWeights = {
  color: 18,
  speckle: 28,
  hole: 26,
  line: 15,
  bg: 13,
  detail: 6,
}

export function scorePattern(
  rows: string[][],
  totalBeads: number,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  maxColors = 32
): PatternScore {
  const colorCount = countColors(rows)
  const { cells: speckleCells, clusters: speckleClusters } = countSpeckles(rows)
  const holes = countHoles(rows)
  const lineContinuity = measureLineContinuity(rows)
  const bgResidual = measureBgResidual(rows)
  const detailPreservation = measureDetailPreservation(rows)

  const colorScore = Math.max(0, 20 * (1 - Math.min(1, Math.max(0, colorCount - 3) / Math.max(maxColors * 0.8, 8))))
  const speckleScore = Math.max(0, 20 * (1 - Math.min(1, speckleCells / Math.max(totalBeads * 0.003, 2))))
  const holeScore = Math.max(0, 20 * (1 - Math.min(1, holes / Math.max(totalBeads * 0.006, 2))))
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
  maxColors = 32
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
