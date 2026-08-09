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
      reject(new Error('图片加载失败，请更换图片重试'))
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

/** 大图提速：格数较多时把量化任务交给 Web Worker，避免 CIEDE2000 阻塞主线程 */
const WORKER_MIN_CELLS = 12000
function quantizeImageInWorker(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  palette: BeadPalette,
  mode: GenMode,
  onProgress?: (p: number) => void,
  background?: BackgroundConfig | null,
  exclude?: Set<string> | null
): Promise<{ rows: string[][]; used: Set<string> }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./quantize.worker.ts', import.meta.url), { type: 'module' })
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error('quantize worker timeout'))
    }, 120000)
    worker.onmessage = (e: MessageEvent<{ progress?: number; rows?: string[][]; used?: string[] }>) => {
      const d = e.data
      if (typeof d.progress === 'number') {
        onProgress?.(d.progress)
        return
      }
      if (d.rows && d.used) {
        clearTimeout(timer)
        worker.terminate()
        resolve({ rows: d.rows, used: new Set(d.used) })
      }
    }
    worker.onerror = (e) => {
      clearTimeout(timer)
      worker.terminate()
      reject(e?.message ? new Error(e.message) : new Error('quantize worker error'))
    }
    worker.postMessage({
      pixels,
      width,
      height,
      mode: mode === 'floyd' ? 'floyd' : 'nearest',
      colors: palette.colors.map((c) => ({ code: c.code, rgb: c.rgb })),
      excludeCodes: exclude ? Array.from(exclude) : [],
      background: background ? { rgb: background.rgb, threshold: background.threshold } : null
    })
  })
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
  // 大图提速：格数足够大时优先用 Web Worker，Worker 不可用/失败时回退主线程分块量化
  if (width * height >= WORKER_MIN_CELLS && typeof Worker !== 'undefined') {
    try {
      return await quantizeImageInWorker(pixels, width, height, palette, mode, onProgress, background, exclude)
    } catch {
      /* 回退 */
    }
  }
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

/**
 * 多步高质量降采样：从源图尺寸逐级减半缩到目标尺寸（近似 mipmap / Lanczos 效果），
 * 比一次性 drawImage 保留更多边缘细节，避免糊边。
 */
function drawImageStepped(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw0: number,
  sh0: number,
  dw: number,
  dh: number
) {
  // 目标尺寸接近源尺寸时单次绘制即可（避免多余的开销）
  if (dw * 2 >= sw0 || dh * 2 >= sh0) {
    ctx.drawImage(img, sx, sy, sw0, sh0, 0, 0, dw, dh)
    return
  }
  let tmp = document.createElement('canvas')
  let tw = Math.max(dw, Math.round(sw0 / 2))
  let th = Math.max(dh, Math.round((tw * sh0) / sw0))
  tmp.width = tw
  tmp.height = th
  let tctx = tmp.getContext('2d', { willReadFrequently: true })!
  tctx.imageSmoothingEnabled = true
  tctx.imageSmoothingQuality = 'high'
  tctx.drawImage(img, sx, sy, sw0, sh0, 0, 0, tw, th)
  // 逐级减半，直到接近目标尺寸
  while (tw > dw * 2 || th > dh * 2) {
    const nw = Math.max(dw, Math.round(tw / 2))
    const nh = Math.max(dh, Math.round((nw * th) / tw))
    const next = document.createElement('canvas')
    next.width = nw
    next.height = nh
    const nctx = next.getContext('2d', { willReadFrequently: true })!
    nctx.imageSmoothingEnabled = true
    nctx.imageSmoothingQuality = 'high'
    nctx.drawImage(tmp, 0, 0, tw, th, 0, 0, nw, nh)
    tmp = next
    tctx = nctx
    tw = nw
    th = nh
  }
  ctx.drawImage(tmp, 0, 0, tw, th, 0, 0, dw, dh)
}

/**
 * 判断是否为「像素图/扁平色块图」（像素画、扁平卡通、Logo 等）。
 * 用最近邻缩到 256 宽后统计：相邻像素完全相同比例（平坦度）+ 去重颜色数。
 * 高平坦度 + 少颜色 → 像素图，使用最近邻采样保留锐利边缘（避免平滑缩放产生灰边）。
 */
/** 判断是否为「线条画/简笔画」：背景接近纯色且偏亮、内容以深色细线为主、颜色数很少。
 * 这类图用常规量化容易把细线断成碎点、或被背景色吃掉，需要专门的描边保留路径。 */
