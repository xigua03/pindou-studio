/**
 * 图纸库定时采集器：抓取 perlerbeads.net/zh/gallery 的 JSON-LD 条目，
 * 对新条目下载 PNG 图案 -> 解码 -> 按 mard-221 色卡量化 -> 入库（内置图纸）。
 * 纯 Node 实现（zlib + 自写 PNG 解码），无原生依赖。
 */
import https from 'node:https'
import zlib from 'node:zlib'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { db } from './db.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/* ============ CIEDE2000（移植自 src/utils/color.ts） ============ */
function rgbToLab(r, g, b) {
  const f = (t) => { const c = t / 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92 }
  const R = f(r), G = f(g), B = f(b)
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047
  const y = (R * 0.2126729 + G * 0.7151522 + B * 0.072175) / 1
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883
  const g2 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = g2(x), fy = g2(y), fz = g2(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('')
  const n = parseInt(h, 16)
  if (Number.isNaN(n) || h.length !== 6) return [0, 0, 0]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function ciede2000(l1, a1, b1, l2, a2, b2) {
  const C1 = Math.sqrt(a1 * a1 + b1 * b1)
  const C2 = Math.sqrt(a2 * a2 + b2 * b2)
  const Cb = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))))
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2
  const C1p = Math.sqrt(a1p * a1p + b1 * b1), C2p = Math.sqrt(a2p * a2p + b2 * b2)
  const h1p = C1p === 0 ? 0 : ((Math.atan2(b1, a1p) * 180) / Math.PI + 360) % 360
  const h2p = C2p === 0 ? 0 : ((Math.atan2(b2, a2p) * 180) / Math.PI + 360) % 360
  const dLp = l2 - l1, dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    const diff = h2p - h1p
    dhp = diff > 180 ? diff - 360 : diff < -180 ? diff + 360 : diff
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360)
  const Lbp = (l1 + l2) / 2, Cbp = (C1p + C2p) / 2
  let hbp = h1p + h2p
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2
    else hbp = (h1p + h2p) / 2
  }
  const T = 1 - 0.17 * Math.cos(((hbp - 30) * Math.PI) / 180) + 0.24 * Math.cos((2 * hbp * Math.PI) / 180) + 0.32 * Math.cos(((3 * hbp + 6) * Math.PI) / 180) - 0.2 * Math.cos(((4 * hbp - 63) * Math.PI) / 180)
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2))
  const RC = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)))
  const SL = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2))
  const SC = 1 + 0.045 * Cbp
  const SH = 1 + 0.015 * Cbp * T
  const RT = -Math.sin((2 * dTheta * Math.PI) / 180) * RC
  return Math.sqrt(Math.pow(dLp / SL, 2) + Math.pow(dCp / SC, 2) + Math.pow(dHp / SH, 2) + RT * (dCp / SC) * (dHp / SH))
}

/* ============ PNG 解码（8bit 非隔行：灰/RGB/调色板/灰A/RGBA） ============ */
function paeth(a, b, c) {
  const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}
