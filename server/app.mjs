/**
 * Express 应用：用户 / 云同步 / 分享 / AI / 反馈 / 后台管理 API
 */
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, initDb } from './db.mjs'
import { hashPassword, verifyPassword, signToken, auth, adminOnly, optionalAuth } from './auth.mjs'
import { collectOnce, collectPreviewItems, importPreviewItems, COLLECT_SOURCES } from './collector.mjs'
import { sendMail as smtpSendMail } from './smtp.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ quiet: true })
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true })

const app = express()
app.use(cors())
app.use(express.json({ limit: '24mb' }))

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
function intSetting(key, def) {
  const n = Number(setting(key, String(def)))
  return Number.isFinite(n) ? n : def
}
function todayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function yesterdayStr() {
  const d = new Date(); d.setDate(d.getDate() - 1)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
/** 当日通过积分兑换的额外 AI 次数（跨日自动归零） */
function aiExtraToday(userId) {
  const u = db.prepare('SELECT ai_extra_date, ai_extra_quota FROM users WHERE id = ?').get(userId)
  if (!u) return 0
  return u.ai_extra_date === todayStr() ? Number(u.ai_extra_quota) || 0 : 0
}
/** AI 服务配置：地址与 Key 支持后台修改（settings 表），未设置时回退环境变量 */
function aiApiBase() {
  const v = String(setting('ai_api_base', '') || '').trim().replace(/\/+$/, '')
  return v || 'https://dashscope.aliyuncs.com/api/v1'
}
function aiApiKey() {
  return String(setting('ai_api_key', '') || '').trim() || process.env.DASHSCOPE_API_KEY || ''
}
function maskKey(k) {
  if (!k) return ''
  return k.length <= 8 ? k.slice(0, 2) + '****' : k.slice(0, 4) + '****' + k.slice(-4)
}

/* ================= 邮件（SMTP 找回密码） ================= */
function smtpConfig() {
  return {
    host: String(setting('smtp_host', '') || '').trim() || process.env.SMTP_HOST || '',
    port: intSetting('smtp_port', Number(process.env.SMTP_PORT) || 465),
    user: String(setting('smtp_user', '') || '').trim() || process.env.SMTP_USER || '',
    pass: String(setting('smtp_pass', '') || '').trim() || process.env.SMTP_PASS || '',
    from: String(setting('smtp_from', '') || '').trim() || process.env.SMTP_FROM || ''
  }
}
function smtpReady(cfg) {
  return !!(cfg.host && cfg.user && cfg.pass)
}
async function sendMail(to, subject, html) {
  const cfg = smtpConfig()
  if (!smtpReady(cfg)) return false
  await smtpSendMail({
    host: cfg.host,
    port: Number(cfg.port) || 465,
    user: cfg.user,
    pass: cfg.pass,
    from: cfg.from || cfg.user,
    to,
    subject,
    html
  })
  return true
}

/** HTML 转义，防止用户名/链接等内容注入 */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/** 通用邮件外壳：品牌头 + 渐变标题 + 内容卡片 + 页脚 */
function mailShell(title, innerHtml, footerHtml) {
  const foot = footerHtml || '本邮件由拼豆工坊自动发送，请勿直接回复。'
  return (
    '<div style="margin:0;padding:0;background-color:#f3f4f8;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'Microsoft YaHei\',Arial,sans-serif">' +
    '<div style="max-width:560px;margin:0 auto;padding:28px 16px">' +
    '<div style="text-align:center;padding:4px 0 18px">' +
    '<div style="display:inline-block;width:38px;height:38px;line-height:38px;border-radius:10px;background:linear-gradient(135deg,#ec4899,#8b5cf6);color:#fff;font-size:19px;font-weight:700;text-align:center">豆</div>' +
    '<span style="margin-left:10px;font-size:18px;font-weight:700;color:#1f2937;vertical-align:middle">拼豆工坊</span>' +
    '</div>' +
    '<div style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(31,41,55,.08)">' +
    '<div style="background:linear-gradient(135deg,#ec4899,#8b5cf6);padding:22px 26px;color:#ffffff">' +
    '<h1 style="margin:0;font-size:20px;font-weight:700;letter-spacing:.5px">' + title + '</h1>' +
    '</div>' +
    '<div style="padding:26px 26px 12px;color:#374151;font-size:14px;line-height:1.9">' + innerHtml + '</div>' +
    '</div>' +
    '<p style="text-align:center;color:#9ca3af;font-size:12px;line-height:1.7;margin-top:18px">' + foot + '</p>' +
    '</div>' +
    '</div>'
  )
}

function publicUser(u) {
  return { id: u.id, username: u.username, email: u.email, nickname: u.nickname || u.username, avatar: u.avatar, bio: u.bio, role: u.role, status: u.status, createdAt: u.created_at, lastLoginAt: u.last_login_at }
}
function cleanPattern(p) {
  return p && {
    id: p.id, userId: p.user_id, name: p.name, description: p.description || '',
    tags: safeJson(p.tags, []), paletteId: p.palette_id, width: p.width, height: p.height,
    rows: safeJson(p.rows, []), source: p.source, status: p.status, isBuiltin: !!p.is_builtin,
    difficulty: p.difficulty, beadCount: p.bead_count, sourceLabel: p.source_label || '',
    featured: !!p.featured, createdAt: p.created_at, updatedAt: p.updated_at
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
  if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.status(400).json({ error: '邮箱格式不正确' })
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

/* ================= 找回密码（SMTP） ================= */
app.post('/api/auth/forgot-password', async (req, res, next) => {
  try {
    const em = String((req.body || {}).email || '').trim().toLowerCase()
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.status(400).json({ error: '邮箱格式不正确' })
    const cfg = smtpConfig()
    if (!smtpReady(cfg)) return res.status(503).json({ error: '管理员尚未配置邮件服务，请联系管理员重置密码' })
    const u = db.prepare('SELECT id, username, email FROM users WHERE email = ?').get(em)
    if (!u) return res.json({ ok: true })
    db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(now())
    const token = randomToken()
    const expiresAt = now() + 30 * 60 * 1000
    db.prepare('INSERT INTO password_resets (email, token, used, expires_at, created_at) VALUES (?,?,0,?,?)').run(em, token, expiresAt, now())
    const base = String(process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '') || 'http://localhost:5173'
    const link = base + '/#/reset-password?token=' + encodeURIComponent(token) + '&email=' + encodeURIComponent(em)
    const html = mailShell('重置密码',
      '<p style="margin-top:0">你好，<b>' + escapeHtml(u.username) + '</b>：</p>' +
      '<p>我们收到了你找回密码的请求，请点击下方按钮重置密码。<b style="color:#ec4899">链接 30 分钟内有效</b>，逾期需重新申请。</p>' +
      '<p style="text-align:center;margin:28px 0"><a href="' + link + '" style="display:inline-block;padding:12px 34px;background:#ec4899;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;box-shadow:0 3px 10px rgba(236,72,153,.35)">重置密码</a></p>' +
      '<p style="font-size:13px;color:#6b7280;margin:0 0 6px">如果按钮无法点击，请复制以下链接到浏览器打开：</p>' +
      '<p style="word-break:break-all;font-size:12px;color:#9ca3af;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin:0 0 20px">' + escapeHtml(link) + '</p>',
      '本邮件由拼豆工坊自动发送，请勿直接回复。<br/>如果这不是你的操作，请忽略本邮件。'
    )
    await sendMail(em, '【拼豆工坊】重置密码', html)
    log(u.id, 'forgot_password', '发送找回密码邮件', req)
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

app.post('/api/auth/reset-password', (req, res) => {
  const { token, email, password } = req.body || {}
  const em = String(email || '').trim().toLowerCase()
  const tk = String(token || '').trim()
  if (!tk || !em) return res.status(400).json({ error: '链接无效或已过期' })
  if (!password || password.length < 6 || password.length > 64) return res.status(400).json({ error: '新密码需为 6~64 位' })
  const r = db.prepare('SELECT * FROM password_resets WHERE token = ? AND email = ?').get(tk, em)
  if (!r || r.used || r.expires_at < now()) return res.status(400).json({ error: '链接无效或已过期，请重新申请' })
  const u = db.prepare('SELECT id FROM users WHERE email = ?').get(em)
  if (!u) return res.status(400).json({ error: '账号不存在' })
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), u.id)
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(r.id)
  log(u.id, 'reset_password', '通过邮件重置密码', req)
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

app.post('/api/share/:id', optionalAuth, (req, res) => {
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

/* ================= AI（用量记录 + 登录/游客额度） ================= */
app.post('/api/ai/generate', optionalAuth, async (req, res, next) => {
  try {
    if (setting('ai_enabled', '1') !== '1') return res.status(403).json({ error: 'AI 生成功能暂未开放' })
    const userId = req.user ? req.user.uid : null
    const guestId = userId ? null : String((req.body || {}).guestId || '').trim().slice(0, 64) || null
    const prompt = String((req.body || {}).prompt || '').trim()
    if (!prompt) return res.status(400).json({ error: 'prompt 不能为空' })
    const referenceImage = String((req.body || {}).referenceImage || '').trim()
    if (referenceImage && !/^data:image\/[a-zA-Z]+;base64,/.test(referenceImage)) {
      return res.status(400).json({ error: '参考图格式不正确' })
    }
    if (referenceImage && referenceImage.length > 15_000_000) {
      return res.status(400).json({ error: '参考图过大，请换一张小一点的图片（建议 10MB 以内）' })
    }
    // 额度：登录用户按日限额（默认 50）；游客按 ai_guest_limit（默认 10，可后台调整）
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
    if (userId) {
      const limit = intSetting('ai_daily_limit', 50) + aiExtraToday(userId)
      const used = db.prepare('SELECT COUNT(*) AS c FROM ai_usage WHERE user_id = ? AND created_at >= ?').get(userId, dayStart.getTime())
      if (used.c >= limit) return res.status(429).json({ error: '今日 AI 生成次数已用完，可用积分兑换更多额度或明天再来' })
    } else {
      const limit = intSetting('ai_guest_limit', 10)
      const used = guestId
        ? db.prepare('SELECT COUNT(*) AS c FROM ai_usage WHERE guest_id = ? AND created_at >= ?').get(guestId, dayStart.getTime())
        : db.prepare('SELECT COUNT(*) AS c FROM ai_usage WHERE user_id IS NULL AND created_at >= ?').get(dayStart.getTime())
      if (used.c >= limit) return res.status(429).json({ error: '游客今日 AI 生成次数已用完，登录后可获得更多次数' })
    }
    const model = referenceImage
      ? process.env.WANX_EDIT_MODEL || 'wanx2.1-imageedit'
      : process.env.WANX_MODEL || 'wanx2.1-t2i-turbo'
    const imageBase64 = referenceImage ? await editImage(prompt, referenceImage) : await text2Image(prompt)
    db.prepare('INSERT INTO ai_usage (user_id, guest_id, prompt, model, status, created_at) VALUES (?,?,?,?,?,?)').run(userId, guestId, prompt.slice(0, 300), model, 'ok', now())
    if (userId) {
      const b = req.body || {}
      db.prepare('INSERT INTO ai_history (user_id, prompt, image_base64, palette_id, width, model, created_at) VALUES (?,?,?,?,?,?,?)').run(
        userId, prompt.slice(0, 300), imageBase64, String(b.paletteId || '').trim() || null,
        Number(b.width) || null, model, now()
      )
      db.prepare('DELETE FROM ai_history WHERE user_id = ? AND id NOT IN (SELECT id FROM ai_history WHERE user_id = ? ORDER BY id DESC LIMIT 30)').run(userId, userId)
    }
    res.json({ ok: true, imageBase64, model })
  } catch (err) {
    const msg = String((err && err.message) || err)
    db.prepare('INSERT INTO ai_usage (user_id, guest_id, prompt, model, status, created_at) VALUES (?,?,?,?,?,?)').run(
      req.user ? req.user.uid : null,
      String((req.body || {}).guestId || '').trim().slice(0, 64) || null,
      String((req.body || {}).prompt || '').slice(0, 300),
      'wanx', msg.includes('SAFETY') ? 'blocked' : 'failed', now()
    )
    next(err)
  }
})

async function text2Image(prompt) {
  const model = process.env.WANX_MODEL || 'wanx2.1-t2i-turbo'
  const key = aiApiKey()
  if (!key) throw new Error('服务端未配置 AI Key（请在后台「系统设置 → AI 设置」填写）')
  const createRes = await fetch(aiApiBase() + '/services/aigc/text2image/image-synthesis', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({ model, input: { prompt }, parameters: { size: '1024*1024', n: 1 } })
  })
  return pollDashscopeTask(createRes, key)
}

/**
 * AI 参考图模式（img2img）：上传一张参考图 + 文字描述，
 * 由模型按描述改造/重绘参考图（wanx2.1-imageedit，description_edit）。
 */
async function editImage(prompt, baseImageUrl) {
  const model = process.env.WANX_EDIT_MODEL || 'wanx2.1-imageedit'
  const key = aiApiKey()
  if (!key) throw new Error('服务端未配置 AI Key（请在后台「系统设置 → AI 设置」填写）')
  const createRes = await fetch(aiApiBase() + '/services/aigc/image2image/image-synthesis', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({
      model,
      input: { function: 'description_edit', prompt, base_image_url: baseImageUrl },
      parameters: { n: 1 }
    })
  })
  return pollDashscopeTask(createRes, key)
}

/** 提交异步任务后轮询结果，返回 data URL 图片 */
async function pollDashscopeTask(createRes, key) {
  const createJson = await createRes.json()
  const taskId = createJson?.output?.task_id
  if (!taskId) throw new Error(JSON.stringify(createJson).slice(0, 300))
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const taskRes = await fetch(aiApiBase() + `/tasks/${taskId}`, { headers: { Authorization: `Bearer ${key}` } })
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
  const limit = intSetting('ai_daily_limit', 50)
  const extra = aiExtraToday(req.user.uid)
  const total = db.prepare('SELECT COUNT(*) AS c FROM ai_usage WHERE user_id = ?').get(req.user.uid)
  res.json({ today: used.c, limit, extra, effectiveLimit: limit + extra, total: total.c })
})

/* 游客 AI 用量（按设备 guestId，无需登录） */
app.get('/api/ai/guest-usage', (req, res) => {
  const guestId = String(req.query.guestId || '').trim().slice(0, 64)
  const limit = intSetting('ai_guest_limit', 10)
  if (!guestId) return res.json({ today: 0, limit, total: 0 })
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
  const used = db.prepare('SELECT COUNT(*) AS c FROM ai_usage WHERE guest_id = ? AND created_at >= ?').get(guestId, dayStart.getTime())
  const total = db.prepare('SELECT COUNT(*) AS c FROM ai_usage WHERE guest_id = ?').get(guestId)
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


/** ??????????? / ?? / ??? / ???????? admin ????? */
app.post('/api/admin/users/batch', auth, adminOnly, (req, res) => {
  const { ids, action } = req.body || {}
  const list = Array.isArray(ids) ? ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : []
  if (!list.length) return res.status(400).json({ error: '请先勾选要操作的用户' })
  if (!['enable', 'disable', 'admin', 'user', 'delete'].includes(action)) return res.status(400).json({ error: '无效的操作' })
  let processed = 0
  let skipped = 0
  const get = db.prepare('SELECT id, username FROM users WHERE id = ?')
  const updStatus = db.prepare('UPDATE users SET status = ? WHERE id = ?')
  const updRole = db.prepare('UPDATE users SET role = ? WHERE id = ?')
  const del = db.prepare('DELETE FROM users WHERE id = ?')
  const delPatterns = db.prepare('DELETE FROM patterns WHERE user_id = ?')
  const delFav = db.prepare('DELETE FROM favorites WHERE user_id = ?')
  const delGroups = db.prepare('DELETE FROM pattern_groups WHERE user_id = ?')
  const delInv = db.prepare('DELETE FROM inventory WHERE user_id = ?')
  const delAi = db.prepare('DELETE FROM ai_usage WHERE user_id = ?')
  const delShares = db.prepare('DELETE FROM shares WHERE user_id = ?')
  const delHistory = db.prepare('DELETE FROM ai_history WHERE user_id = ?')
  for (const id of list) {
    const u = get.get(id)
    if (!u) { skipped++; continue }
    // ???????????/??/??
    if (u.username === 'admin') { skipped++; continue }
    if (action === 'delete') {
      delPatterns.run(id); delFav.run(id); delGroups.run(id); delInv.run(id); delAi.run(id); delShares.run(id); delHistory.run(id)
      del.run(id)
      processed++
    } else if (action === 'enable') {
      updStatus.run('active', id); processed++
    } else if (action === 'disable') {
      updStatus.run('banned', id); processed++
    } else if (action === 'admin') {
      updRole.run('admin', id); processed++
    } else if (action === 'user') {
      updRole.run('user', id); processed++
    }
  }
  log(req.user.uid, 'admin_user_batch', `批量${action} ${processed} 条，跳过 ${skipped} 条`, req)
  res.json({ ok: true, processed, skipped })
})

app.get('/api/admin/patterns', auth, adminOnly, (req, res) => {
  const q = String(req.query.search || '').trim()
  const status = String(req.query.status || '').trim()
  const page = Math.max(1, Number(req.query.page) || 1)
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 20))
  const conds = []
  const args = []
  const type = String(req.query.type || '').trim()
  if (q) { conds.push('(name LIKE ? OR id LIKE ?)'); args.push('%' + q + '%', '%' + q + '%') }
  if (status) { conds.push('status = ?'); args.push(status) }
  if (type === 'builtin') conds.push('is_builtin = 1')
  if (type === 'user') conds.push('user_id IS NOT NULL')
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const total = db.prepare(`SELECT COUNT(*) AS c FROM patterns ${where}`).get(...args)
  const rows = db.prepare(`SELECT * FROM patterns ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size)
  res.json({ total: total.c, page, size, patterns: rows.map(cleanPattern) })
})

app.post('/api/admin/patterns', auth, adminOnly, (req, res) => {
  const b = req.body || {}
  const name = String(b.name || '').trim()
  const paletteId = String(b.paletteId || '').trim()
  const rows = Array.isArray(b.rows) ? b.rows : []
  if (!name || !paletteId || !rows.length) return res.status(400).json({ error: '需要名称、色卡和图纸内容' })
  const clean = rows
    .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '.')) : []))
    .filter((r) => r.length > 0)
  if (!clean.length) return res.status(400).json({ error: '图纸内容为空' })
  const width = Math.max(...clean.map((r) => r.length))
  const height = clean.length
  let beads = 0
  for (const r of clean) for (const c of r) if (c && c !== '.') beads++
  const id = b.id ? String(b.id).trim().slice(0, 40) : 'ad' + Date.now().toString(36)
  if (db.prepare('SELECT id FROM patterns WHERE id = ?').get(id)) return res.status(409).json({ error: 'ID 已存在' })
  const difficulty = b.difficulty || (beads < 500 ? '简单' : beads <= 2000 ? '中等' : '复杂')
  db.prepare(
    'INSERT INTO patterns (id, user_id, name, description, tags, palette_id, width, height, rows, source, status, is_builtin, difficulty, bead_count, source_label, featured, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)'
  ).run(
    id, null, name, String(b.description || ''), JSON.stringify(Array.isArray(b.tags) ? b.tags : []), paletteId,
    width, height, JSON.stringify(clean), 'builtin', b.status === 'hidden' ? 'hidden' : 'published',
    difficulty, beads, String(b.sourceLabel || '').slice(0, 40), b.featured ? 1 : 0, now(), now()
  )
  log(req.user.uid, 'admin_pattern_create', `新增图纸 ${id}`, req)
  res.json({ ok: true, id })
})

app.patch('/api/admin/patterns/:id', auth, adminOnly, (req, res) => {
  const { name, tags, difficulty, status, description, sourceLabel, featured } = req.body || {}
  const p = db.prepare('SELECT * FROM patterns WHERE id = ?').get(String(req.params.id))
  if (!p) return res.status(404).json({ error: '图纸不存在' })
  db.prepare('UPDATE patterns SET name = ?, tags = ?, difficulty = ?, status = ?, description = ?, source_label = ?, featured = ?, updated_at = ? WHERE id = ?').run(
    name ? String(name).slice(0, 80) : p.name,
    tags ? JSON.stringify(tags) : p.tags,
    difficulty || p.difficulty,
    status || p.status,
    description !== undefined ? String(description).slice(0, 500) : p.description,
    sourceLabel !== undefined ? String(sourceLabel).slice(0, 40) : p.source_label,
    featured !== undefined ? (featured ? 1 : 0) : p.featured,
    now(), p.id
  )
  log(req.user.uid, 'admin_pattern_update', `修改图纸 ${p.id}`, req)
  res.json({ ok: true })
})

app.delete('/api/admin/patterns/:id', auth, adminOnly, (req, res) => {
  const id = String(req.params.id)
  const p = db.prepare('SELECT * FROM patterns WHERE id = ?').get(id)
  if (!p) return res.json({ ok: true })
  // 种子内置图纸（无来源）保护：只能下架；采集来的图纸（有 source_label）允许删除
  if (p.is_builtin && !p.source_label) return res.status(400).json({ error: '内置图纸不能删除（可下架）' })
  db.prepare('DELETE FROM favorites WHERE pattern_id = ?').run(id)
  db.prepare('DELETE FROM patterns WHERE id = ?').run(id)
  log(req.user.uid, 'admin_pattern_delete', `删除图纸 ${id}`, req)
  res.json({ ok: true })
})

/** 图纸批量管理：批量删除 / 上架 / 下架 / 改难度 */
app.post('/api/admin/patterns/batch', auth, adminOnly, (req, res) => {
  const { ids, action, difficulty } = req.body || {}
  const list = Array.isArray(ids) ? ids.map((x) => String(x)).filter(Boolean) : []
  if (!list.length) return res.status(400).json({ error: '请先勾选要操作的图纸' })
  if (!['delete', 'publish', 'hide', 'difficulty'].includes(action)) return res.status(400).json({ error: '未知操作' })
  let processed = 0
  let skipped = 0
  const del = db.prepare('DELETE FROM patterns WHERE id = ?')
  const delFav = db.prepare('DELETE FROM favorites WHERE pattern_id = ?')
  const upd = db.prepare('UPDATE patterns SET status = ?, updated_at = ? WHERE id = ?')
  const updDiff = db.prepare('UPDATE patterns SET difficulty = ?, updated_at = ? WHERE id = ?')
  const get = db.prepare('SELECT id, is_builtin, source_label FROM patterns WHERE id = ?')
  for (const id of list) {
    const p = get.get(id)
    if (!p) { skipped++; continue }
    if (action === 'delete') {
      // 种子内置图纸（无来源）保护：只能下架；采集来的图纸允许删除
      if (p.is_builtin && !p.source_label) { skipped++; continue }
      delFav.run(id)
      del.run(id)
      processed++
    } else if (action === 'publish' || action === 'hide') {
      upd.run(action === 'publish' ? 'published' : 'hidden', now(), id)
      processed++
    } else if (action === 'difficulty') {
      const d = String(difficulty || '').trim()
      if (!['简单', '中等', '复杂'].includes(d)) return res.status(400).json({ error: '难度需为 简单/中等/复杂' })
      updDiff.run(d, now(), id)
      processed++
    }
  }
  log(req.user.uid, 'admin_pattern_batch', `批量${action} ${processed} 条（跳过 ${skipped}）`, req)
  res.json({ ok: true, processed, skipped })
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

app.post('/api/admin/shares/batch', auth, adminOnly, (req, res) => {
  const { ids, action } = req.body || {}
  const list = Array.isArray(ids) ? ids.map((x) => String(x)).filter(Boolean) : []
  if (!list.length) return res.status(400).json({ error: '请先勾选要操作的分享' })
  if (!['delete'].includes(action)) return res.status(400).json({ error: '未知操作' })
  const del = db.prepare('DELETE FROM shares WHERE id = ?')
  let processed = 0
  for (const id of list) { del.run(id); processed++ }
  log(req.user.uid, 'admin_share_batch', '批量删除分享 ' + processed + ' 条', req)
  res.json({ ok: true, processed })
})

app.get('/api/admin/ai-usage', auth, adminOnly, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 20))
  const total = db.prepare('SELECT COUNT(*) AS c FROM ai_usage').get()
  const rows = db.prepare('SELECT * FROM ai_usage ORDER BY id DESC LIMIT ? OFFSET ?').all(size, (page - 1) * size)
  res.json({ total: total.c, page, size, usage: rows.map((r) => ({ id: r.id, userId: r.user_id, guestId: r.guest_id || null, prompt: r.prompt, model: r.model, status: r.status, createdAt: r.created_at })) })
})

app.post('/api/admin/ai-usage/batch', auth, adminOnly, (req, res) => {
  const { ids, action } = req.body || {}
  if (action === 'clear') {
    const info = db.prepare('DELETE FROM ai_usage').run()
    log(req.user.uid, 'admin_ai_batch', '清空 AI 用量记录 ' + info.changes + ' 条', req)
    return res.json({ ok: true, processed: info.changes })
  }
  const list = Array.isArray(ids) ? ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : []
  if (!list.length) return res.status(400).json({ error: '请先勾选要操作的记录' })
  if (!['delete'].includes(action)) return res.status(400).json({ error: '未知操作' })
  const del = db.prepare('DELETE FROM ai_usage WHERE id = ?')
  let processed = 0
  for (const id of list) { del.run(id); processed++ }
  log(req.user.uid, 'admin_ai_batch', '批量删除 AI 用量 ' + processed + ' 条', req)
  res.json({ ok: true, processed })
})

app.get('/api/admin/logs', auth, adminOnly, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const size = Math.min(100, Math.max(1, Number(req.query.size) || 20))
  const total = db.prepare('SELECT COUNT(*) AS c FROM logs').get()
  const rows = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ? OFFSET ?').all(size, (page - 1) * size)
  res.json({ total: total.c, page, size, logs: rows.map((r) => ({ id: r.id, userId: r.user_id, action: r.action, detail: r.detail, ip: r.ip, createdAt: r.created_at })) })
})

app.post('/api/admin/logs/batch', auth, adminOnly, (req, res) => {
  const { ids, action } = req.body || {}
  if (action === 'clear') {
    const info = db.prepare('DELETE FROM logs').run()
    log(req.user.uid, 'admin_logs_batch', '清空日志 ' + info.changes + ' 条', req)
    return res.json({ ok: true, processed: info.changes })
  }
  const list = Array.isArray(ids) ? ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : []
  if (!list.length) return res.status(400).json({ error: '请先勾选要操作的日志' })
  if (!['delete'].includes(action)) return res.status(400).json({ error: '未知操作' })
  const del = db.prepare('DELETE FROM logs WHERE id = ?')
  let processed = 0
  for (const id of list) { del.run(id); processed++ }
  log(req.user.uid, 'admin_logs_batch', '批量删除日志 ' + processed + ' 条', req)
  res.json({ ok: true, processed })
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

app.post('/api/admin/feedback/batch', auth, adminOnly, (req, res) => {
  const { ids, action } = req.body || {}
  const list = Array.isArray(ids) ? ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : []
  if (!list.length) return res.status(400).json({ error: '请先勾选要操作的反馈' })
  if (!['delete', 'close'].includes(action)) return res.status(400).json({ error: '未知操作' })
  const del = db.prepare('DELETE FROM feedback WHERE id = ?')
  const upd = db.prepare('UPDATE feedback SET status = ? WHERE id = ?')
  let processed = 0
  for (const id of list) {
    if (action === 'delete') del.run(id)
    else upd.run('closed', id)
    processed++
  }
  log(req.user.uid, 'admin_feedback_batch', '批量' + (action === 'delete' ? '删除' : '处理') + '反馈 ' + processed + ' 条', req)
  res.json({ ok: true, processed })
})

app.get('/api/admin/settings', auth, adminOnly, (req, res) => {
  res.json({
    siteNotice: setting('site_notice', ''),
    maintenance: setting('maintenance', '0') === '1',
    registerOpen: setting('register_open', '1') === '1',
    features: {
      gallery: setting('feature_gallery', '1') === '1',
      generator: setting('feature_generator', '1') === '1',
      ai: setting('feature_ai', '1') === '1',
      palette: setting('feature_palette', '1') === '1',
      warehouse: setting('feature_warehouse', '1') === '1',
      share: setting('feature_share', '1') === '1'
    },
    aiEnabled: setting('ai_enabled', '1') === '1',
    aiDailyLimit: intSetting('ai_daily_limit', 50),
    aiGuestLimit: intSetting('ai_guest_limit', 10),
    aiApiBase: aiApiBase(),
    aiApiKeyConfigured: !!aiApiKey(),
    aiApiKeyMasked: maskKey(aiApiKey()),
    aiModel: process.env.WANX_MODEL || 'wanx2.1-t2i-turbo',
    aiEditModel: process.env.WANX_EDIT_MODEL || 'wanx2.1-imageedit',
    collectEnabled: setting('collect_enabled', '0') === '1',
    collectIntervalMin: intSetting('collect_interval_min', 60),
    collectLimit: intSetting('collect_limit', 10),
    collectSources: collectSourcesSetting(),
    collectExcludeTags: setting('collect_exclude_tags', ''),
    collectMaxWidth: intSetting('collect_max_width', 0),
    collectMaxBeads: intSetting('collect_max_beads', 0),
    checkinPoints: intSetting('checkin_points', 10),
    checkinStreakBonus: intSetting('checkin_streak_bonus', 5),
    exchangeCost: intSetting('exchange_cost', 20),
    exchangeQuota: intSetting('exchange_quota', 5),
    smtpHost: setting('smtp_host', ''),
    smtpPort: intSetting('smtp_port', 465),
    smtpUser: setting('smtp_user', ''),
    smtpPassConfigured: !!setting('smtp_pass', '') || !!process.env.SMTP_PASS,
    smtpFrom: setting('smtp_from', '')
  })
})

app.put('/api/admin/settings', auth, adminOnly, (req, res) => {
  const b = req.body || {}
  if (b.siteNotice !== undefined) setSetting('site_notice', String(b.siteNotice).slice(0, 500))
  if (b.maintenance !== undefined) setSetting('maintenance', b.maintenance ? '1' : '0')
  if (b.registerOpen !== undefined) setSetting('register_open', b.registerOpen ? '1' : '0')
  if (b.features) {
    for (const [k, v] of Object.entries(b.features)) {
      if (['gallery', 'generator', 'ai', 'palette', 'warehouse', 'share'].includes(k)) setSetting('feature_' + k, v ? '1' : '0')
    }
  }
  if (b.aiEnabled !== undefined) setSetting('ai_enabled', b.aiEnabled ? '1' : '0')
  if (b.aiDailyLimit !== undefined) setSetting('ai_daily_limit', String(Math.max(1, Math.min(10000, Number(b.aiDailyLimit) || 50))))
  if (b.aiGuestLimit !== undefined) setSetting('ai_guest_limit', String(Math.max(0, Math.min(10000, Number.isFinite(Number(b.aiGuestLimit)) ? Number(b.aiGuestLimit) : 10))))
  if (b.aiApiBase !== undefined) {
    const base = String(b.aiApiBase || '').trim().replace(/\/+$/, '')
    setSetting('ai_api_base', base.length > 200 ? base.slice(0, 200) : base)
  }
  if (b.aiApiKey !== undefined && String(b.aiApiKey).trim()) {
    setSetting('ai_api_key', String(b.aiApiKey).trim().slice(0, 500))
  }
  if (b.aiApiKeyClear) setSetting('ai_api_key', '')
  if (b.collectEnabled !== undefined) setSetting('collect_enabled', b.collectEnabled ? '1' : '0')
  if (b.collectIntervalMin !== undefined) setSetting('collect_interval_min', String(Math.max(5, Math.min(10080, Number(b.collectIntervalMin) || 60))))
  if (b.collectLimit !== undefined) setSetting('collect_limit', String(Math.max(1, Math.min(30, Number(b.collectLimit) || 10))))
  if (b.collectSources !== undefined) setSetting('collect_sources', JSON.stringify(Array.isArray(b.collectSources) ? COLLECT_SOURCES.filter((s) => b.collectSources.includes(s)) : []))
  if (b.collectExcludeTags !== undefined) setSetting('collect_exclude_tags', String(b.collectExcludeTags || '').slice(0, 500))
  if (b.collectMaxWidth !== undefined) setSetting('collect_max_width', String(Math.max(0, Math.min(500, Number(b.collectMaxWidth) || 0))))
  if (b.collectMaxBeads !== undefined) setSetting('collect_max_beads', String(Math.max(0, Math.min(1000000, Number(b.collectMaxBeads) || 0))))
  if (b.smtpHost !== undefined) setSetting('smtp_host', String(b.smtpHost || '').trim().slice(0, 200))
  if (b.smtpPort !== undefined) setSetting('smtp_port', String(Math.max(1, Math.min(65535, Number(b.smtpPort) || 465))))
  if (b.smtpUser !== undefined) setSetting('smtp_user', String(b.smtpUser || '').trim().slice(0, 200))
  if (b.smtpPass !== undefined && String(b.smtpPass).trim()) setSetting('smtp_pass', String(b.smtpPass).trim().slice(0, 500))
  if (b.smtpPassClear) setSetting('smtp_pass', '')
  if (b.smtpFrom !== undefined) setSetting('smtp_from', String(b.smtpFrom || '').trim().slice(0, 200))
  if (b.checkinPoints !== undefined) setSetting('checkin_points', String(Math.max(1, Math.min(1000, Number(b.checkinPoints) || 10))))
  if (b.checkinStreakBonus !== undefined) setSetting('checkin_streak_bonus', String(Math.max(0, Math.min(1000, Number(b.checkinStreakBonus) || 5))))
  if (b.exchangeCost !== undefined) setSetting('exchange_cost', String(Math.max(1, Math.min(10000, Number(b.exchangeCost) || 20))))
  if (b.exchangeQuota !== undefined) setSetting('exchange_quota', String(Math.max(1, Math.min(1000, Number(b.exchangeQuota) || 5))))
  log(req.user.uid, 'admin_settings', '更新系统设置', req)
  res.json({ ok: true })
})

/** 测试 SMTP 邮件配置：向管理员编辑的收件地址发一封测试邮件 */
app.post('/api/admin/smtp-test', auth, adminOnly, async (req, res, next) => {
  try {
    const to = String((req.body || {}).to || '').trim()
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: '请输入正确的收件地址' })
    const cfg = smtpConfig()
    if (!smtpReady(cfg)) return res.status(503).json({ error: '请先填写完整的 SMTP 配置（服务器/端口/账号/密码）' })
    const testHtml = mailShell('SMTP 配置测试',
      '<p style="margin-top:0">你好：</p>' +
      '<p>这是一封来自 <b>拼豆工坊</b> 的测试邮件，说明后台配置的 SMTP 邮件服务<b style="color:#16a34a">已生效</b>，可以正常使用「忘记密码 → 邮箱找回」功能。</p>' +
      '<p style="margin-bottom:0;font-size:13px;color:#6b7280">如需修改邮件配置，请前往「后台管理 → 系统设置 → 邮件服务」。</p>',
      '这是一封测试邮件，由拼豆工坊自动发送。'
    )
    const ok = await sendMail(to, '【拼豆工坊】SMTP 配置测试', testHtml)
    if (!ok) return res.status(503).json({ error: '邮件配置不完整，无法发送' })
    log(req.user.uid, 'admin_smtp_test', '测试 SMTP 发送成功', req)
    res.json({ ok: true })
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e)
    let friendly = msg
    if (/ENOTFOUND|EAI_AGAIN/.test(msg)) friendly = 'SMTP 服务器地址无法解析，请检查主机名'
    else if (/ECONNREFUSED/.test(msg)) friendly = 'SMTP 连接被拒绝，请检查端口/防火墙'
    else if (/ETIMEDOUT|ESOCKET|超时/.test(msg)) friendly = 'SMTP 连接或响应超时，请检查服务器/端口'
    else if (/EAUTH|535|authentication/i.test(msg)) friendly = 'SMTP 认证失败，请检查账号/密码/授权码'
    res.status(500).json({ error: '发送失败：' + friendly })
  }
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

/* 公开配置：功能开关 / 公告 / 维护模式 / 注册开关 / AI 额度 */
app.get('/api/config', (req, res) => {
  res.json({
    siteNotice: setting('site_notice', ''),
    maintenance: setting('maintenance', '0') === '1',
    registerOpen: setting('register_open', '1') === '1',
    features: {
      gallery: setting('feature_gallery', '1') === '1',
      generator: setting('feature_generator', '1') === '1',
      ai: setting('feature_ai', '1') === '1',
      palette: setting('feature_palette', '1') === '1',
      warehouse: setting('feature_warehouse', '1') === '1',
      share: setting('feature_share', '1') === '1'
    },
    ai: {
      enabled: setting('ai_enabled', '1') === '1',
      guestLimit: intSetting('ai_guest_limit', 10),
      userLimit: intSetting('ai_daily_limit', 50)
    }
  })
})

/* ???????????????????????????? */
app.get('/api/patterns', (req, res) => {
  const rows = db.prepare('SELECT * FROM patterns WHERE is_builtin = 1 AND status = ? ORDER BY featured DESC, updated_at DESC').all('published')
  res.json({ total: rows.length, patterns: rows.map(cleanPattern) })
})

app.get('/api/patterns/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM patterns WHERE id = ? AND is_builtin = 1 AND status = ?').get(String(req.params.id), 'published')
  if (!p) return res.status(404).json({ error: '图纸不存在' })
  res.json(cleanPattern(p))
})

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ai: !!(process.env.DASHSCOPE_API_KEY || ''), maintenance: setting('maintenance', '0') === '1' })
})


/* ================= 积分 / 每日签到 / 积分兑换 AI 额度 ================= */
app.get('/api/points', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.uid)
  if (!u) return res.status(404).json({ error: '用户不存在' })
  const today = todayStr()
  res.json({
    points: Number(u.points) || 0,
    streak: Number(u.checkin_streak) || 0,
    lastCheckin: u.last_checkin_date,
    canCheckin: u.last_checkin_date !== today,
    aiExtraToday: aiExtraToday(u.id),
    checkinPoints: intSetting('checkin_points', 10),
    checkinStreakBonus: intSetting('checkin_streak_bonus', 5),
    exchangeCost: intSetting('exchange_cost', 20),
    exchangeQuota: intSetting('exchange_quota', 5),
    aiDailyLimit: intSetting('ai_daily_limit', 50)
  })
})

app.post('/api/checkin', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.uid)
  if (!u) return res.status(404).json({ error: '用户不存在' })
  const today = todayStr()
  if (u.last_checkin_date === today) return res.status(400).json({ error: '今天已经签过到了，明天再来吧' })
  const streak = u.last_checkin_date === yesterdayStr() ? (Number(u.checkin_streak) || 0) + 1 : 1
  const base = intSetting('checkin_points', 10)
  const bonus = streak >= 7 ? intSetting('checkin_streak_bonus', 5) : 0
  const gained = base + bonus
  db.prepare('UPDATE users SET points = points + ?, last_checkin_date = ?, checkin_streak = ? WHERE id = ?').run(gained, today, streak, u.id)
  log(u.id, 'checkin', `每日签到 连续${streak}天 +${gained}积分`, req)
  res.json({ ok: true, gained, points: (Number(u.points) || 0) + gained, streak, bonus })
})

app.post('/api/ai/exchange', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.uid)
  if (!u) return res.status(404).json({ error: '用户不存在' })
  const cost = intSetting('exchange_cost', 20)
  const quota = intSetting('exchange_quota', 5)
  const points = Number(u.points) || 0
  if (points < cost) return res.status(400).json({ error: `积分不足：兑换需 ${cost} 积分，当前 ${points}` })
  const today = todayStr()
  const extra = u.ai_extra_date === today ? Number(u.ai_extra_quota) || 0 : 0
  db.prepare('UPDATE users SET points = points - ?, ai_extra_date = ?, ai_extra_quota = ? WHERE id = ?').run(cost, today, extra + quota, u.id)
  log(u.id, 'ai_exchange', `积分兑换 AI 额度 +${quota} 次`, req)
  res.json({ ok: true, points: points - cost, extraToday: extra + quota })
})

/* ================= AI 生成历史（登录用户，云端保存最近 30 条） ================= */
app.get('/api/ai/history', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM ai_history WHERE user_id = ? ORDER BY id DESC LIMIT 12').all(req.user.uid)
  res.json({ history: rows.map((r) => ({ id: r.id, prompt: r.prompt, imageBase64: r.image_base64, paletteId: r.palette_id, width: r.width, model: r.model, createdAt: r.created_at })) })
})

app.delete('/api/ai/history/:id', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM ai_history WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.uid)
  if (r) db.prepare('DELETE FROM ai_history WHERE id = ?').run(r.id)
  res.json({ ok: true })
})

/* ================= 色卡管理（品牌色卡入库，前台可加载） ================= */
function cleanPaletteMeta(r) {
  return { id: r.id, title: r.title, brand: r.brand, description: r.description || '' }
}

app.get('/api/palettes', (req, res) => {
  const rows = db.prepare('SELECT * FROM palettes ORDER BY CASE brand WHEN \'国内\' THEN 0 WHEN \'进口\' THEN 1 ELSE 2 END, title').all()
  const colors = db.prepare('SELECT palette_id, code, hex, r, g, b, grp FROM palette_colors ORDER BY palette_id, sort').all()
  const map = {}
  for (const c of colors) {
    if (!map[c.palette_id]) map[c.palette_id] = []
    map[c.palette_id].push({ code: c.code, hex: c.hex, rgb: [c.r, c.g, c.b], group: c.grp })
  }
  res.json({ palettes: rows.map((r) => ({ ...cleanPaletteMeta(r), count: (map[r.id] || []).length, colors: map[r.id] || [] })) })
})

app.post('/api/admin/palettes', auth, adminOnly, (req, res) => {
  const b = req.body || {}
  const id = String(b.id || '').trim()
  const title = String(b.title || '').trim()
  const colors = Array.isArray(b.colors) ? b.colors : []
  if (!id || !/^[a-z0-9-]{2,40}$/i.test(id)) return res.status(400).json({ error: 'ID 需为 2~40 位字母数字或短横线' })
  if (!title) return res.status(400).json({ error: '请填写色卡名称' })
  if (!colors.length) return res.status(400).json({ error: '至少需要一个颜色' })
  if (db.prepare('SELECT id FROM palettes WHERE id = ?').get(id)) return res.status(409).json({ error: '色卡 ID 已存在' })
  const valid = colors
    .map((c) => ({ code: String(c.code || '').trim(), hex: String(c.hex || '').trim() }))
    .filter((c) => c.code && /^#[0-9a-fA-F]{6}$/.test(c.hex))
  if (!valid.length) return res.status(400).json({ error: '颜色格式不正确（需要 code + #RRGGBB）' })
  const brand = String(b.brand || '国内').trim() === '进口' ? '进口' : '国内'
  db.exec('BEGIN')
  try {
    db.prepare('INSERT INTO palettes (id, title, brand, description, created_at) VALUES (?,?,?,?,?)').run(id, title, brand, String(b.description || '').slice(0, 200), now())
    const stmt = db.prepare('INSERT OR REPLACE INTO palette_colors (palette_id, code, hex, r, g, b, grp, sort) VALUES (?,?,?,?,?,?,?,?)')
    valid.forEach((c, i) => {
      const r = parseInt(c.hex.slice(1, 3), 16), g = parseInt(c.hex.slice(3, 5), 16), bl = parseInt(c.hex.slice(5, 7), 16)
      stmt.run(id, c.code, c.hex.toUpperCase(), r, g, bl, 'C', i)
    })
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  log(req.user.uid, 'admin_palette_create', `新增色卡 ${id}`, req)
  res.json({ ok: true, id })
})

app.patch('/api/admin/palettes/:id', auth, adminOnly, (req, res) => {
  const id = String(req.params.id)
  const p = db.prepare('SELECT * FROM palettes WHERE id = ?').get(id)
  if (!p) return res.status(404).json({ error: '色卡不存在' })
  const b = req.body || {}
  db.prepare('UPDATE palettes SET title = ?, brand = ?, description = ? WHERE id = ?').run(
    b.title !== undefined ? String(b.title).trim().slice(0, 60) || p.title : p.title,
    b.brand !== undefined ? (String(b.brand) === '进口' ? '进口' : '国内') : p.brand,
    b.description !== undefined ? String(b.description).slice(0, 200) : p.description,
    id
  )
  log(req.user.uid, 'admin_palette_update', `修改色卡 ${id}`, req)
  res.json({ ok: true })
})

app.put('/api/admin/palettes/:id/colors', auth, adminOnly, (req, res) => {
  const id = String(req.params.id)
  const p = db.prepare('SELECT id FROM palettes WHERE id = ?').get(id)
  if (!p) return res.status(404).json({ error: '色卡不存在' })
  const colors = Array.isArray((req.body || {}).colors) ? req.body.colors : []
  const valid = colors
    .map((c) => ({ code: String(c.code || '').trim(), hex: String(c.hex || '').trim() }))
    .filter((c) => c.code && /^#[0-9a-fA-F]{6}$/.test(c.hex))
  if (!valid.length) return res.status(400).json({ error: '至少需要一个格式正确的颜色（code + #RRGGBB）' })
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM palette_colors WHERE palette_id = ?').run(id)
    const stmt = db.prepare('INSERT INTO palette_colors (palette_id, code, hex, r, g, b, grp, sort) VALUES (?,?,?,?,?,?,?,?)')
    valid.forEach((c, i) => {
      const r = parseInt(c.hex.slice(1, 3), 16), g = parseInt(c.hex.slice(3, 5), 16), bl = parseInt(c.hex.slice(5, 7), 16)
      stmt.run(id, c.code, c.hex.toUpperCase(), r, g, bl, 'C', i)
    })
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  log(req.user.uid, 'admin_palette_colors', `更新色卡 ${id} 颜色 ${valid.length} 个`, req)
  res.json({ ok: true, count: valid.length })
})

app.delete('/api/admin/palettes/:id', auth, adminOnly, (req, res) => {
  const id = String(req.params.id)
  const p = db.prepare('SELECT id FROM palettes WHERE id = ?').get(id)
  if (!p) return res.json({ ok: true })
  const used = db.prepare('SELECT COUNT(*) AS c FROM patterns WHERE palette_id = ?').get(id)
  if (used.c > 0) return res.status(400).json({ error: `该色卡被 ${used.c} 张图纸使用，无法删除` })
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM palette_colors WHERE palette_id = ?').run(id)
    db.prepare('DELETE FROM palettes WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  log(req.user.uid, 'admin_palette_delete', `删除色卡 ${id}`, req)
  res.json({ ok: true })
})

app.post('/api/admin/palettes/batch', auth, adminOnly, (req, res) => {
  const { ids, action } = req.body || {}
  const list = Array.isArray(ids) ? ids.map((x) => String(x)).filter(Boolean) : []
  if (!list.length) return res.status(400).json({ error: '请先勾选要操作的色卡' })
  if (!['delete'].includes(action)) return res.status(400).json({ error: '未知操作' })
  let processed = 0
  let skipped = 0
  for (const id of list) {
    const used = db.prepare('SELECT COUNT(*) AS c FROM patterns WHERE palette_id = ?').get(id)
    if (used && used.c > 0) { skipped++; continue }
    db.prepare('DELETE FROM palette_colors WHERE palette_id = ?').run(id)
    db.prepare('DELETE FROM palettes WHERE id = ?').run(id)
    processed++
  }
  log(req.user.uid, 'admin_palette_batch', '批量删除色卡 ' + processed + ' 个（跳过被使用 ' + skipped + ' 个）', req)
  res.json({ ok: true, processed, skipped })
})

/* ================= 图纸库采集（多来源，后台可控 + 定时） ================= */
function collectSourcesSetting() {
  const v = safeJson(setting('collect_sources', ''), COLLECT_SOURCES.slice())
  const arr = Array.isArray(v) ? v : []
  return COLLECT_SOURCES.filter((s) => arr.includes(s))
}

/** 采集过滤：排除标签 + 最大宽度 + 最大豆数 */
function collectFilters() {
  const excludeTags = String(setting('collect_exclude_tags', '')).split(',').map((s) => s.trim()).filter(Boolean)
  return {
    excludeTags,
    maxWidth: intSetting('collect_max_width', 0),
    maxBeads: intSetting('collect_max_beads', 0)
  }
}

app.get('/api/admin/collect/status', auth, adminOnly, (req, res) => {
  res.json({
    enabled: setting('collect_enabled', '0') === '1',
    intervalMin: intSetting('collect_interval_min', 60),
    limit: intSetting('collect_limit', 10),
    sources: COLLECT_SOURCES,
    collectSources: collectSourcesSetting(),
    lastRunAt: Number(setting('collect_last_run_at', '0')) || 0,
    lastResult: safeJson(setting('collect_last_result', ''), null)
  })
})

app.post('/api/admin/collect/run', auth, adminOnly, async (req, res) => {
  try {
    const limit = Math.min(30, Math.max(1, intSetting('collect_limit', 10)))
    const sources = collectSourcesSetting()
    const { excludeTags, maxWidth, maxBeads } = collectFilters()
    const result = await collectOnce({ limit, sources, excludeTags, maxWidth, maxBeads })
    setSetting('collect_last_run_at', String(Date.now()))
    setSetting('collect_last_result', JSON.stringify(result))
    log(req.user.uid, 'admin_collect_run', `手动采集完成 新增${result.added} 条`, req)
    res.json({ ok: true, result })
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e).slice(0, 200) })
  }
})

/* 采集预览：抓取+转换但不入库，供后台勾选后再导入 */
app.post('/api/admin/collect/preview', auth, adminOnly, async (req, res) => {
  try {
    const source = String((req.body || {}).source || '')
    const limit = Math.min(30, Math.max(1, Number((req.body || {}).limit) || 8))
    if (!COLLECT_SOURCES.includes(source)) return res.status(400).json({ error: '未知采集源' })
    const { excludeTags, maxWidth, maxBeads } = collectFilters()
    const items = await collectPreviewItems(source, { limit, excludeTags, maxWidth, maxBeads })
    log(req.user.uid, 'admin_collect_preview', `预览采集 ${source} 共 ${items.length} 条`, req)
    res.json({ ok: true, source, items })
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e).slice(0, 200) })
  }
})

/* 采集导入：把后台勾选的预览条目批量入库（幂等） */
app.post('/api/admin/collect/import', auth, adminOnly, (req, res) => {
  try {
    const items = (req.body || {}).items
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: '请先选择要导入的图纸' })
    const result = importPreviewItems(items)
    log(req.user.uid, 'admin_collect_import', `手动导入 ${result.added} 条`, req)
    res.json({ ok: true, result })
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e).slice(0, 200) })
  }
})

/** 定时采集：间隔 1 小时检查一次，开启且距上次超过 intervalMin 分钟才执行 */
export function startCollector() {
  const run = async () => {
    try {
      if (setting('collect_enabled', '0') !== '1') return
      const last = Number(setting('collect_last_run_at', '0')) || 0
      const min = intSetting('collect_interval_min', 60)
      if (Date.now() - last < min * 60 * 1000) return
      const limit = Math.min(30, Math.max(1, intSetting('collect_limit', 10)))
      const sources = collectSourcesSetting()
      const { excludeTags, maxWidth, maxBeads } = collectFilters()
      const result = await collectOnce({ limit, sources, excludeTags, maxWidth, maxBeads })
      setSetting('collect_last_run_at', String(Date.now()))
      setSetting('collect_last_result', JSON.stringify(result))
      console.log('[collector] 定时采集完成:', JSON.stringify(result))
    } catch (e) {
      console.error('[collector] 定时采集失败:', (e && e.message) || e)
    }
  }
  setTimeout(run, 30000)
  return setInterval(run, 60 * 60 * 1000)
}

/* 错误处理 */
app.use((err, req, res, next) => {
  const msg = String((err && err.message) || err)
  res.status(500).json({ error: msg.slice(0, 400) })
})

export default app
