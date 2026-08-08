import type { BeadColor, BeadPalette, GenMode, Pattern } from '../types'
import { rgbToLab, ciede2000, hexToRgb, rgbToHex } from './color'

interface LabColor {
  code: string
  hex: string
  lab: [number, number, number]
}

/** Background removal config: cells closer than threshold (CIEDE2000) to rgb are left empty */
export interface BackgroundConfig {
  rgb: [number, number, number]
  threshold: number
}

export function buildLabTable(palette: BeadPalette): LabColor[] {
  return palette.colors.map((c) => ({
    code: c.code,
    hex: c.hex,
    lab: rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2])
  }))
}

function nearestCode(lab: [number, number, number], table: LabColor[]): string {
  let best = table[0].code
  let bestD = Infinity
  for (let i = 0; i < table.length; i++) {
    const d = ciede2000(lab, table[i].lab)
    if (d < bestD) {
      bestD = d
      best = table[i].code
    }
  }
  return best
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

function isBackground(lab: [number, number, number], bgLab: [number, number, number] | null, threshold: number): boolean {
  return bgLab !== null && ciede2000(lab, bgLab) < threshold
}

/**
 * Image -> bead color grid.
 * mode:
 *  - nearest: per-pixel nearest color (clean, flat)
 *  - floyd:   Floyd-Steinberg error diffusion (keeps gradients, grainy)
 * background: optional config to leave background cells empty ('.')
 */
export function quantizeImage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  palette: BeadPalette,
  mode: GenMode,
  onProgress?: (p: number) => void,
  background?: BackgroundConfig | null,
  exclude?: Set<string> | null
): { rows: string[][]; used: Set<string> } {
  if (mode === 'floyd') return quantizeImageFloyd(pixels, width, height, palette, onProgress, background, exclude)

  const table = buildTableExcluding(palette, exclude)
  const bgLab = background ? rgbToLab(background.rgb[0], background.rgb[1], background.rgb[2]) : null
  const th = background?.threshold ?? 0
  const rows: string[][] = []
  const used = new Set<string>()
  for (let y = 0; y < height; y++) {
    const row: string[] = []
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const lab = rgbToLab(pixels[idx], pixels[idx + 1], pixels[idx + 2])
      if (isBackground(lab, bgLab, th)) {
        row.push('.')
        continue
      }
      const code = nearestCode(lab, table)
      row.push(code)
      used.add(code)
    }
    rows.push(row)
    if (onProgress && y % 8 === 0) onProgress((y + 1) / height)
  }
  return { rows, used }
}

/** Floyd-Steinberg error diffusion (accumulate error in RGB then match nearest code) */
export function quantizeImageFloyd(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  palette: BeadPalette,
  onProgress?: (p: number) => void,
  background?: BackgroundConfig | null,
  exclude?: Set<string> | null
): { rows: string[][]; used: Set<string> } {
  const table = buildTableExcluding(palette, exclude)
  const byCode = new Map<string, BeadColor>(palette.colors.map((c) => [c.code, c]))
  const bgLab = background ? rgbToLab(background.rgb[0], background.rgb[1], background.rgb[2]) : null
  const th = background?.threshold ?? 0
  const rows: string[][] = []
  const used = new Set<string>()
  const errR = new Float64Array(width * height)
  const errG = new Float64Array(width * height)
  const errB = new Float64Array(width * height)

  const addErr = (x: number, y: number, r: number, g: number, b: number, w: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height || w <= 0) return
    const i = y * width + x
    errR[i] += r * w
    errG[i] += g * w
    errB[i] += b * w
  }

  for (let y = 0; y < height; y++) {
    const row: string[] = []
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const pi = i * 4
      const r = clamp255(pixels[pi] + errR[i])
      const g = clamp255(pixels[pi + 1] + errG[i])
      const b = clamp255(pixels[pi + 2] + errB[i])
      const lab = rgbToLab(r, g, b)
      if (isBackground(lab, bgLab, th)) {
        row.push('.')
        continue
      }
      const code = nearestCode(lab, table)
      row.push(code)
      used.add(code)
      const t = byCode.get(code)!
      const er = r - t.rgb[0]
      const eg = g - t.rgb[1]
      const eb = b - t.rgb[2]
      addErr(x + 1, y, er, eg, eb, 7 / 16)
      addErr(x - 1, y + 1, er, eg, eb, 3 / 16)
      addErr(x, y + 1, er, eg, eb, 5 / 16)
      addErr(x + 1, y + 1, er, eg, eb, 1 / 16)
    }
    rows.push(row)
    if (onProgress && y % 8 === 0) onProgress((y + 1) / height)
  }
  return { rows, used }
}

