const puppeteer = require('puppeteer-core')
const http = require('http')
const { spawn } = require('child_process')

const PORT = 4199
const BASE = `http://localhost:${PORT}/`
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

async function waitServer(url, timeout = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      await new Promise((res, rej) => {
        const req = http.get(url, (r) => { r.resume(); res() })
        req.on('error', rej)
        req.setTimeout(1000, () => { req.destroy(); rej(new Error('timeout')) })
      })
      return
    } catch { await new Promise((r) => setTimeout(r, 300)) }
  }
  throw new Error('server not ready')
}

;(async () => {
  const server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    windowsHide: true
  })
  try {
    await waitServer(BASE)
    const browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,900']
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    const errors = []
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push('[console] ' + msg.text()) })
    page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message))

    async function goto(hash, expectText) {
      await page.goto(BASE + '#/' + hash, { waitUntil: 'networkidle0', timeout: 15000 })
      await new Promise((r) => setTimeout(r, 300))
      const body = await page.evaluate(() => document.body.innerText)
      const ok = expectText ? body.includes(expectText) : true
      console.log(`${ok ? 'PASS' : 'FAIL'}  /#/${hash}  expect="${expectText}"`)
      if (!ok) console.log('   body snippet:', body.slice(0, 300).replace(/\n+/g, ' | '))
      return body
    }

    await goto('', '把喜欢的图片')

    // 搜索过滤
    await page.type('input[type=search]', '草莓')
    await new Promise((r) => setTimeout(r, 400))
    const searchBody = await page.evaluate(() => document.body.innerText)
    console.log(searchBody.includes('草莓') && !searchBody.includes('小猫') ? 'PASS  首页搜索过滤' : 'FAIL  首页搜索过滤')
    await page.evaluate(() => { const i = document.querySelector('input[type=search]'); i.value = ''; i.dispatchEvent(new Event('input')) })

    await goto('pattern/builtin-heart', '用豆统计')

    // 收藏
    const favBtn = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      const b = btns.find((x) => x.textContent.includes('收藏'))
      if (b) { b.click(); return true }
      return false
    })
    console.log(favBtn ? 'PASS  点击收藏' : 'FAIL  未找到收藏按钮')

    await goto('generator', '图片转图纸')
    await goto('editor/builtin-heart', '编辑图纸')
    await goto('warehouse', '豆仓')
    await goto('palette', '颜色找色号')
    await goto('mine', '我的收藏')

    await page.screenshot({ path: 'D:/Personal/Temp/pd_preview/smoke-home.png' })
    await browser.close()

    console.log(errors.length ? '\nCONSOLE/PAGE ERRORS:\n  ' + errors.join('\n  ') : '\nNo console/page errors detected.')
  } finally {
    server.kill()
  }
})().catch((e) => { console.error('SMOKE FAILED:', e.message); process.exit(1) })