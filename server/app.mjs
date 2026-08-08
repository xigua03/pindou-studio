/**
 * Express 应用：用户 / 云同步 / 分享 / AI / 反馈 / 后台管理 API
 */
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, initDb } from './db.mjs'
import { hashPassword, verifyPassword, signToken, auth, adminOnly } from './auth.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ quiet: true })
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true })

const app = express()
app.use(cors())
app.use(express.json({ limit: '12mb' }))

function now() { return Date.now() }
function getIp(req) { return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().slice(0, 64) }
function log(userId, action, detail, req) {
  try {
    db.prepare('INSERT INTO logs (user_id, action, detail, ip, created_at) VALUES (?,?,?,?,?)').run(userId ?? null, String(action).slice(0, 80), detail ? String(detail).slice(0, 500) : null, getIp(req), now())
  } catch { /* ignore */ }
}
function setting(key, def) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return r ? r.value : def
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value))
}
function publicUser(u) {
  return { id: u.id, username: u.username, email: u.email, nickname: u.nickname || u.username, avatar: u.avatar, bio: u.bio, role: u.role, status: u.status, createdAt: u.created_at, lastLoginAt: u.last_login_at }
}
function cleanPattern(p) {
  return p && {
    id: p.id, userId: p.user_id, name: p.name, description: p.description || '',
    tags: safeJson(p.tags, []), paletteId: p.palette_id, width: p.width, height: p.height,
    rows: safeJson(p.rows, []), source: p.source, status: p.status, isBuiltin: !!p.is_builtin,
    difficulty: p.difficulty, beadCount: p.bead_count, createdAt: p.created_at, updatedAt: p.updated_at
  }
}
function safeJson(s, def) { try { return JSON.parse(s) } catch { return def } }

/* ================= 认证 ================= */
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body || {}
  const uname = String(username || '').trim()
  const em = String(email || '').trim().toLowerCase()
  if (!uname || uname.length < 2 || uname.length > 24) return res.status(400).json({ error: '用户名需为 2~24 个字符' })
  if (!/^[A-Za-z0-9_\u4e00-\u9fa5]+$/.test(uname)) return res.status(400).json({ error: '用户名只能包含中文、字母、数字、下划线' })
  if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.status(400).json({ error: '???????' })
  if (!password || password.length < 6 || password.length > 64) return res.status(400).json({ error: '密码需为 6~64 位' })
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(uname)) return res.status(409).json({ error: '用户名已存在' })
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(em)) return res.status(409).json({ error: '邮箱已注册' })
  const info = db.prepare('INSERT INTO users (username, email, password_hash, nickname, role, status, created_at) VALUES (?,?,?,?,?,?,?)').run(uname, em, hashPassword(password), uname, 'user', 'active', now())
  log(info.lastInsertRowid, 'register', '注册账号', req)
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
  res.json({ token: signToken(u), user: publicUser(u) })
})

app.post('/api/auth/login', (req, res) => {
  const { account, password } = req.body || {}
  const acc = String(account || '').trim()
  if (!acc || !password) return res.status(400).json({ error: '请输入账号和密码' })
  const u = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(acc, String(acc).toLowerCase())
  if (!u || !verifyPassword(String(password), u.password_hash)) {
    log(null, 'login_fail', '登录失败: ' + acc, req)
    return res.status(401).json({ error: '账号或密码错误' })
  }
  if (u.status === 'banned') return res.status(403).json({ error: '该账号已被封禁，请联系管理员' })
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), u.id)
  log(u.id, 'login', '登录成功', req)
  res.json({ token: signToken(u), user: publicUser(u) })
})

app.get('/api/auth/me', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.uid)
  if (!u) return res.status(401).json({ error: '用户不存在' })
  if (u.status === 'banned') return res.status(403).json({ error: '该账号已被封禁' })
  res.json({ user: publicUser(u) })
})

