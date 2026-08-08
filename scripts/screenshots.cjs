const puppeteer = require('puppeteer-core')
const http = require('http')
const { spawn } = require('child_process')
const fs = require('fs')

const PORT = 4197
const BASE = `http://localhost:${PORT}/`
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = 'F:/Code/codex/pd/screenshots'
fs.mkdirSync(OUT, { recursive: true })

async function waitServer(url, timeout = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try { await new Promise((res, rej) => { const req = http.get(url, (r) => { r.resume(); res() }); req.on('error', rej); req.setTimeout(1000, () => { req.destroy(); rej(new Error('t')) }) }); return } catch { await new Promise((r) => setTimeout(r, 300)) }
  }
  throw new Error('server not ready')
}

;(async () => {
  const server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore', windowsHide: true })
  try {
    await waitServer(BASE)
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1360, height: 950 })
    const shots = [
      ['', 'home.png'],
      ['pattern/builtin-cat', 'detail-cat.png'],
      ['generator', 'generator.png'],
      ['warehouse', 'warehouse.png'],
      ['palette', 'palette.png'],
      ['mine', 'mine.png']
    ]
    for (const [hash, name] of shots) {
      await page.goto(BASE + '#/' + hash, { waitUntil: 'networkidle0' })
      await new Promise((r) => setTimeout(r, 600))
      await page.screenshot({ path: OUT + '/' + name, fullPage: false })
      console.log('shot', name)
    }
    await browser.close()
  } finally { server.kill() }
})().catch((e) => { console.error('SHOT FAILED:', e.message); process.exit(1) })