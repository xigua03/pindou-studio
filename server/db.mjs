/**
 * 数据库层：node:sqlite（Node 24 内置，零原生依赖）
 * 数据文件：server/data/pindou.db
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import bcrypt from 'bcryptjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_FILE = path.join(__dirname, 'data', 'pindou.db')
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })

export const db = new DatabaseSync(DB_FILE)
db.exec('PRAGMA journal_mode = WAL')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT,
  avatar TEXT,
  bio TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS patterns (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  tags TEXT,
  palette_id TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  rows TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'published',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  difficulty TEXT,
  bead_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  pattern_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, pattern_id)
);
CREATE TABLE IF NOT EXISTS pattern_groups (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  pattern_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory (
  user_id INTEGER NOT NULL,
  palette_id TEXT NOT NULL,
  code TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, palette_id, code)
);
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  entry TEXT NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  prompt TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  content TEXT NOT NULL,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  reply TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS palettes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '国内',
  description TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS palette_colors (
  palette_id TEXT NOT NULL,
  code TEXT NOT NULL,
  hex TEXT NOT NULL,
  r INTEGER NOT NULL DEFAULT 0,
  g INTEGER NOT NULL DEFAULT 0,
  b INTEGER NOT NULL DEFAULT 0,
  grp TEXT NOT NULL DEFAULT 'C',
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (palette_id, code)
);
CREATE TABLE IF NOT EXISTS ai_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  image_base64 TEXT NOT NULL,
  palette_id TEXT,
  width INTEGER,
  model TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_history_user ON ai_history(user_id);
CREATE INDEX IF NOT EXISTS idx_patterns_user ON patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id);
`)

/** 内置图纸：启动时从 src/data/patterns.json 导入（已存在则跳过） */
export function importBuiltinPatterns() {
  const jsonPath = path.resolve(__dirname, '..', 'src', 'data', 'patterns.json')
  if (!fs.existsSync(jsonPath)) return 0
  let count = 0
  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO patterns (id, user_id, name, description, tags, palette_id, width, height, rows, source, status, is_builtin, difficulty, bead_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)'
    )
    for (const p of raw) {
      const rows = p.rows.map((r) => [...r].map((ch) => (ch === '.' ? '.' : (p.legend && p.legend[ch]) || '.')))
      const height = rows.length
      const width = height > 0 ? rows[0].length : 0
      let beads = 0
      for (const row of rows) for (const c of row) if (c && c !== '.') beads++
      const difficulty = beads < 500 ? '简单' : beads <= 2000 ? '中等' : '复杂'
      stmt.run(
        String(p.id), null, String(p.name || '未命名'), String(p.description || ''),
        JSON.stringify(p.tags || []), String(p.paletteId || 'mard-221-github'),
        width, height, JSON.stringify(rows), 'builtin', 'published',
        difficulty, beads, Date.now(), Date.now()
      )
      count++
    }
  } catch (e) {
    console.error('内置图纸导入失败:', e.message)
  }
  return count
}

/** 种子管理员：默认 admin / admin123 */
export function seedAdmin() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM users WHERE role = ?').get('admin')
  if (n && n.c > 0) return
  const hash = bcrypt.hashSync('admin123', 10)
  db.prepare('INSERT INTO users (username, email, password_hash, nickname, role, status, created_at) VALUES (?,?,?,?,?,?,?)').run(
    'admin', 'admin@local.dev', hash, '管理员', 'admin', 'active', Date.now()
  )
  console.log('[seed] 默认管理员已创建：admin / admin123（请尽快在后台修改）')
}

/** 轻量迁移：给老库补新列 */
function migrate() {
  const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name))
  const acols = cols('ai_usage')
  if (!acols.has('guest_id')) db.exec('ALTER TABLE ai_usage ADD COLUMN guest_id TEXT')
  const pcols = cols('patterns')
  if (!pcols.has('source_label')) db.exec('ALTER TABLE patterns ADD COLUMN source_label TEXT')
  if (!pcols.has('featured')) db.exec('ALTER TABLE patterns ADD COLUMN featured INTEGER NOT NULL DEFAULT 0')
  const ucols = cols('users')
  if (!ucols.has('points')) db.exec('ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0')
  if (!ucols.has('last_checkin_date')) db.exec('ALTER TABLE users ADD COLUMN last_checkin_date TEXT')
  if (!ucols.has('checkin_streak')) db.exec('ALTER TABLE users ADD COLUMN checkin_streak INTEGER NOT NULL DEFAULT 0')
  if (!ucols.has('ai_extra_date')) db.exec('ALTER TABLE users ADD COLUMN ai_extra_date TEXT')
  if (!ucols.has('ai_extra_quota')) db.exec('ALTER TABLE users ADD COLUMN ai_extra_quota INTEGER NOT NULL DEFAULT 0')
}

/** 色卡种子：首次建库时从 src/data/palettes/*.json 导入全部品牌色卡到数据库（已有则跳过） */
export function seedPalettes() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM palettes').get()
  if (n && n.c > 0) return 0
  const dir = path.resolve(__dirname, '..', 'src', 'data', 'palettes')
  if (!fs.existsSync(dir)) return 0
  const pStmt = db.prepare('INSERT OR IGNORE INTO palettes (id, title, brand, description, created_at) VALUES (?,?,?,?,?)')
  const cStmt = db.prepare('INSERT OR IGNORE INTO palette_colors (palette_id, code, hex, r, g, b, grp, sort) VALUES (?,?,?,?,?,?,?,?)')
  const DOMESTIC = new Set(['mard-221-github', 'mard-291-github', 'mard-221-alfonse-doudou', 'coco-291', 'dodo-291', 'kaka-284', 'manman-278', 'panpan-289', 'mixiaowo-290', 'xiaowu-291', 'huangdoudou-291', 'shishi-220', 'tongqu-120', 'youken-public-174', 'artkal-m-221-official', 'artkal-c-197-official', 'artkal-c197-m221-418-official'])
  let count = 0
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue
      let raw
      try { raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) } catch { continue }
      if (!raw || !raw.id || !Array.isArray(raw.colors)) continue
      const brand = DOMESTIC.has(raw.id) ? '国内' : '进口'
      pStmt.run(String(raw.id), String(raw.title || raw.id), brand, String(raw.description || ''), Date.now())
      raw.colors.forEach((c, i) => {
        const rgb = Array.isArray(c.rgb) ? c.rgb : [0, 0, 0]
        cStmt.run(String(raw.id), String(c.code), String(c.hex || ''), Number(rgb[0]) || 0, Number(rgb[1]) || 0, Number(rgb[2]) || 0, String(c.group || 'C'), i)
      })
      count++
    }
  } catch (e) {
    console.error('色卡种子导入失败:', e.message)
  }
  return count
}

/** 初始化：迁移 + 建表 + 导入内置图纸/色卡 + 种子管理员 */
export function initDb() {
  migrate()
  importBuiltinPatterns()
  seedPalettes()
  seedAdmin()
}
