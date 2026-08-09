/**
 * 在线更新执行脚本：由后台「版本更新」以 detached 子进程方式启动。
 * 流程：git fetch -> git reset --hard -> npm install -> npm run build -> 重启 pm2
 * 进度写入 server/data/update.log 与 update-status.json，后台可随时轮询查询。
 * 用法：node scripts/update.mjs [pm2进程名]
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'server', 'data')
const STATUS_FILE = path.join(DATA_DIR, 'update-status.json')
const LOG_FILE = path.join(DATA_DIR, 'update.log')
const pm2Name = process.argv[2] || 'pindou'

function writeStatus(patch) {
  let s = {}
  try {
    s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'))
  } catch { /* ignore */ }
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...s, ...patch }, null, 2), 'utf8')
}
function log(line) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const ts = new Date().toLocaleString('zh-CN', { hour12: false })
  fs.appendFileSync(LOG_FILE, '[' + ts + '] ' + line + '\n', 'utf8')
}
function run(cmd, args, label) {
  log('>>> ' + label)
  writeStatus({ running: true, step: label })
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 15 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 })
  if (r.stdout) {
    const t = String(r.stdout).trim()
    if (t) log(t.split('\n').slice(-30).join('\n'))
  }
  if (r.stderr) {
    const t = String(r.stderr).trim()
    if (t) log(t.split('\n').slice(-30).join('\n'))
  }
  if (r.error) throw new Error(label + ' 执行失败: ' + r.error.message)
  if (r.status !== 0) throw new Error(label + ' 失败（exit ' + r.status + '）')
  return String(r.stdout || '')
}

function main() {
  log('========== 开始在线更新 ==========')
  writeStatus({ running: true, startedAt: Date.now(), pid: process.pid, step: '准备中' })

  // 检查是否为 git 仓库
  const br = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  const branch = br.status === 0 ? String(br.stdout || '').trim() : ''
  if (!branch) {
    throw new Error('当前部署目录不是 git 仓库（或未安装 git），无法在线更新，请手动部署。')
  }
  log('当前分支: ' + branch)

  run('git', ['fetch', 'origin', branch], '拉取远程代码 (git fetch)')
  run('git', ['reset', '--hard', 'origin/' + branch], '切换到远程最新代码 (git reset --hard)')
  run('npm', ['install'], '安装依赖 (npm install)')
  run('npm', ['run', 'build'], '构建前端 (npm run build)')

  // 重启服务：优先 pm2，找不到则提示手动重启
  const pm2 = spawnSync('pm2', ['restart', pm2Name], { cwd: ROOT, encoding: 'utf8', timeout: 60000 })
  if (pm2.status === 0) {
    log('已通过 pm2 restart ' + pm2Name + ' 重启服务')
  } else {
    log('未找到 pm2 进程 ' + pm2Name + '，请手动重启服务：pm2 restart ' + pm2Name + '（或 node server/index.mjs）')
  }

  writeStatus({ running: false, finishedAt: Date.now(), ok: true, error: '', step: '完成' })
  log('========== 更新完成 ==========')
}

try {
  main()
  process.exit(0)
} catch (e) {
  const msg = String((e && e.message) || e)
  log('更新失败: ' + msg)
  writeStatus({ running: false, finishedAt: Date.now(), ok: false, error: msg, step: '失败' })
  process.exit(1)
}