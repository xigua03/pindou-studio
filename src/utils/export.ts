import type { BeadPalette, ColorUsage, Pattern } from '../types'
import { contrastText } from './color'

export function computeColorUsage(pattern: Pattern): ColorUsage[] {
  const map = new Map<string, ColorUsage>()
  for (const row of pattern.rows) {
    for (const code of row) {
      if (code === '.' || code === '') continue
      const cur = map.get(code)
      if (cur) cur.count++
      else map.set(code, { code, hex: '#000000', count: 1 })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

export interface RenderOptions {
  cellSize?: number
  showCodes?: boolean
  showGrid?: boolean
  background?: string | null
  padding?: number
  codeFontScale?: number
  /** ?????????????? A4 ?????????????? */
  region?: { x: number; y: number; w: number; h: number }
}

/** 把图纸渲染到 canvas（返回 canvas 与下载用的 dataURL） */
export function patternToCanvas(pattern: Pattern, palette: BeadPalette, opts: RenderOptions = {}): HTMLCanvasElement {
  const {
    cellSize = 16,
    showCodes = false,
    showGrid = true,
    background = '#ffffff',
    padding = 0,
    codeFontScale = 1,
    region
  } = opts
  const byCode = new Map(palette.colors.map((c) => [c.code, c]))
  const r = region ?? { x: 0, y: 0, w: pattern.width, h: pattern.height }
  const innerW = r.w * cellSize
  const innerH = r.h * cellSize
  const canvas = document.createElement('canvas')
  canvas.width = innerW + padding * 2
  canvas.height = innerH + padding * 2
  const ctx = canvas.getContext('2d')!

  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  for (let y = r.y; y < r.y + r.h; y++) {
    const row = pattern.rows[y] ?? []
    for (let x = r.x; x < r.x + r.w; x++) {
      const code = row[x] ?? ''
      if (!code || code === '.') continue
      const color = byCode.get(code)
      const px = padding + (x - r.x) * cellSize
      const py = padding + (y - r.y) * cellSize
      if (color) {
        ctx.fillStyle = color.hex
        ctx.fillRect(px, py, cellSize, cellSize)
      }
      if (showCodes && color && cellSize >= 10) {
        const fontSize = Math.max(7, cellSize * 0.38 * codeFontScale)
        ctx.fillStyle = contrastText(color.hex)
        ctx.font = `600 ${fontSize}px system-ui, "Microsoft YaHei", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        // 色号最多显示前 2 个字符
        const label = code.length > 2 ? code.slice(0, 2) : code
        ctx.fillText(label, px + cellSize / 2, py + cellSize / 2 + 0.5)
      }
      if (showGrid) {
        ctx.strokeStyle = 'rgba(0,0,0,0.08)'
        ctx.lineWidth = 0.5
        ctx.strokeRect(px + 0.25, py + 0.25, cellSize - 0.5, cellSize - 0.5)
      }
    }
  }
  return canvas
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function downloadText(text: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** 导出用豆统计 CSV（Excel 可直接打开） */
export function exportUsageCSV(pattern: Pattern, palette: BeadPalette): string {
  const byCode = new Map(palette.colors.map((c) => [c.code, c]))
  const usage = computeColorUsage(pattern)
  const lines = ['色号,颜色,数量,备注']
  for (const u of usage) {
    const hex = byCode.get(u.code)?.hex ?? ''
    lines.push(`${u.code},${hex},${u.count},`)
  }
  lines.push('')
  lines.push(`总计豆数,${usage.reduce((s, u) => s + u.count, 0)},,`)
  return '\uFEFF' + lines.join('\r\n')
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'pattern'
}
export function printPattern(pattern: Pattern, palette: BeadPalette, opts: RenderOptions = {}): void {
  const canvas = patternToCanvas(pattern, palette, {
    cellSize: opts.cellSize ?? 18,
    showCodes: opts.showCodes ?? true,
    showGrid: true,
    background: '#ffffff',
    padding: 12
  })
  const img = canvas.toDataURL('image/png')
  const usage = computeColorUsage(pattern)
  const byCode = new Map(palette.colors.map((c) => [c.code, c]))
  const legendHtml = usage
    .map((u) => {
      const hex = byCode.get(u.code)?.hex ?? '#ccc'
      return `<tr>
        <td style="padding:4px 10px;border:1px solid #e5e5e5;"><span style="display:inline-block;width:18px;height:18px;background:${hex};border-radius:4px;border:1px solid #ddd;vertical-align:middle;margin-right:6px;"></span></td>
        <td style="padding:4px 10px;border:1px solid #e5e5e5;text-align:center;">${u.code}</td>
        <td style="padding:4px 10px;border:1px solid #e5e5e5;text-align:center;">${u.count}</td>
      </tr>`
    })
    .join('')
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${pattern.name} · 拼豆图纸</title>
<style>
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; color: #333; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #999; font-size: 12px; margin-bottom: 16px; }
  img.pattern { max-width: 100%; image-rendering: pixelated; }
  table { border-collapse: collapse; margin-top: 16px; font-size: 13px; }
  th { background: #fafafa; padding: 4px 10px; border: 1px solid #e5e5e5; }
</style>
</head>
<body>
  <h1>${pattern.name}</h1>
  <div class="meta">${pattern.width} × ${pattern.height} 格 · 色卡：${palette.title} · 共 ${usage.reduce((s, u) => s + u.count, 0)} 颗豆</div>
  <img class="pattern" src="${img}" />
  <table>
    <tr><th>颜色</th><th>色号</th><th>数量</th></tr>
    ${legendHtml}
  </table>
</body>
</html>`
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 400)
}

export interface SheetOptions {
  cellSize?: number
}

/**
 * 合成"综合图纸"：左侧图案（自动带色号），右侧色号板 + 用豆统计，导出为一张 PNG。
 */
export function renderPatternSheet(pattern: Pattern, palette: BeadPalette, opts: SheetOptions = {}): HTMLCanvasElement {
  const byCode = new Map(palette.colors.map((c) => [c.code, c]))
  const usage = computeColorUsage(pattern)
  const total = usage.reduce((s, u) => s + u.count, 0)

  const cell = opts.cellSize ?? Math.max(6, Math.min(22, Math.floor(840 / Math.max(pattern.width, 1))))
  const gridCanvas = patternToCanvas(pattern, palette, {
    cellSize: cell,
    showCodes: cell >= 10,
    showGrid: true,
    background: '#ffffff',
    padding: 6
  })

  const margin = 24
  const legendW = 360
  const headerH = 86
  const footerH = 46
  const rowH = 30
  const legendHeaderH = 40
  const legendH = Math.max(gridCanvas.height, legendHeaderH + 6 + usage.length * rowH)
  const W = margin + gridCanvas.width + 28 + legendW + margin
  const H = margin + headerH + legendH + footerH + margin

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  const f = (weight: string, size: number, family = '"Microsoft YaHei","PingFang SC",sans-serif') =>
    `${weight} ${size}px ${family}`
  ctx.textBaseline = 'alphabetic'

  // 头部
  ctx.fillStyle = '#1f2937'
  ctx.font = f('bold', 24)
  ctx.fillText(pattern.name, margin, margin + 28)
  ctx.fillStyle = '#6b7280'
  ctx.font = f('', 13)
  ctx.fillText(
    `${pattern.width} × ${pattern.height} 格 · 色卡 ${palette.title} · ${usage.length} 种颜色 · 共 ${total} 颗豆`,
    margin,
    margin + 50
  )
  ctx.fillText(`生成时间：${new Date().toLocaleString('zh-CN')}`, margin, margin + 70)

  const gridX = margin
  const gridY = margin + headerH
  ctx.drawImage(gridCanvas, gridX, gridY)

  // 右侧色号板
  const lx = gridX + gridCanvas.width + 28
  ctx.fillStyle = '#111827'
  ctx.font = f('bold', 16)
  ctx.fillText('色号板 & 用豆统计', lx, gridY + 22)

  ctx.fillStyle = '#6b7280'
  ctx.font = f('', 12)
  ctx.fillText('颜色', lx, gridY + 42)
  ctx.fillText('色号', lx + 56, gridY + 42)
  ctx.fillText('颜色值', lx + 132, gridY + 42)
  ctx.fillText('数量', lx + 230, gridY + 42)
  ctx.strokeStyle = '#e5e7eb'
  ctx.beginPath()
  ctx.moveTo(lx, gridY + 50)
  ctx.lineTo(lx + legendW, gridY + 50)
  ctx.stroke()

  let y = gridY + 50
  for (const u of usage) {
    y += rowH
    const hex = byCode.get(u.code)?.hex ?? '#cccccc'
    ctx.fillStyle = hex
    ctx.fillRect(lx, y - 18, 24, 24)
    ctx.strokeStyle = '#e5e7eb'
    ctx.lineWidth = 1
    ctx.strokeRect(lx, y - 18, 24, 24)
    ctx.fillStyle = '#374151'
    ctx.font = f('bold', 14, 'Consolas,monospace')
    ctx.fillText(u.code, lx + 56, y)
    ctx.fillStyle = '#9ca3af'
    ctx.font = f('', 12, 'Consolas,monospace')
    ctx.fillText(hex.toUpperCase(), lx + 132, y)
    ctx.fillStyle = '#374151'
    ctx.font = f('', 13)
    ctx.fillText(String(u.count), lx + 230, y)
  }

  // 底部
  ctx.strokeStyle = '#e5e7eb'
  ctx.beginPath()
  ctx.moveTo(margin, margin + headerH + legendH + 8)
  ctx.lineTo(W - margin, margin + headerH + legendH + 8)
  ctx.stroke()
  ctx.fillStyle = '#9ca3af'
  ctx.font = f('', 12)
  ctx.fillText(
    `拼豆工坊 · ${pattern.name} · 共 ${total} 颗豆 · 按数量从多到少排列`,
    margin,
    margin + headerH + legendH + footerH - 8
  )

  return canvas
}

export interface TiledPrintOptions {
  /** 每格像素大小，默认 14 */
  cellSize?: number
  /** 每页横向格数；不传按 A4 可打印宽度自动计算 */
  colsPerPage?: number
  /** 每页纵向格数；不传按 A4 可打印高度自动计算 */
  rowsPerPage?: number
}

/**
 * A4 分区打印：把大图纸按 A4 可打印区域切成多页，每页显示一个分区并标注页码/坐标。
 * 打开新窗口后自动调起浏览器打印（可「另存为 PDF」）。
 */
export function printPatternTiled(pattern: Pattern, palette: BeadPalette, opts: TiledPrintOptions = {}): void {
  const cellSize = opts.cellSize ?? 14
  const colsPerPage = opts.colsPerPage ?? Math.floor(700 / cellSize)
  const rowsPerPage = opts.rowsPerPage ?? Math.floor(1000 / cellSize)
  const pagesX = Math.max(1, Math.ceil(pattern.width / colsPerPage))
  const pagesY = Math.max(1, Math.ceil(pattern.height / rowsPerPage))
  const total = pagesX * pagesY
  const usage = computeColorUsage(pattern)
  const totalBeads = usage.reduce((s, u) => s + u.count, 0)

  const pages: string[] = []
  let pageNo = 1
  for (let py = 0; py < pagesY; py++) {
    for (let px = 0; px < pagesX; px++) {
      const x0 = px * colsPerPage
      const y0 = py * rowsPerPage
      const w = Math.min(colsPerPage, pattern.width - x0)
      const h = Math.min(rowsPerPage, pattern.height - y0)
      const canvas = patternToCanvas(pattern, palette, {
        cellSize,
        showCodes: cellSize >= 9,
        showGrid: true,
        background: '#ffffff',
        padding: 4,
        region: { x: x0, y: y0, w, h }
      })
      const img = canvas.toDataURL('image/png')
      const rowLabel = `${y0 + 1}–${y0 + h}`
      const colLabel = `${x0 + 1}–${x0 + w}`
      pages.push(`<div class="page">
  <div class="page-head">${pattern.name} · 第 ${pageNo}/${total} 页　行 ${rowLabel}　列 ${colLabel}</div>
  <img class="tile" src="${img}" alt="page ${pageNo}" />
  <div class="page-foot">${pattern.width}×${pattern.height} 格 · ${palette.title} · ${usage.length} 种颜色 · 共 ${totalBeads} 颗豆</div>
</div>`)
      pageNo++
    }
  }

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${pattern.name} · A4 分区打印</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; color: #333; margin: 0; }
  .page {
    width: 190mm;
    min-height: 277mm;
    display: flex;
    flex-direction: column;
    padding: 2mm 0;
    page-break-after: always;
  }
  .page:last-child { page-break-after: auto; }
  .page-head { font-size: 12px; font-weight: 600; margin-bottom: 3mm; }
  .page-foot { font-size: 10px; color: #999; margin-top: 3mm; }
  img.tile {
    width: 100%;
    max-height: 255mm;
    object-fit: contain;
    image-rendering: pixelated;
    border: 1px solid #eee;
  }
</style>
</head>
<body>
${pages.join('\n')}
</body>
</html>`
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 600)
}
