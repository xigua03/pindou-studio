/**
 * 在线更新执行脚本：由后台「版本更新」以 detached 子进程方式启动。
 * 流程：git fetch -> git reset --hard -> npm install -> npm run build -> 重启 pm2
 * 进度实时写入 server/data/update.log 与 update-status.json，后台可随时轮询查询。
 * 用法：node scripts/update.mjs [pm2进程名]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'server', 'data')
const STATUS_FILE = path.join(DATA_DIR, 'update-status.json')
const LOG_FILE = path.join(DATA_DIR, 'update.log')
const pm2Name = process.argv[2] || 'pindou'
const STEP_TIMEOUT = 20 * 60 * 1000 // 单步最长 20 分钟

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

/**
 * 实时流式执行一个命令：stdout/stderr 按行即时写入日志，
 * 返回完整输出文本；超时或非零退出则 reject。
 */
function runStep(cmd, args, label) {
  return new Promise((resolve, reject) => {
    log('>>> ' + label)
    writeStatus({ running: true, step: label, stepStartedAt: Date.now() })
    let child
    try {
      child = spawn(cmd, args, {
        cwd: ROOT,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1', NPM_CONFIG_PROGRESS: 'false' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (e) {
      reject(new Error(label + ' 启动失败: ' + String((e && e.message) || e)))
      return
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      reject(new Error(label + ' 超时（超过 ' + Math.round(STEP_TIMEOUT / 60000) + ' 分钟）已被终止'))
    }, STEP_TIMEOUT)
    let buf = ''
    const lines = []
    const onData = (chunk) => {
      buf += chunk.toString('utf8')
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '').trimEnd()
        buf = buf.slice(idx + 1)
        if (line) {
          lines.push(line)
          log(line)
        }
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(label + ' 执行失败: ' + String((err && err.message) || err)))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const rest = buf.trimEnd()
      if (rest) {
        lines.push(rest)
        log(rest)
      }
      if (code !== 0) {
        reject(new Error(label + ' 失败（exit ' + code + '）'))
      } else {
        resolve(lines.join('\n'))
      }
    })
  })
}

async function main() {
  log('========== 开始在线更新 ==========')
  writeStatus({ running: true, startedAt: Date.now(), pid: process.pid, step: '准备中', error: '', ok: false })

  // 1. 检查是否为 git 仓库
  let branch = ''
  try {
    branch = (await runStep('git', ['rev-parse', '--abbrev-ref', 'HEAD'], '检查 git 仓库')).trim()
  } catch {
    throw new Error('当前部署目录不是 git 仓库（或未安装 git），无法在线更新，请手动部署。')
  }
  log('当前分支: ' + branch)

  // 2. 拉取代码
  await runStep('git', ['fetch', 'origin', branch], '拉取远程代码 (git fetch)')
  await runStep('git', ['reset', '--hard', 'origin/' + branch], '切换到远程最新代码 (git reset --hard)')

  // 3. 安装依赖（含构建所需 devDependencies）
  await runStep('npm', ['install'], '安装依赖 (npm install)')

  // 4. 构建前端
  await runStep('npm', ['run', 'build'], '构建前端 (npm run build)')

  // 5. 重启服务：优先 pm2，找不到则提示手动重启
  try {
    await runStep('pm2', ['restart', pm2Name], '重启服务 (pm2 restart ' + pm2Name + ')')
  } catch {
    log('未找到 pm2 进程 ' + pm2Name + '，请手动重启服务：pm2 restart ' + pm2Name + '（或 node server/index.mjs）')
  }

  writeStatus({ running: false, finishedAt: Date.now(), ok: true, error: '', step: '完成' })
  log('========== 更新完成 ==========')
}

try {
  await main()
  process.exit(0)
} catch (e) {
  const msg = String((e && e.message) || e)
  log('更新失败: ' + msg)
  writeStatus({ running: false, finishedAt: Date.now(), ok: false, error: msg, step: '失败' })
  process.exit(1)
}