import { rgbToLab, ciede2000 } from '../color'
import { isPixelArt } from '../quantize'
import type { ImageAnalysis } from './types'

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

function isLineArtImage(img: HTMLImageElement, src?: { x: number; y: number; w: number; h: number } | null): boolean {
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
  let colored = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const r = d[o]
      const g = d[o + 1]
      const b = d[o + 2]
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const sat = Math.max(r, g, b) - Math.min(r, g, b)
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4))
      const onEdge = x < ring || y < ring || x >= w - ring || y >= h - ring
      if (onEdge) {
        bgSum += lum
        bgN++
        bgSq += lum * lum
      }
      if (lum < 85) {
        dark++
        darkSat += sat
        if (sat > 120) coloredDark++
      } else if (lum < 205) {
        mid++
      }
      if (sat > 55) colored++
    }
  }
  if (bgN === 0) return false
  const bgLum = bgSum / bgN
  const bgStd = Math.sqrt(Math.max(0, bgSq / bgN - bgLum * bgLum))
  if (bgLum < 190 || bgStd > 42) return false
  const total = w * h
  const darkRatio = dark / total
  const midRatio = mid / total
  if (colored / total > 0.15) return false
  if (darkRatio < 0.008 || darkRatio > 0.55) return false
  if (midRatio > 0.3) return false
  if (colors.size > 160) return false
  const avgDarkSat = dark > 0 ? darkSat / dark : 0
  if (avgDarkSat > 70) return false
  if (dark > 0 && coloredDark / dark > 0.12) return false
  return true
}

export function estimateDetailScore(el: HTMLImageElement, src?: { x: number; y: number; w: number; h: number } | null): number {
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
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
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
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
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
  return Math.max(0.3, Math.min(1, (maxX - minX + 1) / w))
}

export function analyzeImage(img: HTMLImageElement, src?: { x: number; y: number; w: number; h: number } | null): ImageAnalysis {
  const lineArt = isLineArtImage(img, src)
  const pixelArt = isPixelArt(img, src)
  return {
    lineArt,
    pixelArt,
    detailScore: estimateDetailScore(img, src),
    contentRatio: estimateContentRatio(img),
  }
}