export function isLineArt(
  img: HTMLImageElement,
  src?: { x: number; y: number; w: number; h: number } | null
): boolean {
  const S = 160
  const sxx = src && src.w > 0 && src.h > 0 ? src.x : 0
  const syy = src && src.w > 0 && src.h > 0 ? src.y : 0
  const sw0 = src && src.w > 0 && src.h > 0 ? src.w : img.naturalWidth
  const sh0 = src && src.w > 0 && src.h > 0 ? src.h : img.naturalHeight
  if (sw0 <= 0 || sh0 <= 0) return false
  const canvas = document.createElement('canvas')
  const w = S
  const h = Math.max(2, Math.round((S * sh0) / sw0))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sxx, syy, sw0, sh0, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  const colors = new Set<number>()
  const ring = 3
  let bgSum = 0
  let bgN = 0
  let bgSq = 0
  let dark = 0
  let darkSat = 0
  let coloredDark = 0
  let mid = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const r = d[o]
      const g = d[o + 1]
      const b = d[o + 2]
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4))
      const onEdge = x < ring || y < ring || x >= w - ring || y >= h - ring
      if (onEdge) {
        bgSum += lum
        bgN++
        bgSq += lum * lum
      }
      if (lum < 85) {
        dark++
        const mx = Math.max(r, g, b)
        const mn = Math.min(r, g, b)
        darkSat += mx - mn
        if (mx - mn > 120) coloredDark++
      } else if (lum < 205) {
        mid++
      }
    }
  }
  if (bgN === 0) return false
  const bgLum = bgSum / bgN
  const bgStd = Math.sqrt(Math.max(0, bgSq / bgN - bgLum * bgLum))
  // 背景要偏亮（白纸/浅色底）且均匀
  if (bgLum < 190) return false
  if (bgStd > 42) return false
  const total = w * h
  const darkRatio = dark / total
  const midRatio = mid / total
  // 深色线条占比适中
  if (darkRatio < 0.008 || darkRatio > 0.55) return false
  // 中间调（抗锯齿灰边）不能太多
  if (midRatio > 0.3) return false
  // 颜色数要少（线条画/简笔画，抗锯齿会产生少量中间色，放宽到 160）
  if (colors.size > 160) return false
  // 深色像素必须是低饱和的中性色（黑/灰描边），彩色线条不算
  const avgDarkSat = dark > 0 ? darkSat / dark : 0
  if (avgDarkSat > 70) return false
  // 深色里出现较多高饱和色（如红色蝴蝶结）说明是彩色卡通，不是线条画
  if (dark > 0 && coloredDark / dark > 0.12) return false
  return true
}

/** Otsu 阈值：把采样亮度分成前景/背景，返回最佳分界亮度 */
function otsuThreshold(lums: Float64Array, total: number): number {
  const hist = new Float64Array(256)
  for (let i = 0; i < total; i++) {
    const v = Math.max(0, Math.min(255, Math.round(lums[i])))
    hist[v]++
  }
  let sumAll = 0
  for (let t = 0; t < 256; t++) sumAll += t * hist[t]
  let wB = 0
  let sumB = 0
  let bestVar = -1
  let bestT = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    const v = wB * wF * (mB - mF) * (mB - mF)
    if (v > bestVar) {
      bestVar = v
      bestT = t
    }
  }
  return bestT
}

/**
 * 线条画专用采样：把「覆盖到深色描边的格子」整体变成深色（保留连续线条），
 * 纯背景格子输出检测到的背景色（交给背景留空处理）。
 * 输出与 imageToGridColors 相同的 RGBA 网格像素。
 */