export function decodePng(buf) {
  if (!buf || buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png')
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  if (width * height > 4500000) throw new Error('image too large ' + width + 'x' + height)
  const bitDepth = buf[24]
  const colorType = buf[25]
  const interlace = buf[28]
  if (bitDepth !== 8) throw new Error('unsupported bit depth ' + bitDepth)
  if (interlace !== 0) throw new Error('interlaced png unsupported')
  let bpp = 1
  if (colorType === 6) bpp = 4
  else if (colorType === 2) bpp = 3
  else if (colorType === 4) bpp = 2
  else if (colorType === 3) bpp = 1
  else if (colorType !== 0) throw new Error('unsupported color type ' + colorType)
  const stride = width * bpp
  const idat = []
  let off = 8
  let palette = null
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IDAT') idat.push(data)
    else if (type === 'PLTE' && colorType === 3) {
      palette = []
      for (let i = 0; i + 2 < data.length; i += 3) palette.push([data[i], data[i + 1], data[i + 2]])
    }
    off += 12 + len
    if (type === 'IEND') break
  }
  if (!idat.length) throw new Error('no idat')
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const rgba = Buffer.alloc(width * height * 4)
  const prev = Buffer.alloc(stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos]
    pos++
    const line = Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      const v = raw[pos]
      pos++
      let val
      if (filter === 0) val = v
      else if (filter === 1) val = (v + a) & 255
      else if (filter === 2) val = (v + b) & 255
      else if (filter === 3) val = (v + ((a + b) >> 1)) & 255
      else if (filter === 4) val = (v + paeth(a, b, c)) & 255
      else throw new Error('bad filter ' + filter)
      line[x] = val
    }
    line.copy(prev, 0)
    // 转 RGBA
    for (let x = 0; x < width; x++) {
      const src = x * bpp
      const dst = (y * width + x) * 4
      if (colorType === 6) {
        rgba[dst] = line[src]; rgba[dst + 1] = line[src + 1]; rgba[dst + 2] = line[src + 2]; rgba[dst + 3] = line[src + 3]
      } else if (colorType === 2) {
        rgba[dst] = line[src]; rgba[dst + 1] = line[src + 1]; rgba[dst + 2] = line[src + 2]; rgba[dst + 3] = 255
      } else if (colorType === 0) {
        rgba[dst] = line[src]; rgba[dst + 1] = line[src]; rgba[dst + 2] = line[src]; rgba[dst + 3] = 255
      } else if (colorType === 4) {
        rgba[dst] = line[src]; rgba[dst + 1] = line[src]; rgba[dst + 2] = line[src]; rgba[dst + 3] = line[src + 1]
      } else if (colorType === 3) {
        const pi = line[src] * 3
        const p = palette && palette[line[src]] ? palette[line[src]] : [0, 0, 0]
        rgba[dst] = p[0]; rgba[dst + 1] = p[1]; rgba[dst + 2] = p[2]; rgba[dst + 3] = 255
      }
    }
  }
  return { width, height, rgba }
}

/* ============ 下载 / 抓取 ============ */
function getBuf(url, timeout = 20000) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN,zh;q=0.9' }, timeout }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('http ' + r.statusCode)) }
      const chunks = []
      r.on('data', (c) => chunks.push(c))
      r.on('end', () => res(Buffer.concat(chunks)))
      r.on('error', rej)
    })
    req.on('error', rej)
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
  })
}
function getText(url, timeout = 20000) {
  return getBuf(url, timeout).then((b) => b.toString('utf8'))
}

/** 仅读 PNG 头部获取尺寸（Range 请求），用于下载前跳过超大图 */
export function fetchPngDims(url, timeout = 15000) {
  return new Promise((res) => {
    let done = false
    const finish = (v) => { if (!done) { done = true; res(v) } }
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-40' }, timeout }, (r) => {
      const chunks = []
      r.on('data', (c) => {
        chunks.push(c)
        const b = Buffer.concat(chunks)
        if (b.length >= 33) {
          r.destroy()
          try { finish(b.readUInt32BE(0) === 0x89504e47 ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null) } catch { finish(null) }
        }
      })
      r.on('end', () => finish(null))
      r.on('error', () => finish(null))
    })
    req.on('error', () => finish(null))
    req.on('timeout', () => { req.destroy(); finish(null) })
  })
}

/** 抓取画廊 JSON-LD 条目列表 */
export async function fetchGalleryItems() {
  const body = await getText('https://perlerbeads.net/zh/gallery')
  const items = []
  const re = /\{"@type":"ListItem","position":(\d+),"url":"([^"]*)","item":\{"@type":"CreativeWork","name":"([^"]*)","image":"([^"]*)","description":"([^"]*)","genre":"([^"]*)"/g
  let m
  while ((m = re.exec(body))) {
    items.push({ pos: Number(m[1]), url: m[2], name: m[3], image: m[4], desc: m[5], genre: m[6] })
  }
  return items
}