/** Load an image file into an HTMLImageElement */
export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('??????'))
    }
    img.src = url
  })
}

/** Draw image to an offscreen canvas at target grid size and read pixels */
export function imageToPixels(
  img: HTMLImageElement,
  width: number,
  height: number
): Uint8ClampedArray {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height).data
}

export function buildPatternFromRows(
  rows: string[][],
  paletteId: string,
  name: string,
  source: Pattern['source'],
  tags: string[] = []
): Pattern {
  const height = rows.length
  const width = height > 0 ? rows[0].length : 0
  return {
    id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name,
    tags,
    paletteId,
    width,
    height,
    rows,
    source,
    createdAt: Date.now()
  }
}

/** Async chunked quantization: yield to the event loop between batches (for progress UI) */
export async function quantizeImageAsync(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  palette: BeadPalette,
  mode: GenMode,
  onProgress?: (p: number) => void,
  background?: BackgroundConfig | null,
  exclude?: Set<string> | null
): Promise<{ rows: string[][]; used: Set<string> }> {
  if (mode === 'floyd') return quantizeImageFloydAsync(pixels, width, height, palette, onProgress, background, exclude)
  const table = buildTableExcluding(palette, exclude)
  const bgLab = background ? rgbToLab(background.rgb[0], background.rgb[1], background.rgb[2]) : null
  const th = background?.threshold ?? 0
  const rows: string[][] = []
  const used = new Set<string>()
  const BATCH = 16
  for (let y = 0; y < height; y++) {
    const row: string[] = []
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const lab = rgbToLab(pixels[idx], pixels[idx + 1], pixels[idx + 2])
      if (isBackground(lab, bgLab, th)) {
        row.push('.')
        continue
      }
      const code = nearestCode(lab, table)
      row.push(code)
      used.add(code)
    }
    rows.push(row)
    if (y % BATCH === BATCH - 1 || y === height - 1) {
      onProgress?.((y + 1) / height)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  return { rows, used }
}

async function quantizeImageFloydAsync(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  palette: BeadPalette,
  onProgress?: (p: number) => void,
  background?: BackgroundConfig | null,
  exclude?: Set<string> | null
): Promise<{ rows: string[][]; used: Set<string> }> {
  const table = buildTableExcluding(palette, exclude)
  const byCode = new Map<string, BeadColor>(palette.colors.map((c) => [c.code, c]))
  const bgLab = background ? rgbToLab(background.rgb[0], background.rgb[1], background.rgb[2]) : null
  const th = background?.threshold ?? 0
  const rows: string[][] = []
  const used = new Set<string>()
  const errR = new Float64Array(width * height)
  const errG = new Float64Array(width * height)
  const errB = new Float64Array(width * height)
  const addErr = (x: number, y: number, r: number, g: number, b: number, w: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height || w <= 0) return
    const i = y * width + x
    errR[i] += r * w
    errG[i] += g * w
    errB[i] += b * w
  }
  const BATCH = 16
  for (let y = 0; y < height; y++) {
    const row: string[] = []
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const pi = i * 4
      const r = clamp255(pixels[pi] + errR[i])
      const g = clamp255(pixels[pi + 1] + errG[i])
      const b = clamp255(pixels[pi + 2] + errB[i])
      const lab = rgbToLab(r, g, b)
      if (isBackground(lab, bgLab, th)) {
        row.push('.')
        continue
      }
      const code = nearestCode(lab, table)
      row.push(code)
      used.add(code)
      const t = byCode.get(code)!
      const er = r - t.rgb[0]
      const eg = g - t.rgb[1]
      const eb = b - t.rgb[2]
      addErr(x + 1, y, er, eg, eb, 7 / 16)
      addErr(x - 1, y + 1, er, eg, eb, 3 / 16)
      addErr(x, y + 1, er, eg, eb, 5 / 16)
      addErr(x + 1, y + 1, er, eg, eb, 1 / 16)
    }
    rows.push(row)
    if (y % BATCH === BATCH - 1 || y === height - 1) {
      onProgress?.((y + 1) / height)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  return { rows, used }
}

/** Quick saturation boost around luminance */
export function boostSaturation(r: number, g: number, b: number, factor: number): [number, number, number] {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return [
    lum + (r - lum) * factor,
    lum + (g - lum) * factor,
    lum + (b - lum) * factor
  ]
}

/**
 * High quality downscale: draw image at width*ss x height*ss, then box-average
 * each cell's ss*ss pixels (more faithful than direct canvas shrink).
 * Transparent pixels are treated as white (bead boards are usually light).
 */
/** 3x3 unsharp mask: out = px + amount * (px - blur) */
function unsharp(data: Uint8ClampedArray, w: number, h: number, amount: number): void {
  const src = new Uint8ClampedArray(data)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        let sum = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
              sum += src[(ny * w + nx) * 4 + c]
              n++
            }
          }
        }
        const blur = sum / n
        data[i + c] = Math.max(0, Math.min(255, data[i + c] + amount * (data[i + c] - blur)))
      }
    }
  }
}