function imageToLineArtPixels(
  img: HTMLImageElement,
  width: number,
  height: number,
  src?: { x: number; y: number; w: number; h: number } | null
): Uint8ClampedArray {
  const sxx = src && src.w > 0 && src.h > 0 ? src.x : 0
  const syy = src && src.w > 0 && src.h > 0 ? src.y : 0
  const sw0 = src && src.w > 0 && src.h > 0 ? src.w : img.naturalWidth
  const sh0 = src && src.w > 0 && src.h > 0 ? src.h : img.naturalHeight
  const ss = Math.max(3, Math.min(6, Math.round(1600 / Math.max(width, height))))
  const sw = Math.max(1, Math.round(width * ss))
  const sh = Math.max(1, Math.round(height * ss))
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  drawImageStepped(ctx, img, sxx, syy, sw0, sh0, sw, sh)
  const data = ctx.getImageData(0, 0, sw, sh).data

  // 检测背景色（四角采样取中位亮度像素的平均色）
  const ring = 2
  const bgSamples: number[] = []
  const bgRgb: [number, number, number] = [255, 255, 255]
  {
    let n = 0
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const onEdge = x < ring || y < ring || x >= sw - ring || y >= sh - ring
        if (!onEdge) continue
        const o = (y * sw + x) * 4
        bgSamples.push(data[o] * 0.2126 + data[o + 1] * 0.7152 + data[o + 2] * 0.0722)
        n++
      }
    }
    if (n > 0) {
      // 取亮度中位附近的样本作为背景主色（避免主体贴边污染）
      const sorted = [...bgSamples].sort((a, b) => a - b)
      const med = sorted[Math.floor(sorted.length / 2)]
      let rs2 = 0
      let gs2 = 0
      let bs2 = 0
      let n2 = 0
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const onEdge = x < ring || y < ring || x >= sw - ring || y >= sh - ring
          if (!onEdge) continue
          const o = (y * sw + x) * 4
          const lum = data[o] * 0.2126 + data[o + 1] * 0.7152 + data[o + 2] * 0.0722
          if (Math.abs(lum - med) < 24) {
            rs2 += data[o]
            gs2 += data[o + 1]
            bs2 += data[o + 2]
            n2++
          }
        }
      }
      if (n2 > 0) {
        bgRgb[0] = Math.round(rs2 / n2)
        bgRgb[1] = Math.round(gs2 / n2)
        bgRgb[2] = Math.round(bs2 / n2)
      }
    }
  }

  // 亮度 + Otsu 阈值（限制在背景亮度以下，避免把浅色内容误判成描边）
  const lums = new Float64Array(sw * sh)
  for (let i = 0; i < sw * sh; i++) {
    const o = i * 4
    lums[i] = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]
  }
  let thresh = otsuThreshold(lums, sw * sh)
  const bgLum = 0.2126 * bgRgb[0] + 0.7152 * bgRgb[1] + 0.0722 * bgRgb[2]
  const maxT = Math.max(70, bgLum - 42)
  if (thresh > maxT) thresh = maxT

  const out = new Uint8ClampedArray(width * height * 4)
  const fx = sw / width
  const fy = sh / height
  const COVER_MIN = 0.24
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * fy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * fx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx))
      let darkN = 0
      let totalN = 0
      for (let py = y0; py < y1; py++) {
        const rowBase = py * sw
        for (let px = x0; px < x1; px++) {
          totalN++
          if (lums[rowBase + px] < thresh) darkN++
        }
      }
      const o = (y * width + x) * 4
      const coverage = totalN > 0 ? darkN / totalN : 0
      if (coverage >= COVER_MIN) {
        out[o] = 12
        out[o + 1] = 12
        out[o + 2] = 12
      } else {
        out[o] = bgRgb[0]
        out[o + 1] = bgRgb[1]
        out[o + 2] = bgRgb[2]
      }
      out[o + 3] = 255
    }
  }
  return out
}

/** 修补断线：把「左右或上下都是深色线条、中间空一格」的格子补成深色，让细线连续。 */
export function bridgeLineGaps(rows: string[][], palette: BeadPalette): string[][] {
  const h = rows.length
  const w = h > 0 ? rows[0].length : 0
  if (h === 0 || w === 0) return rows
  const byCode = new Map<string, BeadColor>(palette.colors.map((c) => [c.code, c]))
  const isDark = (code: string | undefined | null): boolean => {
    if (!code || code === '.') return false
    const c = byCode.get(code)
    if (!c) return false
    return 0.2126 * c.rgb[0] + 0.7152 * c.rgb[1] + 0.0722 * c.rgb[2] < 70
  }
  const isLight = (code: string | undefined | null): boolean => {
    if (!code || code === '.') return true
    const c = byCode.get(code)
    if (!c) return false
    return 0.2126 * c.rgb[0] + 0.7152 * c.rgb[1] + 0.0722 * c.rgb[2] > 210
  }
  const out = rows.map((r) => [...r])
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cur = out[y][x]
      if (isDark(cur)) continue
      const l = out[y][x - 1]
      const r = out[y][x + 1]
      const u = out[y - 1]?.[x]
      const d = out[y + 1]?.[x]
      // 横线缺一格 / 竖线缺一格（当前格是空格或浅色时补上）
      if (isLight(cur) && isDark(l) && isDark(r)) {
        out[y][x] = l
        continue
      }
      if (isLight(cur) && isDark(u) && isDark(d)) {
        out[y][x] = u
        continue
      }
    }
  }
  return out
}

