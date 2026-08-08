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

/** 初始化：建表 + 导入内置图纸 + 种子管理员 */
export function initDb() {
  importBuiltinPatterns()
  seedAdmin()
}