export function imageToGridColors(
  img: HTMLImageElement,
  width: number,
  height: number,
  supersample = 2,
  saturate = 1,
  sharpen = 0,
  contrast = 0,
  src?: { x: number; y: number; w: number; h: number } | null,
  protectDark = 0.8
): Uint8ClampedArray {
  // Source region (in image coordinates). When nothing is cropped we use the full image.
  const sxx = src && src.w > 0 && src.h > 0 ? src.x : 0
  const syy = src && src.w > 0 && src.h > 0 ? src.y : 0
  const sw0 = src && src.w > 0 && src.h > 0 ? src.w : img.naturalWidth
  const sh0 = src && src.w > 0 && src.h > 0 ? src.h : img.naturalHeight

  // Sampling resolution: must stay high enough that thin dark lines (whiskers,
  // outlines, pupils) are at least ~1 sample thick after the initial resize.
  // If we only draw at width*ss the lines get averaged away before the per-cell
  // step below, so we never fall below min(natural, SAMPLE_CAP).
  const naturalMax = Math.max(sw0, sh0)
  const SAMPLE_CAP = 1200
  const sw = Math.max(1, Math.max(width * supersample, Math.min(naturalMax, SAMPLE_CAP)))
  const sh = Math.max(1, Math.round((sw * sh0) / sw0))

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sxx, syy, sw0, sh0, 0, 0, sw, sh)
  const data = ctx.getImageData(0, 0, sw, sh).data
  if (sharpen > 0) unsharp(data, sw, sh, sharpen)

  const out = new Uint8ClampedArray(width * height * 4)
  const fx = sw / width
  const fy = sh / height
  const DARK_LUM = 100 // a pixel this dark can be part of a thin dark line
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * fy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * fx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      let minR = 255
      let minG = 255
      let minB = 255
      let minLum = 255
      let darkCount = 0
      for (let py = y0; py < y1; py++) {
        const rowBase = py * sw
        for (let px = x0; px < x1; px++) {
          const i = (rowBase + px) * 4
          const a = data[i + 3] / 255
          const rr = data[i] * a + 255 * (1 - a)
          const gg = data[i + 1] * a + 255 * (1 - a)
          const bb = data[i + 2] * a + 255 * (1 - a)
          r += rr
          g += gg
          b += bb
          n++
          const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb
          if (lum < minLum) {
            minLum = lum
            minR = rr
            minG = gg
            minB = bb
          }
          if (lum < DARK_LUM) darkCount++
        }
      }
      r /= n
      g /= n
      b /= n
      // Preserve thin dark details: when a cell contains a clearly darker
      // region than its average (a thin line crossing the cell), pull the cell
      // toward the darkest pixel so whiskers / outlines survive downscaling.
      if (protectDark > 0 && darkCount > 0) {
        const meanLum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        const gap = meanLum - minLum
        if (gap > 40 && minLum < DARK_LUM) {
          const coverage = Math.min(1, darkCount / n / 0.12)
          const strength = protectDark * coverage * Math.min(1, gap / 90)
          if (strength > 0.02) {
            r = r * (1 - strength) + minR * strength
            g = g * (1 - strength) + minG * strength
            b = b * (1 - strength) + minB * strength
          }
        }
      }
      if (saturate !== 1) {
        const [sr, sg, sb] = boostSaturation(r, g, b, saturate)
        r = sr
        g = sg
        b = sb
      }
      // contrast: stretch around 128
      if (contrast !== 0) {
        const f = 1 + contrast / 100
        r = (r - 128) * f + 128
        g = (g - 128) * f + 128
        b = (b - 128) * f + 128
      }
      const o = (y * width + x) * 4
      out[o] = Math.max(0, Math.min(255, r))
      out[o + 1] = Math.max(0, Math.min(255, g))
      out[o + 2] = Math.max(0, Math.min(255, b))
      out[o + 3] = 255
    }
  }
  return out
}