export function isPixelArt(
  img: HTMLImageElement,
  src?: { x: number; y: number; w: number; h: number } | null
): boolean {
  const S = 256
  const sxx = src && src.w > 0 && src.h > 0 ? src.x : 0
  const syy = src && src.w > 0 && src.h > 0 ? src.y : 0
  const sw0 = src && src.w > 0 && src.h > 0 ? src.w : img.naturalWidth
  const sh0 = src && src.w > 0 && src.h > 0 ? src.h : img.naturalHeight
  const canvas = document.createElement('canvas')
  const w = S
  const h = Math.max(2, Math.round((S * sh0) / sw0))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, sxx, syy, sw0, sh0, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  const colors = new Set<number>()
  let equal = 0
  let total = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = d[i]
      const g = d[i + 1]
      const b = d[i + 2]
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4))
      if (x > 0) {
        const j = i - 4
        if (d[j] === r && d[j + 1] === g && d[j + 2] === b) equal++
        total++
      }
    }
  }
  const flatness = total > 0 ? equal / total : 0
  return flatness >= 0.45 && colors.size <= 300
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
  protectDark = 0.8,
  brightness = 0,
  lineArt = false
): Uint8ClampedArray {
  // Source region (in image coordinates). When nothing is cropped we use the full image.
  // 线条画专用路径：描边覆盖转深色 + 背景输出背景色，保证细线连续不糊
  if (lineArt) {
    return imageToLineArtPixels(img, width, height, src)
  }
  const sxx = src && src.w > 0 && src.h > 0 ? src.x : 0
  const syy = src && src.w > 0 && src.h > 0 ? src.y : 0
  const sw0 = src && src.w > 0 && src.h > 0 ? src.w : img.naturalWidth
  const sh0 = src && src.w > 0 && src.h > 0 ? src.h : img.naturalHeight

  // 像素图/扁平色块图：用最近邻直接缩到网格尺寸，保留锐利边缘（平滑缩放会把色块边界混出灰边）
  if (isPixelArt(img, src)) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, sxx, syy, sw0, sh0, 0, 0, width, height)
    const data = ctx.getImageData(0, 0, width, height).data
    const out = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      const o = i * 4
      let r = data[o]
      let g = data[o + 1]
      let b = data[o + 2]
      if (brightness !== 0) {
        const off = brightness * 2.55
        r += off
        g += off
        b += off
      }
      if (saturate !== 1) {
        const [sr, sg, sb] = boostSaturation(r, g, b, saturate)
        r = sr
        g = sg
        b = sb
      }
      if (contrast !== 0) {
        const f = 1 + contrast / 100
        r = (r - 128) * f + 128
        g = (g - 128) * f + 128
        b = (b - 128) * f + 128
      }
      out[o] = clamp255(r)
      out[o + 1] = clamp255(g)
      out[o + 2] = clamp255(b)
      out[o + 3] = 255
    }
    return out
  }
  // 采样分辨率：每个输出格子至少保留 supersample^2 个采样点，供「每格主色采样」统计；
  // 大图限制上限，避免内存与耗时爆炸。
  const naturalMax = Math.max(sw0, sh0)
  const SAMPLE_CAP = 1600
  const minCellSamples = Math.max(4, supersample * supersample)
  const sw = Math.max(1, Math.max(width * minCellSamples, Math.min(naturalMax, SAMPLE_CAP)))
  const sh = Math.max(1, Math.round((sw * sh0) / sw0))

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  drawImageStepped(ctx, img, sxx, syy, sw0, sh0, sw, sh)
  const data = ctx.getImageData(0, 0, sw, sh).data
  if (sharpen > 0) unsharp(data, sw, sh, sharpen)

  const out = new Uint8ClampedArray(width * height * 4)
  const fx = sw / width
  const fy = sh / height
  const DARK_LUM = 100 // 该亮度以下的深色像素可能属于细线/描边
  const BUCKET_SHIFT = 3 // 5bit/通道 粗分桶，用于统计每格主色

  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * fy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * fx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx))
      let sumR = 0
      let sumG = 0
      let sumB = 0
      let n = 0
      let minR = 255
      let minG = 255
      let minB = 255
      let minLum = 255
      let darkCount = 0
      const hist = new Map<number, { r: number; g: number; b: number; n: number }>()
      for (let py = y0; py < y1; py++) {
        const rowBase = py * sw
        for (let px = x0; px < x1; px++) {
          const i = (rowBase + px) * 4
          const a = data[i + 3] / 255
          const rr = data[i] * a + 255 * (1 - a)
          const gg = data[i + 1] * a + 255 * (1 - a)
          const bb = data[i + 2] * a + 255 * (1 - a)
          sumR += rr
          sumG += gg
          sumB += bb
          n++
          const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb
          if (lum < minLum) {
            minLum = lum
            minR = rr
            minG = gg
            minB = bb
          }
          if (lum < DARK_LUM) darkCount++
          const key = ((rr >> BUCKET_SHIFT) << 10) | ((gg >> BUCKET_SHIFT) << 5) | (bb >> BUCKET_SHIFT)
          const cur = hist.get(key)
          if (cur) {
            cur.r += rr
            cur.g += gg
            cur.b += bb
            cur.n++
          } else {
            hist.set(key, { r: rr, g: gg, b: bb, n: 1 })
          }
        }
      }
      // 每格主色采样：取格内出现频率最高的颜色（而不是直接平均），
      // 避免色块边界混合出灰边/糊色；顶部主色占比不足时回退到平均值（保留照片渐变）。
      let best: { r: number; g: number; b: number; n: number } | null = null
      for (const v of hist.values()) {
        if (!best || v.n > best.n) best = v
      }
      let r: number
      let g: number
      let b: number
      if (best && n > 0 && best.n / n >= 0.25) {
        r = best.r / best.n
        g = best.g / best.n
        b = best.b / best.n
      } else {
        r = sumR / n
        g = sumG / n
        b = sumB / n
      }
      // 保留细深色线（胡须/描边）：当格内存在明显更深的少数像素时，向最深色拉近
      if (protectDark > 0 && darkCount > 0) {
        const meanLum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        const gap = meanLum - minLum
        if (gap > 40 && minLum < DARK_LUM) {
          const coverage = Math.min(1, darkCount / n)
          const lineLikeness = coverage >= 0.04 && coverage <= 0.6 ? Math.min(1, (coverage + 0.15) / 0.4) : 0
          const strength = protectDark * lineLikeness * Math.min(1, gap / 90)
          if (strength > 0.02) {
            r = r * (1 - strength) + minR * strength
            g = g * (1 - strength) + minG * strength
            b = b * (1 - strength) + minB * strength
          }
        }
      }
      // brightness: additive offset (-50..+50 -> +-127.5)
      if (brightness !== 0) {
        const off = brightness * 2.55
        r += off
        g += off
        b += off
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
/**
 * 估算主体内容占整图宽度的比例（0.3~1）：先把图缩到 96 宽，取四角中位色为背景色，
 * 从边缘泛洪标记连通背景后，计算剩余「非背景」像素的横向包围盒占比。
 * 用于自动选档时补偿纯色背景/白边：让去背景+自动裁剪后的主体实际宽度达到目标档位。
 */
export function estimateContentRatio(img: HTMLImageElement): number {
  const S = 96
  const canvas = document.createElement('canvas')
  const w = S
  const h = Math.max(2, Math.round((S * img.naturalHeight) / img.naturalWidth))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 1
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  const corners: [number, number, number][] = []
  const cornerPts = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1]
  ]
  for (const [x, y] of cornerPts) {
    const o = (y * w + x) * 4
    corners.push([data[o], data[o + 1], data[o + 2]])
  }
  corners.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]))
  const bg = corners[Math.floor(corners.length / 2)] as [number, number, number]
  const bgLab = rgbToLab(bg[0], bg[1], bg[2])
  const TH = 18
  const isBg = (i: number): boolean => {
    const o = i * 4
    return ciede2000(rgbToLab(data[o], data[o + 1], data[o + 2]), bgLab) < TH
  }
  const visited = new Uint8Array(w * h)
  const stack: number[] = []
  const seed = (i: number) => {
    if (!visited[i] && isBg(i)) {
      visited[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < w; x++) {
    seed(x)
    seed((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    seed(y * w)
    seed(y * w + w - 1)
  }
  while (stack.length > 0) {
    const i = stack.pop()!
    const x = i % w
    const y = (i / w) | 0
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const j = ny * w + nx
      if (!visited[j] && isBg(j)) {
        visited[j] = 1
        stack.push(j)
      }
    }
  }
  let minX = w
  let maxX = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!visited[i] && !isBg(i)) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
  }
  if (maxX < minX) return 1
  const ratio = (maxX - minX + 1) / w
  return Math.max(0.3, Math.min(1, ratio))
}

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