/** 解析 Next.js RSC payload 字符串（解开 JS 转义） */
function unescapeJsString(s) {
  let out = ''
  for (let k = 0; k < s.length; k++) {
    const ch = s[k]
    if (ch === '\\' && k + 1 < s.length) {
      const nx = s[k + 1]
      if (nx === '"') { out += '"'; k++ }
      else if (nx === '\\') { out += '\\'; k++ }
      else if (nx === '/') { out += '/'; k++ }
      else if (nx === 'b') { out += '\b'; k++ }
      else if (nx === 'f') { out += '\f'; k++ }
      else if (nx === 'n') { out += '\n'; k++ }
      else if (nx === 'r') { out += '\r'; k++ }
      else if (nx === 't') { out += '\t'; k++ }
      else if (nx === 'u') {
        const hex = s.slice(k + 2, k + 6)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); k += 5 }
        else { out += '\\u'; k++ }
      }
      else { out += nx; k++ }
    } else out += ch
  }
  return out
}

/** 抽取并解开所有 self.__next_f.push 数据块，得到 RSC 流文本 */
function extractRscStream(body) {
  let stream = ''
  const re = /self\.__next_f\.push\(\[(\d+),("[^]*?)\]\)/g
  let m
  while ((m = re.exec(body))) {
    const inner = m[2].slice(1, -1)
    stream += unescapeJsString(inner)
  }
  return stream
}

/** 从 RSC 流中提取全部 pattern 对象（平衡 JSON 括号） */
function extractRscObjects(stream) {
  const out = []
  const re = /\{"id":"/g
  let m
  while ((m = re.exec(stream))) {
    const start = m.index
    let depth = 0, i = start, inStr = false, esc = false
    for (; i < stream.length; i++) {
      const ch = stream[i]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
      } else {
        if (ch === '"') inStr = true
        else if (ch === '{') depth++
        else if (ch === '}') { depth--; if (depth === 0) { i++; break } }
      }
    }
    try {
      const obj = JSON.parse(stream.slice(start, i))
      if (obj && obj.id && obj.designImageUrl) out.push(obj)
    } catch (e) { /* 跳过非图纸对象 */ }
  }
  return out
}

/** 抓取 beadpattern.net/gallery 图纸条目（RSC 内嵌 JSON） */
export async function fetchBeadPatternItems() {
  const body = await getText('https://beadpattern.net/gallery', 60000)
  const objs = extractRscObjects(extractRscStream(body))
  return objs.filter((o) => o.status === 'published')
}


/** 抓取 BeadsCanvas /zh/patterns 图纸（Next.js RSC 内嵌 initialPatterns JSON，含完整 gridData） */
export async function fetchBeadCanvasItems() {
  const body = await getText('https://www.beadscanvas.com/zh/patterns', 60000)
  const stream = extractRscStream(body)
  const key = '"initialPatterns":'
  const idx = stream.indexOf(key)
  if (idx < 0) return []
  const start = stream.indexOf('[', idx)
  if (start < 0) return []
  let depth = 0, inStr = false, esc = false, end = -1
  for (let i = start; i < stream.length; i++) {
    const ch = stream[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else {
      if (ch === '"') inStr = true
      else if (ch === '[') depth++
      else if (ch === ']') { depth--; if (depth === 0) { end = i + 1; break } }
    }
  }
  if (end < 0) return []
  try {
    const arr = JSON.parse(stream.slice(start, end))
    return Array.isArray(arr) ? arr.filter((p) => p && p.isPublic !== false) : []
  } catch (e) {
    return []
  }
}

/** 抓取 makebead.com 图纸列表：图库页卡片链接（最新）+ /api/patterns/featured（热门），按 id 去重 */
export async function fetchMakeBeadItems() {
  const seen = new Map()
  // 图库页支持?page=N 分页，每页约 24 张卡片；取前 4 页得到足够的最新图纸
  for (let page = 1; page <= 4; page++) {
    try {
      const body = await getText('https://makebead.com/zh-Hans/patterns?page=' + page, 60000)
      // 卡片链接：/zh-Hans/patterns/p/<slug>-<id>
      const hrefs = body.match(/href="(\/zh-Hans\/patterns\/p\/[^"]+)"/g) || []
      const meta = new Map()
      const blocks = body.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []
      for (const block of blocks) {
        try {
          const ld = JSON.parse(block.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, ''))
          if (ld && ld['@type'] === 'CollectionPage' && Array.isArray(ld.hasPart)) {
            for (const it of ld.hasPart) {
              const m = it && it.url ? String(it.url).match(/-([a-f0-9]{16})\/?$/) : null
              if (m) meta.set(m[1], { name: it.name || '', image: String(it.image || '').replace(/&amp;/g, '&') })
            }
          }
        } catch (e) { /* 跳过单个 JSON-LD */ }
      }
      for (const h of hrefs) {
        const m = h.match(/-([a-f0-9]{16})"?$/)
        if (!m) continue
        const id = m[1]
        const md = meta.get(id) || {}
        seen.set(id, { id, name: md.name || '', image: md.image || 'https://makebead.com/api/patterns/' + id + '/thumbnail.png', tags: [] })
      }
    } catch (e) { /* 单页失败继续下一页 */ }
  }
  // 热门图纸（带 tags 元数据）
  try {
    const body = JSON.parse(await getText('https://makebead.com/api/patterns/featured', 30000))
    for (const it of (body.patterns || [])) {
      if (!it || !it.id) continue
      let tags = []
      try { tags = JSON.parse(it.tags || '[]') } catch (e) { tags = [] }
      seen.set(it.id, {
        id: it.id,
        name: it.title || '',
        url: 'https://makebead.com/zh-Hans/patterns/p/' + (it.slug || it.id) + '-' + it.id,
        image: 'https://makebead.com/api/patterns/' + it.id + '/thumbnail.png',
        tags: Array.isArray(tags) ? tags : []
      })
    }
  } catch (e) { /* 热门接口失败不影响最新列表 */ }
  return Array.from(seen.values())
}


/** 把 makebead 详情接口的 gridData（每格 hex/rgb）映射到 mard-221 色号；为 null 的格子视为空格 */
export function makeBeadGridToRows(gd) {
  const grid = gd && Array.isArray(gd.grid) ? gd.grid : null
  if (!grid || !grid.length) return null
  const pal = loadRefPalette()
  const rows = []
  for (const line of grid) {
    if (!Array.isArray(line)) continue
    const row = []
    for (const cell of line) {
      if (!cell || !Array.isArray(cell.rgb)) { row.push('.'); continue }
      const rgb = cell.rgb
      const lab = rgbToLab(rgb[0], rgb[1], rgb[2])
      let best = null, bestD = Infinity
      for (const c of pal) {
        const d = ciede2000(lab[0], lab[1], lab[2], c.lab[0], c.lab[1], c.lab[2])
        if (d < bestD) { bestD = d; best = c }
      }
      row.push(best ? best.code : '.')
    }
    rows.push(row)
  }
  return rows.length ? rows : null
}

/** 由条目 URL 推导稳定的图纸 id */
function slugFromUrl(url) {
  const parts = String(url || '').replace(/\/+$/, '').split('/')
  let base = parts[parts.length - 1] || 'item'
  base = base.replace(/\.[a-z0-9]{2,5}$/i, '')
  return base.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

/** 载入参考色卡（优先数据库，回退静态 JSON） */
export function loadRefPalette() {
  const rows = db.prepare("SELECT code, hex, r, g, b FROM palette_colors WHERE palette_id = ? ORDER BY sort").all('mard-221-github')
  if (rows && rows.length) {
    return rows.map((c) => ({ code: c.code, hex: c.hex, lab: rgbToLab(c.r, c.g, c.b) }))
  }
  const jsonPath = path.resolve(__dirname, '..', 'src', 'data', 'palettes', 'mard-221-github.json')
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
  return raw.colors.map((c) => ({ code: c.code, hex: c.hex, lab: rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2]) }))
}

/** 裁剪四周空白边距，让图案紧贴内容，底板规划与内容对应 */
export function cropEmptyBorders(rows) {
  const height = rows.length
  if (!height) return { rows, x: 0, y: 0, w: 0, h: 0, cropped: false }
  const width = rows[0].length
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const row = rows[y] || []
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
  if (maxX < minX || maxY < minY) return { rows, x: 0, y: 0, w: width, h: height, cropped: false }
  if (minX === 0 && minY === 0 && maxX === width - 1 && maxY === height - 1) {
    return { rows, x: 0, y: 0, w: width, h: height, cropped: false }
  }
  return {
    rows: rows.slice(minY, maxY + 1).map((r) => r.slice(minX, maxX + 1)),
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    cropped: true
  }
}

/**
 * 把 PNG 图案转成拼豆网格（默认宽度 maxW，比例保持）
 * - 接近白色/低饱和亮色 或透明 视为空格 '.'
 * - 其余按 CIEDE2000 最近色匹配到参考色卡
 */
export function imageToGrid(png, maxW = 96) {
  const { width, height, rgba } = png
  const scale = Math.min(1, maxW / width)
  const gw = Math.max(1, Math.round(width * scale))
  const gh = Math.max(1, Math.round(height * scale))
  const pal = loadRefPalette()
  const rows = []
  for (let y = 0; y < gh; y++) {
    const row = []
    for (let x = 0; x < gw; x++) {
      // 取源区域平均色
      const x0 = Math.floor((x / gw) * width), x1 = Math.max(x0 + 1, Math.floor(((x + 1) / gw) * width))
      const y0 = Math.floor((y / gh) * height), y1 = Math.max(y0 + 1, Math.floor(((y + 1) / gh) * height))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const o = (sy * width + sx) * 4
          r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; a += rgba[o + 3]; n++
        }
      }
      r = r / n; g = g / n; b = b / n; a = a / n
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      // 低饱和亮色（含轻微发灰/发黄的白色背景）视为空格
      if (a < 128 || (mx >= 236 && mx - mn < 16)) { row.push('.'); continue }
      const lab = rgbToLab(r, g, b)
      let best = null, bestD = Infinity
      for (const c of pal) {
        const d = ciede2000(lab[0], lab[1], lab[2], c.lab[0], c.lab[1], c.lab[2])
        if (d < bestD) { bestD = d; best = c }
      }
      row.push(best ? best.code : '.')
    }
    rows.push(row)
  }
  return rows
}