/**
 * Auto-detect background color by sampling the four corners of a downscaled copy
 * and taking the median of the corner averages.
 */
export function detectBackgroundColor(
  img: HTMLImageElement,
  src?: { x: number; y: number; w: number; h: number } | null
): [number, number, number] {
  const S = 64
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  if (src && src.w > 0 && src.h > 0) {
    ctx.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, S, S)
  } else {
    ctx.drawImage(img, 0, 0, S, S)
  }
  const d = ctx.getImageData(0, 0, S, S).data
  // Sample the outer ring of the downscaled image and pick the most frequent color
  const ring = 4
  const bins = new Map<number, { r: number; g: number; b: number; n: number }>()
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const onEdge = x < ring || y < ring || x >= S - ring || y >= S - ring
      if (!onEdge) continue
      const i = (y * S + x) * 4
      const r = d[i]
      const g = d[i + 1]
      const b = d[i + 2]
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      const cur = bins.get(key)
      if (cur) {
        cur.r += r
        cur.g += g
        cur.b += b
        cur.n++
      } else {
        bins.set(key, { r, g, b, n: 1 })
      }
    }
  }
  let best: { r: number; g: number; b: number; n: number } | null = null
  for (const v of bins.values()) {
    if (!best || v.n > best.n) best = v
  }
  if (!best) return [255, 255, 255]
  const rgb: [number, number, number] = [
    Math.round(best.r / best.n),
    Math.round(best.g / best.n),
    Math.round(best.b / best.n)
  ]
  // 近白色吸附到纯白（截图/图片白底常有轻微色偏，避免背景清不干净）
  if (ciede2000(rgbToLab(rgb[0], rgb[1], rgb[2]), rgbToLab(255, 255, 255)) < 12) {
    return [255, 255, 255]
  }
  return rgb
}

/** Convenience: convert a hex color string to BackgroundConfig */
export function backgroundFromHex(hex: string, threshold: number): BackgroundConfig {
  const { r, g, b } = hexToRgb(hex)
  return { rgb: [r, g, b], threshold }
}

/** Convenience: convert a detected RGB triple to hex */
export function rgbTripleToHex(rgb: [number, number, number]): string {
  return rgbToHex(rgb[0], rgb[1], rgb[2])
}