app.post('/api/auth/change-password', auth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {}
  if (!newPassword || newPassword.length < 6 || newPassword.length > 64) return res.status(400).json({ error: '新密码需为 6~64 位' })
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.uid)
  if (!u) return res.status(404).json({ error: '用户不存在' })
  if (!verifyPassword(String(oldPassword || ''), u.password_hash)) return res.status(400).json({ error: '原密码不正确' })
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), u.id)
  log(u.id, 'change_password', '修改密码', req)
  res.json({ ok: true })
})

app.post('/api/auth/update-profile', auth, (req, res) => {
  const { nickname, avatar, bio } = req.body || {}
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.uid)
  if (!u) return res.status(404).json({ error: '用户不存在' })
  const nk = String(nickname || '').trim().slice(0, 24) || u.nickname || u.username
  const av = String(avatar || '').trim().slice(0, 500) || u.avatar
  const bi = String(bio || '').trim().slice(0, 200) || u.bio
  db.prepare('UPDATE users SET nickname = ?, avatar = ?, bio = ? WHERE id = ?').run(nk, av, bi, u.id)
  const nu = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)
  res.json({ user: publicUser(nu) })
})

app.post('/api/auth/delete-account', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.uid)
  if (!u) return res.status(404).json({ error: '用户不存在' })
  if (!verifyPassword(String((req.body || {}).password || ''), u.password_hash)) return res.status(400).json({ error: '密码不正确' })
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id)
    db.prepare('DELETE FROM patterns WHERE user_id = ?').run(u.id)
    db.prepare('DELETE FROM favorites WHERE user_id = ?').run(u.id)
    db.prepare('DELETE FROM pattern_groups WHERE user_id = ?').run(u.id)
    db.prepare('DELETE FROM inventory WHERE user_id = ?').run(u.id)
    db.prepare('DELETE FROM shares WHERE user_id = ?').run(u.id)
    db.prepare('DELETE FROM ai_usage WHERE user_id = ?').run(u.id)
    db.prepare('DELETE FROM feedback WHERE user_id = ?').run(u.id)
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  res.json({ ok: true })
})

/* ================= 云同步 ================= */
app.get('/api/sync', auth, (req, res) => {
  const uid = req.user.uid
  const patterns = db.prepare('SELECT * FROM patterns WHERE user_id = ?').all(uid).map(cleanPattern)
  const favorites = db.prepare('SELECT pattern_id FROM favorites WHERE user_id = ?').all(uid).map((r) => r.pattern_id)
  const groups = db.prepare('SELECT * FROM pattern_groups WHERE user_id = ?').all(uid).map((g) => ({ id: g.id, name: g.name, patternIds: safeJson(g.pattern_ids, []) }))
  const inventory = db.prepare('SELECT palette_id, code, count FROM inventory WHERE user_id = ?').all(uid)
  const inv = {}
  for (const row of inventory) {
    if (!inv[row.palette_id]) inv[row.palette_id] = {}
    inv[row.palette_id][row.code] = row.count
  }
  res.json({ patterns, favorites, groups, inventory: inv })
})

