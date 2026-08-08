/**
 * 拼豆工坊后端（零依赖 Node http 服务）
 * - 跨设备分享：保存/读取/删除 5 位短链接对应的图纸
 * - AI 文生图：调用阿里云百炼（千问）通义万相，按量付费
 *
 * 用法: node server/index.mjs   （默认端口 8787，可用环境变量 PORT 覆盖）
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ quiet: true })
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true })

const PORT = Number(process.env.PORT) || 8787
const DATA_FILE = path.join(__dirname, 'data', 'shares.json')
const API_KEY = process.env.DASHSCOPE_API_KEY || ''
const WANX_MODEL = process.env.WANX_MODEL || 'wanx2.1-t2i-turbo'
const MAX_BODY = 4 * 1024 * 1024 // 4MB

function loadShares() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) } catch { return {} }
}
function saveShares(map) {
  const tmp = DATA_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(map))
  fs.renameSync(tmp, DATA_FILE)
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')) }
      catch { reject(new Error('invalid json')) }
    })
    req.on('error', reject)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 通义万相文生图（异步任务 + 轮询） */
async function text2Image(prompt) {
  const createRes = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable'
    },
    body: JSON.stringify({
      model: WANX_MODEL,
      input: { prompt },
      parameters: { size: '1024*1024', n: 1 }
    })
  })
  const createJson = await createRes.json()
  const taskId = createJson?.output?.task_id
  if (!taskId) throw new Error(JSON.stringify(createJson).slice(0, 400))
  for (let i = 0; i < 90; i++) {
    await sleep(2000)
    const taskRes = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` }
    })
    const taskJson = await taskRes.json()
    const status = taskJson?.output?.task_status
    if (status === 'SUCCEEDED') {
      const url = taskJson?.output?.results?.[0]?.url
      if (url) return url
      throw new Error('AI 生成完成但未取到图片，请重试')
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      const msg = taskJson?.output?.message || status
      // 内容安全审查拦截：给前端友好提示
      if (/inappropriate content|sensitive|unsafe|content.*risk/i.test(msg)) {
        throw new Error('SAFETY:' + msg)
      }
      throw new Error(`AI 生成失败：${msg}`)
    }
  }
  throw new Error('AI 生成超时，请稍后重试')
}

async function urlToBase64(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载图片失败 ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const mime = res.headers.get('content-type') || 'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const p = url.pathname
  const method = req.method

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    })
    res.end()
    return
  }

  try {
    // 健康检查
    if (method === 'GET' && p === '/api/health') {
      sendJson(res, 200, { ok: true, ai: !!API_KEY })
      return
    }
    // 分享读取
    const shareMatch = p.match(/^\/api\/share\/([A-Za-z0-9]{1,64})$/)
    if (method === 'GET' && shareMatch) {
      const id = shareMatch[1]
      const map = loadShares()
      if (!map[id]) return sendJson(res, 404, { error: 'not found' })
      sendJson(res, 200, { id, entry: map[id] })
      return
    }
    // 分享保存 / 覆盖（POST /api/share/:id，body 为 entry；兼容 POST /api/share body={id,entry}）
    if (method === 'POST' && (shareMatch || p === '/api/share')) {
      const body = await readBody(req)
      const id = shareMatch ? shareMatch[1] : String(body.id || '')
      if (!/^[A-Za-z0-9]{5}$/.test(id)) return sendJson(res, 400, { error: 'id 需为 5 位字母数字' })
      const entry = body.entry ?? body
      if (!Array.isArray(entry.rows) || !entry.paletteId) {
        return sendJson(res, 400, { error: 'entry 缺少 rows 或 paletteId' })
      }
      const map = loadShares()
      map[id] = entry
      saveShares(map)
      sendJson(res, 200, { ok: true, id })
      return
    }
    // 分享删除
    if (method === 'DELETE' && shareMatch) {
      const id = shareMatch[1]
      const map = loadShares()
      if (map[id]) { delete map[id]; saveShares(map) }
      sendJson(res, 200, { ok: true })
      return
    }
    // AI 文生图
    if (method === 'POST' && p === '/api/ai/generate') {
      if (!API_KEY) return sendJson(res, 400, { error: '服务端未配置 DASHSCOPE_API_KEY' })
      const body = await readBody(req)
      const prompt = String(body.prompt || '').trim()
      if (!prompt) return sendJson(res, 400, { error: 'prompt 不能为空' })
      const imageUrl = await text2Image(prompt)
      const imageBase64 = await urlToBase64(imageUrl)
      sendJson(res, 200, { ok: true, imageBase64, model: WANX_MODEL })
      return
    }
    sendJson(res, 404, { error: 'not found' })
  } catch (err) {
    sendJson(res, 500, { error: String(err && err.message || err).slice(0, 500) })
  }
})

server.listen(PORT, () => {
  console.log(`pindou server listening on http://localhost:${PORT}`)
})