/** 从四周边框像素估算背景色（平均色） */
export function detectBorderColor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const i = (y * width + x) * 4
      r += pixels[i]
      g += pixels[i + 1]
      b += pixels[i + 2]
      n++
    }
  }
  for (let y = 1; y < height - 1; y++) {
    for (const x of [0, width - 1]) {
      const i = (y * width + x) * 4
      r += pixels[i]
      g += pixels[i + 1]
      b += pixels[i + 2]
      n++
    }
  }
  if (n === 0) return [255, 255, 255]
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
}

/**
 * 智能抠图：从四周边框与背景色相近的格子出发做泛洪（BFS），
 * 把连通的背景区域标记出来（内部与背景同色的主体区域不会被去掉）。
 */
export function buildBorderBgMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  tol: number
): boolean[][] {
  const bg = detectBorderColor(pixels, width, height)
  const mask: boolean[][] = Array.from({ length: height }, () => new Array<boolean>(width).fill(false))
  const dist = (i: number): number => {
    const dr = pixels[i] - bg[0]
    const dg = pixels[i + 1] - bg[1]
    const db = pixels[i + 2] - bg[2]
    return Math.sqrt(dr * dr + dg * dg + db * db)
  }
  const queue: [number, number][] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
        if (dist((y * width + x) * 4) <= tol) {
          mask[y][x] = true
          queue.push([x, y])
        }
      }
    }
  }
  while (queue.length) {
    const [cx, cy] = queue.pop()!
    for (const [nx, ny] of [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1]
    ] as Array<[number, number]>) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || mask[ny][nx]) continue
      if (dist((ny * width + nx) * 4) <= tol) {
        mask[ny][nx] = true
        queue.push([nx, ny])
      }
    }
  }
  return mask
}