app.post('/api/sync/patterns', auth, (req, res) => {
  const uid = req.user.uid
  const list = Array.isArray((req.body || {}).patterns) ? req.body.patterns : []
  const stmt = db.prepare('INSERT OR REPLACE INTO patterns (id, user_id, name, description, tags, palette_id, width, height, rows, source, status, is_builtin, difficulty, bead_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)')
  db.exec('BEGIN')
  try {
    for (const p of list) {
      if (!p || !p.id || !Array.isArray(p.rows)) continue
      let beads = 0
      for (const r of p.rows) for (const c of r) if (c && c !== '.') beads++
      stmt.run(String(p.id), uid, String(p.name || '未命名'), String(p.description || ''), JSON.stringify(p.tags || []),
        String(p.paletteId || ''), Number(p.width) || 0, Number(p.height) || 0, JSON.stringify(p.rows),
        p.source === 'builtin' ? 'edited' : 'user', 'published', p.difficulty || null, beads, now(), now())
    }
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  res.json({ ok: true, count: list.length })
})

app.post('/api/sync/favorites', auth, (req, res) => {
  const uid = req.user.uid
  const list = Array.isArray((req.body || {}).favorites) ? req.body.favorites : []
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM favorites WHERE user_id = ?').run(uid)
    const stmt = db.prepare('INSERT OR IGNORE INTO favorites (user_id, pattern_id, created_at) VALUES (?,?,?)')
    for (const id of list) if (id) stmt.run(uid, String(id), now())
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  res.json({ ok: true, count: list.length })
})

app.post('/api/sync/groups', auth, (req, res) => {
  const uid = req.user.uid
  const list = Array.isArray((req.body || {}).groups) ? req.body.groups : []
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM pattern_groups WHERE user_id = ?').run(uid)
    const stmt = db.prepare('INSERT OR REPLACE INTO pattern_groups (id, user_id, name, pattern_ids, created_at) VALUES (?,?,?,?,?)')
    for (const g of list) if (g && g.id) stmt.run(String(g.id), uid, String(g.name || '未命名分组'), JSON.stringify(Array.isArray(g.patternIds) ? g.patternIds : []), now())
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  res.json({ ok: true, count: list.length })
})

app.post('/api/sync/inventory', auth, (req, res) => {
  const uid = req.user.uid
  const inv = (req.body || {}).inventory || {}
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM inventory WHERE user_id = ?').run(uid)
    const stmt = db.prepare('INSERT OR REPLACE INTO inventory (user_id, palette_id, code, count) VALUES (?,?,?,?)')
    for (const [paletteId, codes] of Object.entries(inv)) {
      if (!codes || typeof codes !== 'object') continue
      for (const [code, count] of Object.entries(codes)) {
        if (Number(count) > 0) stmt.run(uid, String(paletteId), String(code), Number(count) || 0)
      }
    }
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  res.json({ ok: true })
})

/* ================= 分享（增强：访问统计 / 有效期 / 我的链接） ================= */
app.get('/api/share/:id', (req, res) => {
  const id = String(req.params.id || '')
  if (!/^[A-Za-z0-9]{1,64}$/.test(id)) return res.status(400).json({ error: '无效编号' })
  const r = db.prepare('SELECT * FROM shares WHERE id = ?').get(id)
  if (!r) return res.status(404).json({ error: 'not found' })
  if (r.expires_at && r.expires_at < now()) {
    db.prepare('DELETE FROM shares WHERE id = ?').run(id)
    return res.status(404).json({ error: 'not found' })
  }
  db.prepare('UPDATE shares SET visits = visits + 1 WHERE id = ?').run(id)
  res.json({ id, entry: safeJson(r.entry, null) })
})

app.post('/api/share/:id', (req, res) => {
  const id = String(req.params.id || '')
  if (!/^[A-Za-z0-9]{5}$/.test(id)) return res.status(400).json({ error: 'id 需为 5 位字母数字' })
  const entry = (req.body || {}).entry ?? req.body
  if (!entry || !Array.isArray(entry.rows) || !entry.paletteId) return res.status(400).json({ error: 'entry 缺少 rows 或 paletteId' })
  const userId = req.user ? req.user.uid : null
  const expiresAt = entry.expiresAt ? Number(entry.expiresAt) : null
  db.prepare('INSERT OR REPLACE INTO shares (id, user_id, entry, visits, expires_at, created_at) VALUES (?,?,?,?,?,?)').run(id, userId, JSON.stringify(entry), 0, expiresAt, now())
  res.json({ ok: true, id })
})

app.delete('/api/share/:id', auth, (req, res) => {
  const id = String(req.params.id || '')
  const r = db.prepare('SELECT * FROM shares WHERE id = ?').get(id)
  if (!r) return res.json({ ok: true })
  if (req.user.role !== 'admin' && r.user_id !== req.user.uid) return res.status(403).json({ error: '没有权限' })
  db.prepare('DELETE FROM shares WHERE id = ?').run(id)
  res.json({ ok: true })
})

app.get('/api/shares/mine', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM shares WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').all(req.user.uid)
  res.json({ shares: rows.map((r) => ({ id: r.id, visits: r.visits, expiresAt: r.expires_at, createdAt: r.created_at, name: safeJson(r.entry, {}).name || '共享图纸' })) })
})