/**
 * 图纸 PNG 转拼豆网格（可选）
 * - native: 当源图是每颗豆一个基块的渲染图时，按原生分辨率提取，保留细节
 */
export function imageToGridOpt(png, { maxW = 96, native = null } = {}) {
  if (native && native.width > 0 && native.height > 0) {
    const sx = png.width / native.width
    const sy = png.height / native.height
    const s = Math.round((sx + sy) / 2)
    if (s >= 2 && Math.abs(sx - s) <= 0.05 && Math.abs(sy - s) <= 0.05 && native.width <= maxW && native.height <= maxW) {
      return imageToGrid(png, native.width)
    }
  }
  return imageToGrid(png, maxW)
}

/** 采集源配置 */
export const COLLECT_SOURCES = ['perler', 'beadpattern', 'beadcanvas', 'makebead']

const SOURCES = {
  perler: {
    label: 'Perler画廊',
    idPrefix: 'perler-',
    maxW: 96,
    native: () => null,
    desc: (w, h) => '拼豆图纸（网格 ' + w + 'x' + h + '）',
    tags: (it) => [it.genre || ''].filter(Boolean),
    idOf: (it) => slugFromUrl(it.image),
    imageOf: (it) => it.image,
    fetch: () => fetchGalleryItems()
  },
  beadpattern: {
    label: 'BeadPattern画廊',
    idPrefix: 'beadpattern-',
    maxW: 180,
    native: (it) => ({ width: Number(it.width) || 0, height: Number(it.height) || 0 }),
    desc: (w, h) => '拼豆图纸（网格 ' + w + 'x' + h + '）',
    tags: (it) => (Array.isArray(it.tags) ? it.tags.slice(0, 6) : []),
    idOf: (it) => String(it.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '') || slugFromUrl(it.designImageUrl),
    imageOf: (it) => it.designImageUrl,
    fetch: () => fetchBeadPatternItems()
  },
  // BeadsCanvas：RSC 直接给出完整 gridData（colorId 网格），无需下载图片
  beadcanvas: {
    label: 'BeadsCanvas图纸库',
    idPrefix: 'beadcanvas-',
    maxW: 220,
    native: () => null,
    desc: (w, h) => '拼豆图纸（网格 ' + w + 'x' + h + '）',
    tags: (it) => (Array.isArray(it.tags) ? it.tags.slice(0, 6) : []),
    idOf: (it) => String(it.id || '').toLowerCase().replace(/[^a-z0-9-]/g, ''),
    imageOf: () => '',
    fetch: () => fetchBeadCanvasItems(),
    // 把 colorId 网格映射到 mard-221 色号；超过 maxW 或解析失败返回 null（走图片路径，无图则跳过）
    toRows: (it) => {
      const grid = Array.isArray(it.gridData) ? it.gridData : null
      if (!grid || !grid.length) return null
      const meta = it.metadata || {}
      const w0 = grid[0]?.length || 0
      if (w0 <= 0 || w0 > 220) return null
      const colorMap = new Map()
      for (const c of (meta.colors || it.colors || [])) {
        if (c && c.colorId && c.hex) colorMap.set(c.colorId, c.hex)
      }
      const pal = loadRefPalette()
      const rows = []
      for (const line of grid) {
        if (!Array.isArray(line)) continue
        const row = []
        for (const cell of line) {
          if (!cell || cell === 'empty') { row.push('.'); continue }
          const hex = colorMap.get(cell) || ''
          if (!hex) { row.push('.'); continue }
          const rgb = hexToRgb(hex)
          const mx = Math.max(rgb[0], rgb[1], rgb[2])
          const mn = Math.min(rgb[0], rgb[1], rgb[2])
          if (mx >= 236 && mx - mn < 16) { row.push('.'); continue }
          const lab = rgbToLab(rgb[0], rgb[1], rgb[2])
          let best = null, bestD = Infinity
          for (const cc of pal) {
            const d = ciede2000(lab[0], lab[1], lab[2], cc.lab[0], cc.lab[1], cc.lab[2])
            if (d < bestD) { bestD = d; best = cc }
          }
          row.push(best ? best.code : '.')
        }
        rows.push(row)
      }
      return rows.length ? rows : null
    }
  },
  // MakeBead：图库页 JSON-LD 列表 + 详情接口直接给完整网格（每格 hex），无需下载图片
  makebead: {
    label: 'MakeBead图纸库',
    idPrefix: 'makebead-',
    maxW: 220,
    native: () => null,
    desc: (w, h) => '拼豆图纸（网格 ' + w + 'x' + h + '）',
    tags: (it) => (Array.isArray(it.tags) ? it.tags.slice(0, 6) : []),
    idOf: (it) => String(it.id || '').toLowerCase().replace(/[^a-z0-9-]/g, ''),
    imageOf: (it) => it.image || '',
    fetch: () => fetchMakeBeadItems(),
    // 详情接口直取完整网格（含每格 hex），映射到 mard-221
    rowsAsync: async (it) => {
      if (!it.id) return null
      const body = await getText('https://makebead.com/api/patterns/' + encodeURIComponent(it.id), 30000)
      const data = JSON.parse(body)
      const p = data && data.pattern
      const gd = p && typeof p.gridData === 'string' ? JSON.parse(p.gridData) : null
      if (!gd) return null
      const rows = makeBeadGridToRows(gd)
      if (rows && rows.length && Array.isArray(p.tags) && p.tags.length) it.tags = p.tags.slice(0, 6)
      return rows
    }
  }
}

