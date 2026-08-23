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
  let releaseInfo = null
  let tagInfo = null
  try {
    const res = await fetch('https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest', { headers, signal: controller.signal })
    if (res.ok) {
      const j = await res.json()
      releaseInfo = { tag: j.tag_name, name: j.name || '', notes: j.body || '', publishedAt: j.published_at || '' }
    }
  } catch { /* ignore */ }
  // 无论 Release 是否存在都读取 tags 取最高版本：只打 tag 未发 Release 时，
  // releases/latest 会停留在旧版（如 v1.3.0），导致漏判「有新版本」
  try {
    const res2 = await fetch('https://api.github.com/repos/' + GITHUB_REPO + '/tags?per_page=100', { headers, signal: controller.signal })
    if (res2.ok) {
      const tags = await res2.json()
      if (Array.isArray(tags) && tags.length) {
        const versionLike = tags.map((t) => String(t.name)).filter((n) => /^v?\d+\.\d+\.\d+/.test(n))
        tagInfo = versionLike.length ? versionLike.sort((a, b) => cmpVersions(b, a))[0] : String(tags[0].name)
      }
    }
  } catch { /* ignore */ }
  clearTimeout(timer)
  if (releaseInfo && tagInfo) {
    // 取 Release 与 tags 中版本更高的那个，保证发版后立即被检测到
    return cmpVersions(tagInfo, releaseInfo.tag) > 0
      ? { tag: tagInfo, name: tagInfo, notes: '', publishedAt: '' }
      : releaseInfo
  }
  // GitHub API 不可达（国内服务器常见）时，回退读取 CDN 上 main 分支的 package.json 版本号
  if (!releaseInfo && !tagInfo) {
    const viaCdn = await fetchRemotePackageJsonVersion()
    if (viaCdn) return viaCdn
  }
  return releaseInfo || (tagInfo ? { tag: tagInfo, name: tagInfo, notes: '', publishedAt: '' } : null)
}

/** 通过 CDN 镜像获取远端版本：GitHub API 被墙时兜底。
 *  优先用 data.jsdelivr.com 的 tags 列表（实时性最好），
 *  再回退到 @main 文件缓存（可能有几分钟滞后），最后试 raw.githubusercontent。 */
async function fetchRemotePackageJsonVersion() {
  // 1) jsDelivr data API：列出 repo 的全部 tag（已含最新 tag，实时性高）
  try {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), 8000)
    const res = await fetch('https://data.jsdelivr.com/v1/package/gh/' + GITHUB_REPO, { signal: c.signal })
    clearTimeout(t)
    if (res.ok) {
      const j = await res.json()
      const list = Array.isArray(j.versions) ? j.versions.map((v) => String(v)).filter((v) => /^\d+\.\d+\.\d+/.test(v)) : []
      if (list.length) {
        const top = list.sort((a, b) => cmpVersions(b, a))[0]
        return { tag: 'v' + top, name: 'v' + top, notes: '', publishedAt: '', from: 'data.jsdelivr.com' }
      }
    }
  } catch { /* ignore */ }
  // 2) jsDelivr 文件缓存（@main 可能滞后几分钟）
  const urls = [
    'https://cdn.jsdelivr.net/gh/' + GITHUB_REPO + '@main/package.json',
    'https://raw.githubusercontent.com/' + GITHUB_REPO + '/main/package.json'
  ]
  for (const url of urls) {
    try {
      const c = new AbortController()
      const t = setTimeout(() => c.abort(), 8000)
      const res = await fetch(url, { signal: c.signal })
      clearTimeout(t)
      if (!res.ok) continue
      const j = await res.json()
      const v = String(j.version || '')
      if (/^\d+\.\d+\.\d+/.test(v)) {
        return { tag: 'v' + v, name: 'v' + v, notes: '', publishedAt: '', from: url }
      }
    } catch { /* ignore */ }
  }
  return null
}

/** 是否处于“构建完成待重启”状态（新脚本写入 needsRestart，旧卡死状态 step 含“重启服务”） */
function isRestartPending(status) {
  return !!(status && (status.needsRestart || String(status.step || '').includes('重启服务')))
}

