/**
 * 大图提速：把 CIEDE2000 量化（nearest / Floyd-Steinberg）移到 Web Worker 中执行，
 * 避免 256x256 级别的大图在量化时卡住主线程。
 * 仅依赖纯函数 color.ts，无 DOM，可由 Vite 直接打包为 worker。
 */
import { rgbToLab, ciede2000 } from './color'

interface WorkerColor {
  code: string
  rgb: [number, number, number]
}
interface LabEntry {
  code: string
  rgb: [number, number, number]
  lab: [number, number, number]
}

interface WorkerQuantizeRequest {
  pixels: Uint8ClampedArray
  width: number
  height: number
  mode: 'nearest' | 'floyd'
  colors: WorkerColor[]
  excludeCodes: string[]
  background: { rgb: [number, number, number]; threshold: number } | null
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

self.onmessage = (e: MessageEvent<WorkerQuantizeRequest>) => {
  const { pixels, width, height, mode, colors, excludeCodes, background } = e.data
  const exclude = new Set(excludeCodes)
  const pool = colors.filter((c) => !exclude.has(c.code))
  const table: LabEntry[] = (pool.length ? pool : colors).map((c) => ({
    code: c.code,
    rgb: c.rgb,
    lab: rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2])
  }))
  const bgLab: [number, number, number] | null = background ? rgbToLab(background.rgb[0], background.rgb[1], background.rgb[2]) : null
  const th = background?.threshold ?? 0

  const isBg = (lab: [number, number, number]): boolean => bgLab !== null && ciede2000(lab, bgLab) < th
  const nearest = (lab: [number, number, number]): string => {
    let best = table[0].code
    let bestD = Infinity
    for (const c of table) {
      const d = ciede2000(lab, c.lab)
      if (d < bestD) {
        bestD = d
        best = c.code
      }
    }
    return best
  }

  const rows: string[][] = []
  const used = new Set<string>()
  const report = (y: number) => {
    if (y % 8 === 0 || y === height - 1) self.postMessage({ progress: (y + 1) / height })
  }

  if (mode === 'floyd') {
    const byCode = new Map<string, LabEntry>(table.map((c) => [c.code, c]))
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
        if (isBg(lab)) {
          row.push('.')
          continue
        }
        const code = nearest(lab)
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
      report(y)
    }
  } else {
    for (let y = 0; y < height; y++) {
      const row: string[] = []
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const lab = rgbToLab(pixels[idx], pixels[idx + 1], pixels[idx + 2])
        if (isBg(lab)) {
          row.push('.')
          continue
        }
        const code = nearest(lab)
        row.push(code)
        used.add(code)
      }
      rows.push(row)
      report(y)
    }
  }

  self.postMessage({ rows, used: Array.from(used) })
}