/** Crop empty ('.') borders around the pattern. Returns null when everything is empty. */
export function cropEmptyBorders(rows: string[][]): { rows: string[][]; x: number; y: number; w: number; h: number } | null {
  const height = rows.length
  if (height === 0) return null
  const width = rows[0].length
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const row = rows[y] ?? []
    for (let x = 0; x < width; x++) {
      const c = row[x]
      if (c && c !== '.') {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return null
  const out = rows.slice(minY, maxY + 1).map((r) => r.slice(minX, maxX + 1))
  return { rows: out, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Build a boolean mask: true where the cell color is close to the background color */
export function buildBgMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  bg: BackgroundConfig
): boolean[][] {
  const bgLab = rgbToLab(bg.rgb[0], bg.rgb[1], bg.rgb[2])
  const mask: boolean[][] = []
  for (let y = 0; y < height; y++) {
    const row: boolean[] = []
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const lab = rgbToLab(pixels[i], pixels[i + 1], pixels[i + 2])
      row.push(ciede2000(lab, bgLab) < bg.threshold)
    }
    mask.push(row)
  }
  return mask
}

/**
 * Empty the outer connected background only (flood fill from the borders through bg-like cells).
 * Interior same-color regions enclosed by the pattern stay as beads.
 */
export function emptyOuterBackground(rows: string[][], mask: boolean[][]): string[][] {
  const h = rows.length
  const w = h > 0 ? rows[0].length : 0
  if (h === 0 || w === 0) return rows
  const visited: boolean[][] = Array.from({ length: h }, () => new Array<boolean>(w).fill(false))
  const queue: [number, number][] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((y === 0 || y === h - 1 || x === 0 || x === w - 1) && mask[y][x] && !visited[y][x]) {
        visited[y][x] = true
        queue.push([x, y])
      }
    }
  }
  while (queue.length > 0) {
    const [x, y] = queue.pop()!
    rows[y][x] = '.'
    const neighbors: [number, number][] = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1]
    ]
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      if (!visited[ny][nx] && mask[ny][nx]) {
        visited[ny][nx] = true
        queue.push([nx, ny])
      }
    }
  }
  return rows
}

/** ???????????????? */

/** 统计每种颜色（色号）的使用颗数 */
export function computeUsedCounts(rows: string[][]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const c of row) {
      if (c && c !== '.') counts.set(c, (counts.get(c) ?? 0) + 1)
    }
  }
  return counts
}

export interface MergeOptions {
  /** CIEDE2000 色差阈值：低于该值视为相似色并合并到使用最多的一色；0 表示关闭 */
  mergeThreshold: number
  /** 使用颗数低于该值的颜色合并到最近的其他颜色（去杂色）；0 表示关闭 */
  noiseMinCount: number
}

export interface MergeRecord {
  from: string
  to: string
  count: number
}

/**
 * 颜色合并 + 去杂色：
 *  - mergeThreshold>0 时，把彼此很接近的颜色合并到使用最多的代表色（减少色号数）；
 *  - noiseMinCount>1 时，把用量过少（如 1~2 颗）的颜色替换为最近的其他颜色（去掉杂色）。
 * 返回新的 rows（不修改原数组）与合并记录。
 */
export function mergePatternColors(
  rows: string[][],
  palette: BeadPalette,
  opts: MergeOptions
): { rows: string[][]; merged: MergeRecord[] } {
  const counts = computeUsedCounts(rows)
  const codes = [...counts.keys()]
  if (codes.length <= 1) return { rows: rows.map((r) => [...r]), merged: [] }
  const byCode = new Map<string, BeadColor>(palette.colors.map((c) => [c.code, c]))
  const labOf = (code: string): [number, number, number] => {
    const c = byCode.get(code)
    return c ? rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2]) : [0, 0, 0]
  }
  const map = new Map<string, string>() // from -> to
  const sorted = [...codes].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))

  // 第一步：合并相似色（代表色 = 组内使用最多、最先出现的颜色）
  if (opts.mergeThreshold > 0) {
    const reps: string[] = []
    for (const code of sorted) {
      if (map.has(code)) continue
      let best = ''
      let bestD = Infinity
      for (const rep of reps) {
        const d = ciede2000(labOf(code), labOf(rep))
        if (d < bestD) {
          bestD = d
          best = rep
        }
      }
      if (best && bestD <= opts.mergeThreshold) map.set(code, best)
      else reps.push(code)
    }
  }

  // 第二步：去杂色（用量过少 -> 最近的其他颜色）
  if (opts.noiseMinCount > 1) {
    const keep = codes.filter((c) => (counts.get(c) ?? 0) >= opts.noiseMinCount)
    const pool = keep.length > 0 ? keep : codes
    for (const code of sorted) {
      if (map.has(code)) continue
      if ((counts.get(code) ?? 0) >= opts.noiseMinCount) continue
      let best = ''
      let bestD = Infinity
      for (const other of pool) {
        if (other === code) continue
        const d = ciede2000(labOf(code), labOf(other))
        if (d < bestD) {
          bestD = d
          best = other
        }
      }
      if (best) map.set(code, best)
    }
  }

  const merged: MergeRecord[] = []
  for (const [from, to] of map) {
    if (from !== to) merged.push({ from, to, count: counts.get(from) ?? 0 })
  }
  if (merged.length === 0) return { rows: rows.map((r) => [...r]), merged: [] }
  const out = rows.map((r) => r.map((c) => (c && c !== '.' && map.has(c) ? map.get(c)! : c)))
  return { rows: out, merged }
}