/* ================= AI（用量记录 + 登录用户额度） ================= */
app.post('/api/ai/generate', async (req, res, next) => {
  try {
    const userId = req.user ? req.user.uid : null
    const prompt = String((req.body || {}).prompt || '').trim()
    if (!prompt) return res.status(400).json({ error: 'prompt 不能为空' })
    // 额度：登录用户按日限额（默认 50）
    if (userId) {
      const limit = Number(setting('ai_daily_limit', '50')) || 50
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
      const used = db.prepare('SELECT COUNT(*) AS c FROM ai_usage WHERE user_id = ? AND created_at >= ?').get(userId, dayStart.getTime())
      if (used.c >= limit) return res.status(429).json({ error: '今日 AI 生成次数已用完，明天再来吧' })
    }
    const model = process.env.WANX_MODEL || 'wanx2.1-t2i-turbo'
    const imageBase64 = await text2Image(prompt)
    db.prepare('INSERT INTO ai_usage (user_id, prompt, model, status, created_at) VALUES (?,?,?,?,?)').run(userId, prompt.slice(0, 300), model, 'ok', now())
    res.json({ ok: true, imageBase64, model })
  } catch (err) {
    const msg = String((err && err.message) || err)
    db.prepare('INSERT INTO ai_usage (user_id, prompt, model, status, created_at) VALUES (?,?,?,?,?)').run(req.user ? req.user.uid : null, String((req.body || {}).prompt || '').slice(0, 300), 'wanx', msg.includes('SAFETY') ? 'blocked' : 'failed', now())
    next(err)
  }
})

async function text2Image(prompt) {
  const model = process.env.WANX_MODEL || 'wanx2.1-t2i-turbo'
  const key = process.env.DASHSCOPE_API_KEY || ''
  if (!key) throw new Error('服务端未配置 AI Key')
  const createRes = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({ model, input: { prompt }, parameters: { size: '1024*1024', n: 1 } })
  })
  const createJson = await createRes.json()
  const taskId = createJson?.output?.task_id
  if (!taskId) throw new Error(JSON.stringify(createJson).slice(0, 300))
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const taskRes = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, { headers: { Authorization: `Bearer ${key}` } })
    const taskJson = await taskRes.json()
    const status = taskJson?.output?.task_status
    if (status === 'SUCCEEDED') {
      const url = taskJson?.output?.results?.[0]?.url
      if (!url) throw new Error('AI 生成完成但未取到图片，请重试')
      const imgRes = await fetch(url)
      if (!imgRes.ok) throw new Error('下载图片失败')
      const buf = Buffer.from(await imgRes.arrayBuffer())
      const mime = imgRes.headers.get('content-type') || 'image/png'
      return `data:${mime};base64,${buf.toString('base64')}`
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      const msg = taskJson?.output?.message || status
      if (/inappropriate content|sensitive|unsafe|content.*risk/i.test(msg)) throw new Error('SAFETY:' + msg)
      throw new Error(`AI 生成失败：${msg}`)
    }
  }
  throw new Error('AI 生成超时，请稍后重试')
}

app.get('/api/ai/usage/mine', auth, (req, res) => {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
  const used = db.prepare('SELECT COUNT(*) AS c FROM ai_usage WHERE user_id = ? AND created_at >= ?').get(req.user.uid, dayStart.getTime())
  const limit = Number(setting('ai_daily_limit', '50')) || 50
  const total = db.prepare('SELECT COUNT(*) AS c FROM ai_usage WHERE user_id = ?').get(req.user.uid)
  res.json({ today: used.c, limit, total: total.c })
})