/** 跨品牌色卡转换：把一张图纸的色号按颜色最近匹配重新映射到目标色卡。
 * sourcePalette 为图纸当前使用的色卡（通常 getPalette(pattern.paletteId)）。
 * 返回新 Pattern（paletteId 改为目标色卡，rows 重新映射），不修改原图纸。 */
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
  let out = rows.map((r) => [...r])
  const inside = (nx: number, ny: number) => nx >= 0 && ny >= 0 && nx < w && ny < h

  const collectCluster = (grid: string[][], startIdx: number, code: string, visited: Uint8Array): number[] => {
    const stack = [startIdx]
    const cells: number[] = []
    visited[startIdx] = 1
    while (stack.length > 0) {
      const i = stack.pop()!
      cells.push(i)
      const cx = i % w
      const cy = (i / w) | 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = cx + dx
          const ny = cy + dy
          if (!inside(nx, ny)) continue
          const j = ny * w + nx
          if (!visited[j] && grid[ny][nx] === code) {
            visited[j] = 1
            stack.push(j)
          }
        }
      }
    }
    return cells
  }

  const hasSameNeighbor = (cx: number, cy: number, code: string): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = cx + dx
        const ny = cy + dy
        if (!inside(nx, ny)) continue
        if (out[ny][nx] === code) return true
      }
    }
    return false
  }

  // 最多迭代 5 轮，每轮重新检测小色块
  for (let pass = 0; pass < 5; pass++) {
    const visited = new Uint8Array(w * h)
    let changed = false
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x
        if (visited[idx]) continue
        const code = out[y][x]
        if (!code || code === '.') {
          visited[idx] = 1
          continue
        }
        const cells = collectCluster(out, idx, code, visited)
        if (cells.length >= minCluster) continue
        changed = true
        for (const i of cells) {
          const cx = i % w
          const cy = (i / w) | 0
          const votes = new Map<string, number>()
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue
              const nx = cx + dx
              const ny = cy + dy
              if (!inside(nx, ny)) continue
              const nc = out[ny][nx]
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
          if (!best) {
            // 周围没有其他颜色可替换时直接留空
            out[cy][cx] = '.'
          } else if (hasSameNeighbor(cx, cy, best)) {
            // 替换后若与同色邻居相连则保留，否则留空（避免 1x1 孤立点）
            out[cy][cx] = best
          } else {
            out[cy][cx] = '.'
          }
        }
      }
    }
    if (!changed) break
  }
  return out
}