/**
 * 按重映射表替换颜色：key 为原色号，value 为目标色号或 '.'（留空）。
 * 值为空字符串或不在表中的色号保持原样。返回新的 rows（不修改原数组）。
 */
export function applyRemap(rows: string[][], remap: Record<string, string>): string[][] {
  const keys = Object.keys(remap).filter((k) => remap[k] !== undefined && remap[k] !== '')
  if (keys.length === 0) return rows
  return rows.map((r) => r.map((c) => (c && c !== '.' && c in remap ? remap[c] : c)))
}

/** 计算某个颜色在整张图纸里最近的其他已用颜色（用于「自动→最近色」） */
export function nearestUsedCode(
  code: string,
  used: string[],
  palette: BeadPalette
): string | null {
  const byCode = new Map<string, BeadColor>(palette.colors.map((c) => [c.code, c]))
  const a = byCode.get(code)
  if (!a) return null
  const labA = rgbToLab(a.rgb[0], a.rgb[1], a.rgb[2])
  let best = ''
  let bestD = Infinity
  for (const other of used) {
    if (other === code) continue
    const c = byCode.get(other)
    if (!c) continue
    const d = ciede2000(labA, rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2]))
    if (d < bestD) {
      bestD = d
      best = other
    }
  }
  return best || null
}

/** 构建最近色表；可排除指定色号（如"只用豆仓里的颜色"）。若全部被排除则回退到完整色表。 */
export function buildTableExcluding(palette: BeadPalette, exclude?: Set<string> | null): LabColor[] {
  const colors =
    exclude && exclude.size > 0 ? palette.colors.filter((c) => !exclude.has(c.code)) : palette.colors
  if (colors.length === 0) return buildLabTable(palette)
  return colors.map((c) => ({ code: c.code, hex: c.hex, lab: rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2]) }))
}

/**
 * 跨品牌色卡转换：把一张图纸的色号按颜色最近匹配重新映射到目标色卡。
 * sourcePalette 为图纸当前使用的色卡（通常 getPalette(pattern.paletteId)）。
 * 返回新 Pattern（paletteId 改为目标色卡，rows 重新映射），不修改原图纸。
 */
export function convertPatternPalette(pattern: Pattern, sourcePalette: BeadPalette, targetPalette: BeadPalette): Pattern {
  const table = buildLabTable(targetPalette)
  const srcByCode = new Map<string, BeadColor>(sourcePalette.colors.map((c) => [c.code, c]))
  const cache = new Map<string, string>()
  const mapCode = (code: string): string => {
    if (code === '.' || code === '') return code
    const hit = cache.get(code)
    if (hit) return hit
    // 若目标色卡本身就有该色号，直接保留
    if (targetPalette.colors.some((c) => c.code === code)) {
      cache.set(code, code)
      return code
    }
    const c = srcByCode.get(code)
    let mapped = code
    if (c) {
      mapped = nearestCode(rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2]), table)
    }
    cache.set(code, mapped)
    return mapped
  }
  const rows = pattern.rows.map((r) => r.map(mapCode))
  return { ...pattern, paletteId: targetPalette.id, rows }
}

/**
 * 颜色数上限：把整张图纸的颜色合并到最多 maxColors 种。
 * 通过逐步提高相似色合并阈值实现（保证视觉上尽量接近原图），返回新 rows 与合并记录。
 * 颜色数已 <= maxColors 时原样返回（复制数组）。
 */