/* ================= 反馈 ================= */
app.post('/api/feedback', (req, res) => {
  const { content, contact } = req.body || {}
  const c = String(content || '').trim()
  if (!c) return res.status(400).json({ error: '反馈内容不能为空' })
  db.prepare('INSERT INTO feedback (user_id, content, contact, status, created_at) VALUES (?,?,?,?,?)').run(req.user ? req.user.uid : null, c.slice(0, 2000), String(contact || '').slice(0, 120), 'open', now())
  res.json({ ok: true })
})

/* ================= 后台管理 ================= */
app.get('/api/admin/stats', auth, adminOnly, (req, res) => {
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get()
  const patterns = db.prepare('SELECT COUNT(*) AS c FROM patterns').get()
  const userPatterns = db.prepare('SELECT COUNT(*) AS c FROM patterns WHERE user_id IS NOT NULL').get()
  const shares = db.prepare('SELECT COUNT(*) AS c FROM shares').get()
  const shareVisits = db.prepare('SELECT COALESCE(SUM(visits),0) AS c FROM shares').get()
  const aiTotal = db.prepare('SELECT COUNT(*) AS c FROM ai_usage').get()
  const aiToday = db.prepare('SELECT COUNT(*) AS c FROM ai_usage WHERE created_at >= ?').get(new Date().setHours(0, 0, 0, 0))
  const feedbackOpen = db.prepare("SELECT COUNT(*) AS c FROM feedback WHERE status = 'open'").get()
  const logsToday = db.prepare('SELECT COUNT(*) AS c FROM logs WHERE created_at >= ?').get(new Date().setHours(0, 0, 0, 0))
  // 近 7 天注册趋势
  const trend = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0)
    const e = new Date(d); e.setDate(e.getDate() + 1)
    const c = db.prepare('SELECT COUNT(*) AS c FROM users WHERE created_at >= ? AND created_at < ?').get(d.getTime(), e.getTime())
    trend.push({ date: d.toISOString().slice(5, 10), count: c.c })
  }
  res.json({ users: users.c, patterns: patterns.c, userPatterns: userPatterns.c, shares: shares.c, shareVisits: shareVisits.c, aiTotal: aiTotal.c, aiToday: aiToday.c, feedbackOpen: feedbackOpen.c, logsToday: logsToday.c, trend })
})

app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  const q = String(req.query.search || '').trim()
  const page = Math.max(1, Number(req.query.page) || 1)
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 20))
  const where = q ? 'WHERE username LIKE ? OR email LIKE ? OR nickname LIKE ?' : ''
  const like = '%' + q + '%'
  const total = db.prepare(`SELECT COUNT(*) AS c FROM users ${where}`).get(...(q ? [like, like, like] : []))
  const rows = db.prepare(`SELECT * FROM users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...(q ? [like, like, like] : []), size, (page - 1) * size)
  res.json({ total: total.c, page, size, users: rows.map(publicUser) })
})

app.patch('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id)
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  if (!u) return res.status(404).json({ error: '用户不存在' })
  if (u.username === 'admin' && (req.body || {}).role !== 'admin') return res.status(400).json({ error: '不能修改内置管理员角色' })
  const { role, status } = req.body || {}
  if (role && ['user', 'admin'].includes(role)) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
  if (status && ['active', 'banned'].includes(status)) db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id)
  log(req.user.uid, 'admin_user_update', `修改用户 #${id} role=${role || '-'} status=${status || '-'}`, req)
  res.json({ ok: true })
})

app.post('/api/admin/users/:id/reset-password', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id)
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  if (!u) return res.status(404).json({ error: '用户不存在' })
  const np = String((req.body || {}).password || '123456')
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(np), id)
  log(req.user.uid, 'admin_reset_password', `重置用户 #${id} 密码`, req)
  res.json({ ok: true })
})

