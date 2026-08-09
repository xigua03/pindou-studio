import type { BeadPalette, ColorUsage, Pattern } from '../types'
import { contrastText } from './color'
import qrcode from 'qrcode-generator'

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

  /** board reference line interval (cells): >0 draws thick red board-boundary lines */
  boardSize?: number
  /** show row/column coordinate numbers on the edges */
  showCoords?: boolean
}

/** 把图纸渲染到 canvas（返回 canvas 与下载用的 dataURL） */

/** Coordinate font size (px) for the row/column numbers. */
function coordFontSize(cellSize: number): number {
  return Math.max(8, Math.round(cellSize * 0.45))
}

/** Estimated pixel width of the largest coordinate number at the given cell size. */
function coordNumberWidth(cellSize: number, maxCoord: number): number {
  const fs = coordFontSize(cellSize)
  return String(maxCoord).length * fs * 0.62
}

/** Coordinate strip width (px) needed to fully show the largest row/column number. */
export function coordStripWidth(cellSize: number, maxCoord: number): number {
  return Math.max(cellSize, Math.ceil(coordNumberWidth(cellSize, maxCoord) + 8))
}

/** Whether every cell should be numbered (false -> number every 5 cells to avoid overlap). */
function coordNumberEveryCell(cellSize: number, maxCoord: number): boolean {
  return coordNumberWidth(cellSize, maxCoord) <= cellSize
}

/** Draw a coordinate frame for a pattern region: reference lines (every 5 cells
 *  and every boardSize cells) plus row/column numbers along the top and left edges.
 *  The strip is sized automatically so multi-digit numbers (>99) are never clipped. */
export function drawCoordFrame(
  ctx: CanvasRenderingContext2D,
  pattern: Pattern,
  cellSize: number,
  ox: number,
  oy: number,
  region: { x: number; y: number; w: number; h: number },
  opts: { boardSize?: number; minorEvery?: number; strip?: number } = {}
): void {
  const { boardSize = 0, minorEvery = 5 } = opts
  const { x: rx, y: ry, w: rw, h: rh } = region
  const maxCoord = Math.max(rx + rw, ry + rh)
  const strip = opts.strip ?? coordStripWidth(cellSize, maxCoord)
  const stepX = coordNumberEveryCell(cellSize, maxCoord) ? 1 : 5
  const fontSize = coordFontSize(cellSize)
  ctx.save()
  // minor reference lines every 5 cells (faint red, like perlerbeads)
  if (minorEvery > 1) {
    ctx.strokeStyle = 'rgba(224,36,36,0.55)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    for (let cx = minorEvery; cx < pattern.width; cx += minorEvery) {
      if (cx <= rx || cx >= rx + rw) continue
      const px = ox + (cx - rx) * cellSize
      ctx.moveTo(px, oy)
      ctx.lineTo(px, oy + rh * cellSize)
    }
    for (let cy = minorEvery; cy < pattern.height; cy += minorEvery) {
      if (cy <= ry || cy >= ry + rh) continue
      const py = oy + (cy - ry) * cellSize
      ctx.moveTo(ox, py)
      ctx.lineTo(ox + rw * cellSize, py)
    }
    ctx.stroke()
  }
  // 板边界线：用蓝色虚线区分，避免与 5x5 网格线混淆（明确表示板边缘而非网格线）
  if (boardSize > 1) {
    ctx.save()
    ctx.strokeStyle = 'rgba(37,99,235,0.9)'
    ctx.lineWidth = Math.max(2, cellSize * 0.14)
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    for (let bx = boardSize; bx < pattern.width; bx += boardSize) {
      if (bx <= rx || bx >= rx + rw) continue
      const px = ox + (bx - rx) * cellSize
      ctx.moveTo(px, oy)
      ctx.lineTo(px, oy + rh * cellSize)
    }
    for (let by = boardSize; by < pattern.height; by += boardSize) {
      if (by <= ry || by >= ry + rh) continue
      const py = oy + (by - ry) * cellSize
      ctx.moveTo(ox, py)
      ctx.lineTo(ox + rw * cellSize, py)
    }
    ctx.stroke()
    ctx.restore()
  }
  // row / column coordinate numbers
  if (strip > 0) {
    ctx.font = `600 ${fontSize}px ui-monospace, "Microsoft YaHei", sans-serif`
    ctx.fillStyle = '#6b7280'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    for (let cx = 0; cx < rw; cx++) {
      // number every cell when it fits, otherwise every 5 cells (plus first & last)
      if (stepX > 1 && cx !== 0 && (cx + 1) % stepX !== 0 && cx !== rw - 1) continue
      ctx.fillText(String(rx + cx + 1), ox + cx * cellSize + cellSize / 2, oy - strip / 2)
    }
    ctx.textAlign = 'right'
    for (let cy = 0; cy < rh; cy++) {
      ctx.fillText(String(ry + cy + 1), ox - 4, oy + cy * cellSize + cellSize / 2)
    }
  }
  ctx.restore()
}