export function limitColorCount(
  rows: string[][],
  palette: BeadPalette,
  maxColors: number
): { rows: string[][]; merged: MergeRecord[] } {
  if (maxColors <= 0) return { rows: rows.map((r) => [...r]), merged: [] }
  let current = { rows: rows.map((r) => [...r]), merged: [] as MergeRecord[] }
  let codes = new Set(computeUsedCounts(current.rows).keys())
  let threshold = 2
  while (codes.size > maxColors && threshold <= 60) {
    const res = mergePatternColors(current.rows, palette, { mergeThreshold: threshold, noiseMinCount: 0 })
    current = { rows: res.rows, merged: [...current.merged, ...res.merged] }
    codes = new Set(computeUsedCounts(current.rows).keys())
    threshold += 2
  }
  return current
}

/**
 * 深色描边：把图案外边缘（紧邻空白/背景的格子）统一替换为色卡中最深的颜色。
 * 让轮廓粗而完整（类似卡通描边效果），Hello Kitty 这类带黑边的图效果最佳。
 * 返回新 rows（不修改原数组）。
 */
export function applyOutline(rows: string[][], palette: BeadPalette): string[][] {
  const h = rows.length
  const w = h > 0 ? rows[0].length : 0
  if (h === 0 || w === 0) return rows
  // 找色卡里最深的颜色
  let darkest = palette.colors[0]
  let minLum = Infinity
  for (const c of palette.colors) {
    const lum = 0.2126 * c.rgb[0] + 0.7152 * c.rgb[1] + 0.0722 * c.rgb[2]
    if (lum < minLum) {
      minLum = lum
      darkest = c
    }
  }
  const out = rows.map((r) => [...r])
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = out[y][x]
      if (!c || c === '.') continue
      const isEdge =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        (rows[y][x - 1] ?? '.') === '.' ||
        (rows[y][x + 1] ?? '.') === '.' ||
        (rows[y - 1]?.[x] ?? '.') === '.' ||
        (rows[y + 1]?.[x] ?? '.') === '.'
      if (isEdge) out[y][x] = darkest.code
    }
  }
  return out
}

/**
 * 去杂点：把 8 连通的孤立小色块（噪声）替换成周围出现最多的颜色。
 * 卡通胡须/轮廓是较长的连通区域，不会被误删。
 */
export function removeSpeckles(rows: string[][], minCluster = 3): string[][] {
  const h = rows.length
  if (h === 0) return rows
  const w = rows[0].length
  if (w === 0) return rows
  const out = rows.map((r) => [...r])
  const visited = new Uint8Array(w * h)
  const stack: number[] = []
  const cluster: number[] = []
  const inside = (nx: number, ny: number) => nx >= 0 && ny >= 0 && nx < w && ny < h
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (visited[idx]) continue
      const code = rows[y][x]
      if (!code || code === '.') {
        visited[idx] = 1
        continue
      }
      visited[idx] = 1
      stack.length = 0
      cluster.length = 0
      stack.push(idx)
      while (stack.length > 0) {
        const i = stack.pop()!
        cluster.push(i)
        const cx = i % w
        const cy = (i / w) | 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = cx + dx
            const ny = cy + dy
            if (!inside(nx, ny)) continue
            const j = ny * w + nx
            if (!visited[j] && rows[ny][nx] === code) {
              visited[j] = 1
              stack.push(j)
            }
          }
        }
      }
      if (cluster.length < minCluster) {
        for (const i of cluster) {
          const cx = i % w
          const cy = (i / w) | 0
          const votes = new Map<string, number>()
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue
              const nx = cx + dx
              const ny = cy + dy
              if (!inside(nx, ny)) continue
              const nc = rows[ny][nx]
              if (!nc || nc === '.' || nc === code) continue
              votes.set(nc, (votes.get(nc) || 0) + 1)
            }
          }
          let best = ''
          let bestN = 0
          for (const [c, n] of votes) if (n > bestN) {
            bestN = n
            best = c
          }
          if (best) out[cy][cx] = best
        }
      }
    }
  }
  return out
}