app.get('/api/admin/patterns', auth, adminOnly, (req, res) => {
  const q = String(req.query.search || '').trim()
  const status = String(req.query.status || '').trim()
  const page = Math.max(1, Number(req.query.page) || 1)
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 20))
  const conds = []
  const args = []
  if (q) { conds.push('(name LIKE ? OR id LIKE ?)'); args.push('%' + q + '%', '%' + q + '%') }
  if (status) { conds.push('status = ?'); args.push(status) }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const total = db.prepare(`SELECT COUNT(*) AS c FROM patterns ${where}`).get(...args)
  const rows = db.prepare(`SELECT * FROM patterns ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size)
  res.json({ total: total.c, page, size, patterns: rows.map(cleanPattern) })
})

app.patch('/api/admin/patterns/:id', auth, adminOnly, (req, res) => {
  const { name, tags, difficulty, status, description } = req.body || {}
  const p = db.prepare('SELECT * FROM patterns WHERE id = ?').get(String(req.params.id))
  if (!p) return res.status(404).json({ error: '图纸不存在' })
  db.prepare('UPDATE patterns SET name = ?, tags = ?, difficulty = ?, status = ?, description = ?, updated_at = ? WHERE id = ?').run(
    name ? String(name).slice(0, 80) : p.name,
    tags ? JSON.stringify(tags) : p.tags,
    difficulty || p.difficulty,
    status || p.status,
    description !== undefined ? String(description).slice(0, 500) : p.description,
    now(), p.id
  )
  log(req.user.uid, 'admin_pattern_update', `修改图纸 ${p.id}`, req)
  res.json({ ok: true })
})

app.delete('/api/admin/patterns/:id', auth, adminOnly, (req, res) => {
  const id = String(req.params.id)
  const p = db.prepare('SELECT * FROM patterns WHERE id = ?').get(id)
  if (!p) return res.json({ ok: true })
  if (p.is_builtin) return res.status(400).json({ error: '内置图纸不能删除（可下架）' })
  db.prepare('DELETE FROM patterns WHERE id = ?').run(id)
  log(req.user.uid, 'admin_pattern_delete', `删除图纸 ${id}`, req)
  res.json({ ok: true })
})

app.get('/api/admin/shares', auth, adminOnly, (req, res) => {
  const q = String(req.query.search || '').trim()
  const page = Math.max(1, Number(req.query.page) || 1)
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 20))
  const where = q ? 'WHERE id LIKE ?' : ''
  const like = '%' + q + '%'
  const total = db.prepare(`SELECT COUNT(*) AS c FROM shares ${where}`).get(...(q ? [like] : []))
  const rows = db.prepare(`SELECT * FROM shares ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...(q ? [like] : []), size, (page - 1) * size)
  res.json({ total: total.c, page, size, shares: rows.map((r) => ({ id: r.id, userId: r.user_id, visits: r.visits, expiresAt: r.expires_at, createdAt: r.created_at, name: safeJson(r.entry, {}).name || '共享图纸' })) })
})

app.delete('/api/admin/shares/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM shares WHERE id = ?').run(String(req.params.id))
  log(req.user.uid, 'admin_share_delete', `删除分享 ${req.params.id}`, req)
  res.json({ ok: true })
})

app.get('/api/admin/ai-usage', auth, adminOnly, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 20))
  const total = db.prepare('SELECT COUNT(*) AS c FROM ai_usage').get()
  const rows = db.prepare('SELECT * FROM ai_usage ORDER BY id DESC LIMIT ? OFFSET ?').all(size, (page - 1) * size)
  res.json({ total: total.c, page, size, usage: rows.map((r) => ({ id: r.id, userId: r.user_id, prompt: r.prompt, model: r.model, status: r.status, createdAt: r.created_at })) })
})

