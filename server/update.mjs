/**
 * 在线更新：检查 GitHub 最新版本、读取/启动后台更新任务。
 * 更新由 scripts/update.mjs 以 detached 子进程方式执行，
 * 进度写入 server/data/update-status.json 与 update.log。
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(__dirname, 'data')
const STATUS_FILE = path.join(DATA_DIR, 'update-status.json')
const LOG_FILE = path.join(DATA_DIR, 'update.log')
const GITHUB_REPO = 'xigua03/pindou-studio'

function readJson(p, def) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return def
  }
}
function writeJson(p, obj) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8')
  } catch { /* ignore */ }
}
function appendLog(line) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.appendFileSync(LOG_FILE, '[' + new Date().toLocaleString('zh-CN', { hour12: false }) + '] ' + line + '\n', 'utf8')
  } catch { /* ignore */ }
}

export function getCurrentVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    return String(pkg.version || '0.0.0')
  } catch {
    return '0.0.0'
  }
}

function gitHead(short) {
  try {
    const r = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', timeout: 5000 })
    const v = String(r || '').trim()
    return short ? v.slice(0, 12) : v
  } catch {
    return ''
  }
}
function gitRemoteHead() {
  try {
    const r = execFileSync('git', ['ls-remote', 'origin', 'HEAD'], { cwd: ROOT, encoding: 'utf8', timeout: 8000 })
    return String(r || '').trim().split(/\s+/)[0] || ''
  } catch {
    return ''
  }
}
function gitBranch() {
  try {
    const r = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8', timeout: 5000 })
    return String(r || '').trim() || ''
  } catch {
    return ''
  }
}

function cmpVersions(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

async function fetchLatestFromGithub() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  const headers = { 'User-Agent': 'pindou-studio', Accept: 'application/vnd.github+json' }
  try {
    const res = await fetch('https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest', { headers, signal: controller.signal })
    if (res.ok) {
      const j = await res.json()
      return { tag: j.tag_name, name: j.name || '', notes: j.body || '', publishedAt: j.published_at || '' }
    }
    if (res.status === 404) {
      // 尚未发布 Release，回退读取 tags
      const res2 = await fetch('https://api.github.com/repos/' + GITHUB_REPO + '/tags', { headers, signal: controller.signal })
      if (res2.ok) {
        const tags = await res2.json()
        if (Array.isArray(tags) && tags.length) {
          const t = tags[0]
          return { tag: t.name, name: t.name, notes: '', publishedAt: '' }
        }
      }
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function getUpdateStatus() {
  const status = readJson(STATUS_FILE, null)
  const current = getCurrentVersion()
  let latest = null
  try {
    latest = await fetchLatestFromGithub()
  } catch { /* ignore */ }
  let logTail = ''
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf8')
    logTail = raw.split('\n').filter(Boolean).slice(-40).join('\n')
  } catch { /* ignore */ }
  const latestVersion = latest ? String(latest.tag).replace(/^v/i, '') : ''
  // 无 Release 时用 git 提交对比（本地 HEAD vs 远程 origin/HEAD）
  const localCommit = gitHead(true)
  const branch = gitBranch()
  let remoteCommit = ''
  if (!latestVersion && localCommit) {
    remoteCommit = gitRemoteHead()
    if (remoteCommit) remoteCommit = remoteCommit.slice(0, 12)
    if (!remoteCommit) {
      try {
        const r = execFileSync('git', ['rev-parse', '--short=12', 'origin/' + (branch || 'main')], { cwd: ROOT, encoding: 'utf8', timeout: 5000 })
        remoteCommit = String(r || '').trim()
      } catch { /* ignore */ }
    }
  }
  const latestLabel = latestVersion || (remoteCommit ? remoteCommit + ' (' + (branch || 'main') + ')' : '')
  const hasUpdate = !!(latestVersion && cmpVersions(latestVersion, current) > 0) || !!(remoteCommit && remoteCommit !== localCommit)
  return {
    ok: true,
    current,
    latestVersion: latestLabel,
    latestTag: latest ? latest.tag : '',
    releaseName: latest ? latest.name : '',
    releaseNotes: latest ? latest.notes : '',
    publishedAt: latest ? latest.publishedAt : '',
    hasUpdate,
    localCommit,
    remoteCommit,
    branch,
    running: !!(status && status.running),
    status: status || null,
    logTail
  }
}

export function startUpdate(opts) {
  const status = readJson(STATUS_FILE, null)
  if (status && status.running) {
    const started = Number(status.startedAt) || 0
    const staleMs = Date.now() - started
    const staleLimit = 30 * 60 * 1000 // 超过 30 分钟视为卡死，允许重新开始
    if (staleMs < staleLimit) {
      return { ok: false, error: '已有更新任务正在执行，请稍候再试' }
    }
    appendLog('检测到上一次更新任务疑似卡死（开始于 ' + new Date(started).toLocaleString('zh-CN', { hour12: false }) + '），已自动重置并重新开始')
  }
  const script = path.join(ROOT, 'scripts', 'update.mjs')
  if (!fs.existsSync(script)) return { ok: false, error: '缺少 scripts/update.mjs 更新脚本' }
  const pm2Name = String((opts && opts.pm2Name) || 'pindou').trim() || 'pindou'
  let child
  try {
    child = spawn(process.execPath, [script, pm2Name], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env }
    })
    child.unref()
  } catch (e) {
    return { ok: false, error: '启动更新进程失败: ' + String((e && e.message) || e) }
  }
  writeJson(STATUS_FILE, { running: true, startedAt: Date.now(), pid: child.pid || null, step: '启动中' })
  appendLog('后台更新任务已启动（pm2 进程名：' + pm2Name + '）')
  return { ok: true }
}