/** 由条目生成 mard 色号网格：优先走源自带 toRows（gridData 直取），否则下载 PNG 解码量化 */
async function rowsFromItem(src, it) {
  if (typeof src.rowsAsync === 'function') {
    const rows = await src.rowsAsync(it)
    if (rows && rows.length) return rows
  }
  if (typeof src.toRows === 'function') {
    const rows = src.toRows(it)
    if (rows && rows.length) return rows
  }
  const imageUrl = src.imageOf(it)
  if (!/.png(\?|$)/i.test(imageUrl)) return null
  const dims = await fetchPngDims(imageUrl)
  if (!dims || dims.width * dims.height > 4500000) return null
  const buf = await getBuf(imageUrl)
  const png = decodePng(buf)
  return imageToGridOpt(png, { maxW: src.maxW, native: src.native(it) })
}

/** 单源采集：抓取条目 -> 过滤 -> 新条目 PNG 转换 -> 入库 */
async function collectSource(sourceKey, { limit = 20, excludeTags = [], maxWidth = 0, maxBeads = 0 } = {}) {
  const src = SOURCES[sourceKey]
  const res = { source: sourceKey, label: src.label, total: 0, added: 0, skippedExisting: 0, skippedByFilter: 0, skippedNoPng: 0, errors: 0, errMsgs: [], addedNames: [] }
  const items = await src.fetch()
  res.total = items.length
  const insert = db.prepare(
    'INSERT OR IGNORE INTO patterns (id, user_id, name, description, tags, palette_id, width, height, rows, source, status, is_builtin, difficulty, bead_count, source_label, featured, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)'
  )
  const exclude = (excludeTags || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
  const started = Date.now()
  for (const it of items) {
    if (limit > 0 && res.added >= limit) break
    if (Date.now() - started > 90000) { res.errMsgs.push('超过90s时间预算，停止'); break }
    const id = src.idPrefix + src.idOf(it)
    if (!id || id === src.idPrefix) { res.skippedNoPng++; continue }
    if (db.prepare('SELECT id FROM patterns WHERE id = ?').get(id)) { res.skippedExisting++; continue }
    // 排除标签过滤：条目任意标签包含排除关键词即跳过
    const itTags = (src.tags(it) || []).map((s) => String(s).toLowerCase())
    if (exclude.length && itTags.some((tg) => exclude.some((k) => tg.includes(k)))) { res.skippedByFilter++; continue }
    // 大小预过滤：元数据里有宽高时先按宽度限制跳过，避免无谓下载
    if (maxWidth > 0) {
      const metaW = Number(it.width) || 0
      if (metaW > 0 && metaW > maxWidth) { res.skippedByFilter++; continue }
    }
    try {
      let rows = await rowsFromItem(src, it)
      if (!rows || !rows.length) { res.skippedNoPng++; continue }
      rows = cropEmptyBorders(rows).rows
      const height = rows.length
      const width = height > 0 ? rows[0].length : 0
      let beads = 0
      for (const r of rows) for (const c of r) if (c && c !== '.') beads++
      if (beads < 10) { res.skippedNoPng++; continue }
      if (maxWidth > 0 && width > maxWidth) { res.skippedByFilter++; continue }
      if (maxBeads > 0 && beads > maxBeads) { res.skippedByFilter++; continue }
      const difficulty = beads < 500 ? '简单' : beads <= 2000 ? '中等' : '复杂'
      const tags = JSON.stringify(src.tags(it).filter(Boolean))
      insert.run(id, null, String(it.name || it.title || id).slice(0, 80), src.desc(width, height), tags,
        'mard-221-github', width, height, JSON.stringify(rows), 'builtin', 'published', difficulty, beads, src.label, 0, Date.now(), Date.now())
      res.added++
      res.addedNames.push(String(it.name || it.title || id).slice(0, 80))
    } catch (e) {
      res.errors++
      if (res.errMsgs.length < 5) res.errMsgs.push(String((e && e.message) || e).slice(0, 120))
    }
  }
  return res
}

/** 采集预览：只抓取 + 转换，不写库，返回条目供后台勾选后再导入 */
export async function collectPreviewItems(sourceKey, { limit = 8, excludeTags = [], maxWidth = 0, maxBeads = 0 } = {}) {
  const src = SOURCES[sourceKey]
  if (!src) throw new Error('未知采集源: ' + sourceKey)
  const items = await src.fetch()
  const exclude = (excludeTags || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
  const out = []
  const started = Date.now()
  for (const it of items) {
    if (limit > 0 && out.length >= limit) break
    if (Date.now() - started > 90000) break
    const id = src.idPrefix + src.idOf(it)
    if (!id || id === src.idPrefix) continue
    if (db.prepare('SELECT id FROM patterns WHERE id = ?').get(id)) continue
    const itTags = (src.tags(it) || []).map((s) => String(s).toLowerCase())
    if (exclude.length && itTags.some((tg) => exclude.some((k) => tg.includes(k)))) continue
    if (maxWidth > 0) {
      const metaW = Number(it.width) || 0
      if (metaW > 0 && metaW > maxWidth) continue
    }
    try {
      let rows = await rowsFromItem(src, it)
      if (!rows || !rows.length) continue
      rows = cropEmptyBorders(rows).rows
      const height = rows.length
      const width = height > 0 ? rows[0].length : 0
      let beads = 0
      for (const r of rows) for (const cc of r) if (cc && cc !== '.') beads++
      if (beads < 10) continue
      if (maxWidth > 0 && width > maxWidth) continue
      if (maxBeads > 0 && beads > maxBeads) continue
      out.push({
        id,
        name: String(it.name || it.title || id).slice(0, 80),
        tags: (src.tags(it) || []).filter(Boolean).slice(0, 6),
        rows,
        width,
        height,
        beads,
        difficulty: beads < 500 ? '简单' : beads <= 2000 ? '中等' : '复杂',
        sourceLabel: src.label
      })
    } catch (e) {
      /* 单条失败跳过 */
    }
  }
  return out
}

/** 按后台勾选的预览条目批量入库（幂等：已存在的跳过） */
export function importPreviewItems(items) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO patterns (id, user_id, name, description, tags, palette_id, width, height, rows, source, status, is_builtin, difficulty, bead_count, source_label, featured, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)'
  )
  let added = 0
  let skipped = 0
  for (const it of items || []) {
    const id = String(it.id || '')
    const rows = Array.isArray(it.rows) ? it.rows : null
    if (!id || !rows || !rows.length) { skipped++; continue }
    const height = rows.length
    const width = height > 0 ? rows[0].length : 0
    const tags = JSON.stringify(Array.isArray(it.tags) ? it.tags.filter(Boolean).slice(0, 6) : [])
    const r = insert.run(
      id, null, String(it.name || id).slice(0, 80), '拼豆图纸（网格 ' + width + 'x' + height + '）', tags,
      'mard-221-github', width, height, JSON.stringify(rows), 'builtin', 'published',
      String(it.difficulty || '简单'), Number(it.beads) || 0, String(it.sourceLabel || ''), 0, Date.now(), Date.now()
    )
    if (r.changes > 0) added++; else skipped++
  }
  return { added, skipped }
}