app.get('/api/admin/logs', auth, adminOnly, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 20))
  const total = db.prepare('SELECT COUNT(*) AS c FROM logs').get()
  const rows = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ? OFFSET ?').all(size, (page - 1) * size)
  res.json({ total: total.c, page, size, logs: rows.map((r) => ({ id: r.id, userId: r.user_id, action: r.action, detail: r.detail, ip: r.ip, createdAt: r.created_at })) })
})

app.get('/api/admin/feedback', auth, adminOnly, (req, res) => {
  const status = String(req.query.status || '').trim()
  const page = Math.max(1, Number(req.query.page) || 1)
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 20))
  const where = status ? 'WHERE status = ?' : ''
  const args = status ? [status] : []
  const total = db.prepare(`SELECT COUNT(*) AS c FROM feedback ${where}`).get(...args)
  const rows = db.prepare(`SELECT * FROM feedback ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size)
  res.json({ total: total.c, page, size, feedback: rows.map((r) => ({ id: r.id, userId: r.user_id, content: r.content, contact: r.contact, status: r.status, reply: r.reply, createdAt: r.created_at })) })
})

app.patch('/api/admin/feedback/:id', auth, adminOnly, (req, res) => {
  const { status, reply } = req.body || {}
  const r = db.prepare('SELECT * FROM feedback WHERE id = ?').get(Number(req.params.id))
  if (!r) return res.status(404).json({ error: '反馈不存在' })
  db.prepare('UPDATE feedback SET status = ?, reply = ? WHERE id = ?').run(status || r.status, reply !== undefined ? String(reply).slice(0, 1000) : r.reply, r.id)
  res.json({ ok: true })
})

app.get('/api/admin/settings', auth, adminOnly, (req, res) => {
  res.json({
    siteNotice: setting('site_notice', ''),
    aiEnabled: setting('ai_enabled', '1') === '1',
    aiDailyLimit: Number(setting('ai_daily_limit', '50')) || 50,
    maintenance: setting('maintenance', '0') === '1'
  })
})

app.put('/api/admin/settings', auth, adminOnly, (req, res) => {
  const b = req.body || {}
  if (b.siteNotice !== undefined) setSetting('site_notice', String(b.siteNotice).slice(0, 500))
  if (b.aiEnabled !== undefined) setSetting('ai_enabled', b.aiEnabled ? '1' : '0')
  if (b.aiDailyLimit !== undefined) setSetting('ai_daily_limit', String(Math.max(1, Math.min(10000, Number(b.aiDailyLimit) || 50))))
  if (b.maintenance !== undefined) setSetting('maintenance', b.maintenance ? '1' : '0')
  log(req.user.uid, 'admin_settings', '更新系统设置', req)
  res.json({ ok: true })
})

app.get('/api/admin/export', auth, adminOnly, (req, res) => {
  const data = {
    users: db.prepare('SELECT * FROM users').all(),
    patterns: db.prepare('SELECT * FROM patterns').all(),
    favorites: db.prepare('SELECT * FROM favorites').all(),
    groups: db.prepare('SELECT * FROM pattern_groups').all(),
    inventory: db.prepare('SELECT * FROM inventory').all(),
    shares: db.prepare('SELECT * FROM shares').all(),
    ai_usage: db.prepare('SELECT * FROM ai_usage').all(),
    feedback: db.prepare('SELECT * FROM feedback').all(),
    settings: db.prepare('SELECT * FROM settings').all(),
    exportedAt: new Date().toISOString()
  }
  log(req.user.uid, 'admin_export', '导出全量数据备份', req)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="pindou-backup-${new Date().toISOString().slice(0, 10)}.json"`)
  res.send(JSON.stringify(data, null, 2))
})

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ai: !!(process.env.DASHSCOPE_API_KEY || ''), maintenance: setting('maintenance', '0') === '1' })
})

/* 错误处理 */
app.use((err, req, res, next) => {
  const msg = String((err && err.message) || err)
  res.status(500).json({ error: msg.slice(0, 400) })
})

export default app