export function patternToCanvas(pattern: Pattern, palette: BeadPalette, opts: RenderOptions = {}): HTMLCanvasElement {
  const {
    cellSize = 16,
    showCodes = false,
    showGrid = true,
    background = '#ffffff',
    padding = 0,
    codeFontScale = 1,
    region,
    showCoords = false,
    boardSize = 0
  } = opts
  const byCode = new Map(palette.colors.map((c) => [c.code, c]))
  const r = region ?? { x: 0, y: 0, w: pattern.width, h: pattern.height }
  const strip = showCoords ? coordStripWidth(cellSize, Math.max(r.x + r.w, r.y + r.h)) : 0
  const leftW = showCoords ? strip : 0
  const topH = showCoords ? strip : 0
  const innerW = r.w * cellSize
  const innerH = r.h * cellSize
  const canvas = document.createElement('canvas')
  canvas.width = leftW + innerW + padding * 2
  canvas.height = topH + innerH + padding * 2
  const ctx = canvas.getContext('2d')!

  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  for (let y = r.y; y < r.y + r.h; y++) {
    const row = pattern.rows[y] ?? []
    for (let x = r.x; x < r.x + r.w; x++) {
      const code = row[x] ?? ''
      const px = padding + leftW + (x - r.x) * cellSize
      const py = padding + topH + (y - r.y) * cellSize
      const isDot = !code || code === '.'
      if (!isDot) {
        const color = byCode.get(code)
        if (color) {
          ctx.fillStyle = color.hex
          ctx.fillRect(px, py, cellSize, cellSize)
        }
        // 色号在小格子（>=5px）也显示，下载图纸/色号统计不丢色号
        if (showCodes && color && cellSize >= 5) {
          const fontSize = Math.max(5, cellSize * 0.38 * codeFontScale)
          ctx.fillStyle = contrastText(color.hex)
          ctx.font = `600 ${fontSize}px system-ui, "Microsoft YaHei", sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          // 色号最多显示前 2 个字符
          const label = code.length > 2 ? code.slice(0, 2) : code
          ctx.fillText(label, px + cellSize / 2, py + cellSize / 2 + 0.5)
        }
      }
      // 空格子也画网格线，方便数出要空几格（外围方格不丢失）
      if (showGrid) {
        ctx.strokeStyle = 'rgba(0,0,0,0.08)'
        ctx.lineWidth = 0.5
        ctx.strokeRect(px + 0.25, py + 0.25, cellSize - 0.5, cellSize - 0.5)
      }
    }
  }
  if (showCoords) {
    drawCoordFrame(ctx, pattern, cellSize, padding + leftW, padding + topH, r, { boardSize, strip })
  }
  return canvas
}

function isTouchMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

type ShareableNavigator = Navigator & {
  canShare?: (data?: ShareData) => boolean
  share?: (data?: ShareData) => Promise<void>
}

/** 移动端优先调起系统分享/存储（iOS Safari 不支持 a[download]），桌面端直接下载 */
async function saveBlob(blob: Blob, filename: string): Promise<void> {
  const nav = navigator as ShareableNavigator
  const mobile = isTouchMobile()
  if (mobile && nav.canShare && nav.share) {
    try {
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' })
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: filename })
        return
      }
    } catch {
      // 用户取消系统分享：视为完成，不再重复触发下载
      return
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    // iOS 无 a[download] 且无法分享时：新窗口打开，便于长按保存
    if (mobile && /iphone|ipad|ipod/i.test(navigator.userAgent)) {
      try {
        window.open(url, '_blank')
      } catch {
        /* ignore */
      }
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
}

export async function downloadCanvas(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  try {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (blob) {
      await saveBlob(blob, filename)
      return
    }
  } catch {
    /* fall through */
  }
  // 兜底：老浏览器用 dataURL
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export async function downloadText(text: string, filename: string, mime = 'text/plain;charset=utf-8'): Promise<void> {
  const blob = new Blob([text], { type: mime })
  await saveBlob(blob, filename)
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
    padding: 12,
    showCoords: opts.showCoords ?? false,
    boardSize: opts.boardSize ?? 0
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

  /** show row/column numbers + board reference lines on the pattern */
  showCoords?: boolean
  boardSize?: number
}

/**
 * 合成"综合图纸"：左侧图案（自动带色号），右侧色号板 + 用豆统计，导出为一张 PNG。
 */
export function renderPatternSheet(pattern: Pattern, palette: BeadPalette, opts: SheetOptions = {}): HTMLCanvasElement {
  const byCode = new Map(palette.colors.map((c) => [c.code, c]))
  const usage = computeColorUsage(pattern)
  const total = usage.reduce((s, u) => s + u.count, 0)

  const cell = opts.cellSize ?? Math.max(10, Math.min(24, Math.floor(1040 / Math.max(pattern.width, 1))))
  const gridCanvas = patternToCanvas(pattern, palette, {
    cellSize: cell,
    showCodes: true,
    showGrid: true,
    background: '#ffffff',
    padding: 6,
    showCoords: opts.showCoords ?? false,
    boardSize: opts.boardSize ?? 0
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

  /** show row/column numbers + board reference lines */
  showCoords?: boolean
  boardSize?: number
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
        region: { x: x0, y: y0, w, h },
        showCoords: opts.showCoords ?? false,
        boardSize: opts.boardSize ?? 0
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

/** 底板布局图：整图按底板尺寸分割，标注每块板编号与边界线，方便规划拼豆顺序 */
export function renderBoardLayout(
  pattern: Pattern,
  palette: BeadPalette,
  opts: { boardSize?: number; cellSize?: number } = {}
): HTMLCanvasElement {
  const boardSize = opts.boardSize ?? 29
  const byCode = new Map(palette.colors.map((c) => [c.code, c]))
  const usage = computeColorUsage(pattern)
  const totalBeads = usage.reduce((s, u) => s + u.count, 0)
  const bx = Math.max(1, Math.ceil(pattern.width / boardSize))
  const by = Math.max(1, Math.ceil(pattern.height / boardSize))
  const totalBoards = bx * by

  const cell = opts.cellSize ?? Math.max(5, Math.min(14, Math.floor(1500 / Math.max(pattern.width, boardSize))))
  const strip = coordStripWidth(cell, Math.max(pattern.width, pattern.height))
  const pad = 16
  const headerH = 58
  const footerH = 26
  const W = pad * 2 + strip + pattern.width * cell
  const H = pad + headerH + strip + pattern.height * cell + footerH + pad

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  const f = (weight: string, size: number) =>
    `${weight} ${size}px "Microsoft YaHei","PingFang SC",sans-serif`

  ctx.fillStyle = '#1f2937'
  ctx.font = f('bold', 20)
  ctx.fillText(`${pattern.name} · 底板布局图`, pad, pad + 22)
  ctx.fillStyle = '#6b7280'
  ctx.font = f('', 12)
  ctx.fillText(
    `${pattern.width} × ${pattern.height} 格 · ${palette.title} · 每板 ${boardSize}×${boardSize} · 共 ${totalBoards} 块板（${bx}×${by}）· 共 ${totalBeads} 颗豆`,
    pad,
    pad + 42
  )

  const gx = pad + strip
  const gy = pad + headerH + strip

  // 格子
  for (let y = 0; y < pattern.height; y++) {
    const row = pattern.rows[y] ?? []
    for (let x = 0; x < pattern.width; x++) {
      const code = row[x] ?? ''
      if (!code || code === '.') continue
      const color = byCode.get(code)
      if (!color) continue
      ctx.fillStyle = color.hex
      ctx.fillRect(gx + x * cell, gy + y * cell, cell, cell)
    }
  }
  // 细网格线
  ctx.strokeStyle = 'rgba(0,0,0,0.08)'
  ctx.lineWidth = 0.5
  ctx.beginPath()
  for (let x = 0; x <= pattern.width; x++) {
    const px = gx + x * cell
    ctx.moveTo(px, gy)
    ctx.lineTo(px, gy + pattern.height * cell)
  }
  for (let y = 0; y <= pattern.height; y++) {
    const py = gy + y * cell
    ctx.moveTo(gx, py)
    ctx.lineTo(gx + pattern.width * cell, py)
  }
  ctx.stroke()

  // 底板边界粗线
  ctx.strokeStyle = 'rgba(224,36,36,0.85)'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let bxi = 1; bxi < bx; bxi++) {
    const px = gx + bxi * boardSize * cell
    ctx.moveTo(px, gy)
    ctx.lineTo(px, gy + pattern.height * cell)
  }
  for (let byi = 1; byi < by; byi++) {
    const py = gy + byi * boardSize * cell
    ctx.moveTo(gx, py)
    ctx.lineTo(gx + pattern.width * cell, py)
  }
  ctx.stroke()

  // 每块板编号（红底白字圆形徽标，居中）
  ctx.font = f('bold', Math.max(10, Math.round(cell * 1.4)))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let n = 1
  for (let byi = 0; byi < by; byi++) {
    for (let bxi = 0; bxi < bx; bxi++) {
      const bw = Math.min(boardSize, pattern.width - bxi * boardSize)
      const bh = Math.min(boardSize, pattern.height - byi * boardSize)
      const cx = gx + bxi * boardSize * cell + (bw * cell) / 2
      const cy = gy + byi * boardSize * cell + (bh * cell) / 2
      const r = Math.max(9, cell * 1.1)
      ctx.fillStyle = 'rgba(224,36,36,0.88)'
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.fillText(String(n), cx, cy + 0.5)
      n++
    }
  }

  // 坐标数字（每 5 格与末尾标注）
  ctx.font = f('', Math.max(7, Math.round(cell * 0.5)))
  ctx.fillStyle = '#6b7280'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let x = 0; x < pattern.width; x++) {
    if (x % 5 === 0 || x === pattern.width - 1) ctx.fillText(String(x + 1), gx + x * cell + cell / 2, gy - strip / 2)
  }
  ctx.textAlign = 'right'
  for (let y = 0; y < pattern.height; y++) {
    if (y % 5 === 0 || y === pattern.height - 1) ctx.fillText(String(y + 1), gx - 4, gy + y * cell + cell / 2)
  }

  // 底部说明
  ctx.fillStyle = '#9ca3af'
  ctx.font = f('', 11)
  ctx.textAlign = 'left'
  ctx.fillText(`拼豆工坊 · ${pattern.name} · 编号从左上角 1 开始，按行递增`, pad, H - pad)
  return canvas
}

/* ---------- 购物清单 ---------- */

export interface ShoppingItem {
  code: string
  hex: string
  count: number
  owned: number
  /** 需购数量 = max(0, 需要 - 已有)；未登记库存时视为 0 */
  need: number
  /** 占整张图纸豆数的百分比（一位小数） */
  pct: number
  status: 'enough' | 'short' | 'none' | 'noData'
}

/** 根据图纸用量 + 豆仓库存计算采购清单（按需购数量从多到少排序） */
export function computeShoppingList(
  pattern: Pattern,
  palette: BeadPalette,
  ownedCount: (code: string) => number
): ShoppingItem[] {
  const byCode = new Map(palette.colors.map((c) => [c.code, c]))
  const usage = computeColorUsage(pattern)
  const total = usage.reduce((s, u) => s + u.count, 0)
  const list: ShoppingItem[] = usage.map((u) => {
    const owned = ownedCount(u.code)
    const need = Math.max(0, u.count - owned)
    const status: ShoppingItem['status'] =
      owned >= u.count ? 'enough' : owned > 0 ? 'short' : 'none'
    const pct = total > 0 ? Math.round((u.count / total) * 1000) / 10 : 0
    return { code: u.code, hex: byCode.get(u.code)?.hex ?? '#cccccc', count: u.count, owned, need, pct, status }
  })
  return list.sort((a, b) => b.need - a.need)
}

/** 打印版购物清单（新窗口，可直接打印/另存 PDF），pricePerBead > 0 时显示单价与小计 */
export function printShoppingList(pattern: Pattern, palette: BeadPalette, items: ShoppingItem[], pricePerBead = 0): void {
  const totalNeed = items.reduce((s, i) => s + i.need, 0)
  const totalCost = pricePerBead > 0 ? totalNeed * pricePerBead : 0
  // 购物清单不再展示单价/小计列，仅在小计行给出预估费用
  const priceTh = ''
  const rows = items
    .map((i) => {
      const badge =
        i.status === 'enough'
          ? '<span style="color:#16a34a">充足</span>'
          : `<span style="color:${i.need > 0 ? '#ea580c' : '#6b7280'}">${i.need > 0 ? `需购 ${i.need}` : '刚好'}</span>`
      const priceTd = ''
      return `<tr>
        <td style="padding:5px 10px;border:1px solid #e5e5e5;"><span style="display:inline-block;width:18px;height:18px;background:${i.hex};border-radius:4px;border:1px solid #ddd;vertical-align:middle;margin-right:6px;"></span></td>
        <td style="padding:5px 10px;border:1px solid #e5e5e5;font-family:Consolas,monospace;">${i.code}</td>
        <td style="padding:5px 10px;border:1px solid #e5e5e5;text-align:right;">${i.count}</td>
        <td style="padding:5px 10px;border:1px solid #e5e5e5;text-align:right;">${i.pct}%</td>
        <td style="padding:5px 10px;border:1px solid #e5e5e5;text-align:right;">${i.owned}</td>
        <td style="padding:5px 10px;border:1px solid #e5e5e5;text-align:right;font-weight:600;">${i.need}</td>
        ${priceTd}
        <td style="padding:5px 10px;border:1px solid #e5e5e5;">${badge}</td>
      </tr>`
    })
    .join('')
  const costLine = pricePerBead > 0
    ? ` · 预估费用 <b style="color:#ea580c">¥${totalCost.toFixed(2)}</b>（单价 ¥${pricePerBead.toFixed(3)}/颗）`
    : ''
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${pattern.name} · 购物清单</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; color: #333; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #999; font-size: 12px; margin-bottom: 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th { background: #fafafa; padding: 6px 10px; border: 1px solid #e5e5e5; text-align: left; }
  td { text-align: left; }
  .total { margin-top: 12px; font-size: 14px; }
</style>
</head>
<body>
  <h1>🛒 购物清单 · ${pattern.name}</h1>
  <div class="meta">${pattern.width}×${pattern.height} 格 · 色卡 ${palette.title} · 共 ${pattern.rows.reduce((s, r) => s + r.filter((c) => c && c !== '.').length, 0)} 颗豆</div>
  <table>
    <tr><th>颜色</th><th>色号</th><th style="text-align:right">需要</th><th style="text-align:right">占比</th><th style="text-align:right">已有</th><th style="text-align:right">需购</th>${priceTh}<th>状态</th></tr>
    ${rows}
  </table>
  <p class="total">共需补购 <b style="color:#ea580c">${totalNeed}</b> 颗豆子${costLine}（未登记库存的按 0 计算）</p>
</body>
</html>`
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 500)
}

/** 购物清单 CSV */
export function exportShoppingCSV(pattern: Pattern, palette: BeadPalette, items: ShoppingItem[], pricePerBead = 0): string {
  const lines = ['色号,颜色,需要,占比%,已有,需购,状态']
  for (const i of items) {
    const status = i.status === 'enough' ? '库存充足' : i.status === 'short' ? '部分缺少' : i.status === 'none' ? '未持有' : '未登记'
    lines.push(`${i.code},${i.hex},${i.count},${i.pct},${i.owned},${i.need},${status}`)
  }
  lines.push('')
  const totalNeed = items.reduce((s, i) => s + i.need, 0)
  lines.push(`合计需购,${totalNeed},,,,`)
  if (pricePerBead > 0) {
    lines.push(`预估费用（单价 ${pricePerBead.toFixed(3)} 元/颗）:${(totalNeed * pricePerBead).toFixed(2)}`)
  }
  return '\uFEFF' + lines.join('\r\n')
}


/** 生成二维码 canvas（白底黑模块），失败返回 null */
function makeQrCanvas(text: string, cellSize = 4, margin = 3): HTMLCanvasElement | null {
  try {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    const n = qr.getModuleCount()
    const c = document.createElement('canvas')
    c.width = (n + margin * 2) * cellSize
    c.height = c.width
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.translate(margin * cellSize, margin * cellSize)
    qr.renderTo2dContext(ctx, cellSize)
    return c
  } catch {
    return null
  }
}

/**
 * 在图纸图片右侧留白边距，小尺寸二维码放在右上角（仿照参考站，无文字无网址）。
 * 适用于「下载图 / 色号版 / 图纸+色号统计」等图片导出。
 */
export function composeWithTopQr(canvas: HTMLCanvasElement, url: string): HTMLCanvasElement {
  const qr = makeQrCanvas(url)
  if (!qr) return canvas
  const pad = 14
  const out = document.createElement('canvas')
  out.width = canvas.width + qr.width + pad * 2
  out.height = canvas.height
  const ctx = out.getContext('2d')
  if (!ctx) return canvas
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(canvas, 0, 0)
  ctx.drawImage(qr, canvas.width + pad, pad)
  return out
}