/** 执行一次多源采集（默认全部源） */
export async function collectOnce({ limit = 20, sources = null, excludeTags = [], maxWidth = 0, maxBeads = 0 } = {}) {
  const enabled = Array.isArray(sources) && sources.length ? COLLECT_SOURCES.filter((s) => sources.includes(s)) : COLLECT_SOURCES.slice()
  const results = []
  for (const s of enabled) {
    try {
      results.push(await collectSource(s, { limit, excludeTags, maxWidth, maxBeads }))
    } catch (e) {
      results.push({ source: s, label: s, error: String((e && e.message) || e).slice(0, 120), errMsgs: [] })
    }
  }
  return {
    total: results.reduce((a, r) => a + (r.total || 0), 0),
    added: results.reduce((a, r) => a + (r.added || 0), 0),
    skippedExisting: results.reduce((a, r) => a + (r.skippedExisting || 0), 0),
    skippedByFilter: results.reduce((a, r) => a + (r.skippedByFilter || 0), 0),
    skippedNoPng: results.reduce((a, r) => a + (r.skippedNoPng || 0), 0),
    errors: results.reduce((a, r) => a + (r.errors || 0), 0),
    errMsgs: results.flatMap((r) => r.errMsgs || []).slice(0, 10),
    addedNames: results.flatMap((r) => r.addedNames || []),
    results
  }
}