export async function getUpdateStatus() {
  const status = readJson(STATUS_FILE, null)
  const current = getCurrentVersion()
  let latest = null
  try {
    latest = await fetchLatestFromGithub()
  } catch { /* ignore */ }
  const latestVersion = latest ? String(latest.tag).replace(/^v/i, '') : ''
  const localCommit = gitHead(true)
  const branch = gitBranch()
  // 始终用 git 查询真实远程提交（github.com 对国内服务器通常比 api.github.com 可达性好）。
  // 即使 CDN/API 版本号滞后，也能靠提交差异发现更新；反之 git 确认本地已是远程最新时，
  // 即使 CDN 版本号还停留在旧版（缓存滞后），也判定为「已是最新」并展示当前版本。
  let remoteCommit = ''
  if (localCommit) {
    remoteCommit = gitRemoteHead()
    if (remoteCommit) remoteCommit = remoteCommit.slice(0, 12)
  }
  const versionNewer = !!(latestVersion && cmpVersions(latestVersion, current) > 0)
  const gitDiffers = !!(remoteCommit && remoteCommit !== localCommit)
  const gitSame = !!(remoteCommit && remoteCommit === localCommit)
  const hasUpdate = versionNewer || gitDiffers
  let latestLabel
  if (latestVersion) {
    latestLabel = gitSame ? current : latestVersion
  } else if (remoteCommit) {
    latestLabel = gitDiffers ? remoteCommit + ' (' + (branch || 'main') + ')' : current
  } else {
    latestLabel = ''
  }
  // 僵尸状态识别：标记 running 但超过 30 分钟无进展（单步最长 20 分钟），视为上次更新被中断；
  // 若已进入“构建完成待重启”状态，超过 3 分钟仍未确认重启完成，视为重启疑似失败
  let running = !!(status && status.running)
  let stale = false
  const pendingRestart = isRestartPending(status)
  if (pendingRestart) {
    const markAt = Number(status.finishedAt) || Number(status.startedAt) || 0
    if (!markAt || Date.now() - markAt > 3 * 60 * 1000) {
      running = false
      stale = true
    }
  } else if (running && status.startedAt) {
    if (Date.now() - Number(status.startedAt) > 30 * 60 * 1000) {
      running = false
      stale = true
    }
  }
  // 执行日志窗口：仅在“更新中 / 待重启 / 疑似中断 / 上次失败”时显示，更新正常结束后自动隐藏
  const logVisible = !!(running || pendingRestart || stale || (status && status.ok === false))
  let logTail = ''
  if (logVisible) {
    try {
      const raw = fs.readFileSync(LOG_FILE, 'utf8')
      logTail = raw.split('\n').filter(Boolean).slice(-40).join('\n')
    } catch { /* ignore */ }
  }
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
    running,
    stale,
    needsRestart: pendingRestart,
    status: status || null,
    logTail,
    logVisible
  }
}

/** 重置更新状态：处于“构建完成待重启 / 重启疑似失败”时允许立即重置；其余仅在非 running 或已僵尸时允许 */
export function resetUpdateStatus() {
  const status = readJson(STATUS_FILE, null)
  if (status && status.running && !isRestartPending(status)) {
    const started = Number(status.startedAt) || 0
    if (Date.now() - started < 30 * 60 * 1000) {
      return { ok: false, error: '更新任务正在执行中，无法重置' }
    }
  }
  try {
    fs.rmSync(STATUS_FILE, { force: true })
  } catch { /* ignore */ }
  // 重置时顺便清空执行日志，避免未升级时展示旧日志
  try {
    fs.writeFileSync(LOG_FILE, '')
  } catch { /* ignore */ }
  return { ok: true }
}

/**
 * 服务重启后由启动钩子调用：若状态仍处于“构建完成、待重启”，
 * 说明更新脚本已成功重启服务，把状态标记为「完成」。
 */
export function markUpdateRestarted() {
  const status = readJson(STATUS_FILE, null)
  if (!isRestartPending(status)) return
  writeJson(STATUS_FILE, {
    ...status,
    running: false,
    ok: true,
    error: '',
    step: '完成',
    needsRestart: false,
    finishedAt: Date.now(),
    restartedAt: Date.now()
  })
  appendLog('服务已重启，在线更新完成')
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