const puppeteer = require('puppeteer-core')
const http = require('http')
const { spawn } = require('child_process')
const fs = require('fs')
const zlib = require('zlib')

const PORT = 4198
const BASE = `http://localhost:${PORT}/`
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const TEST_IMG = 'D:/Personal/Temp/pd_preview/test-image.png'

function crc32(buf) { let t = crc32.table; if (!t) { t = crc32.table = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c } } let crc = -1; for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xff]; return (crc ^ -1) >>> 0 }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const tb = Buffer.from(type, 'ascii'); const body = Buffer.concat([tb, data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]) }
function makePng() {
  const W = 64, H = 64
  const colors = [[255,0,0],[0,180,0],[0,0,255],[255,220,0],[255,255,255],[20,20,20]]
  const raw = Buffer.alloc((W*3+1)*H)
  for (let y = 0; y < H; y++) { raw[y*(W*3+1)] = 0; for (let x = 0; x < W; x++) { const c = colors[Math.floor(x / 22) % colors.length]; const off = y*(W*3+1)+1+x*3; raw[off]=c[0]; raw[off+1]=c[1]; raw[off+2]=c[2] } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=2
  const idat = zlib.deflateSync(raw, {level:9})
  fs.writeFileSync(TEST_IMG, Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), chunk('IHDR',ihdr), chunk('IDAT',idat), chunk('IEND',Buffer.alloc(0))]))
}
makePng()

async function waitServer(url, timeout = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try { await new Promise((res, rej) => { const req = http.get(url, (r) => { r.resume(); res() }); req.on('error', rej); req.setTimeout(1000, () => { req.destroy(); rej(new Error('t')) }) }); return } catch { await new Promise((r) => setTimeout(r, 300)) }
  }
  throw new Error('server not ready')
}

async function clickByText(page, text) {
  return page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(t))
    if (b) { b.click(); return true }
    return false
  }, text)
}

;(async () => {
  const server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore', windowsHide: true })
  try {
    await waitServer(BASE)
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()) })
    page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))

    await page.goto(BASE + '#/generator', { waitUntil: 'networkidle0' })
    const input = await page.$('input[type=file]')
    await input.uploadFile(TEST_IMG)
    await new Promise((r) => setTimeout(r, 800))
    const uploaded = await page.evaluate(() => document.body.innerText.includes('test-image'))
    console.log(uploaded ? 'PASS  图片上传' : 'FAIL  图片上传')

    await clickByText(page, '生成图纸')
    await new Promise((r) => setTimeout(r, 3000))
    let body = await page.evaluate(() => document.body.innerText)
    const generated = body.includes('已保存在「我的图纸」') && body.includes('种颜色')
    console.log(generated ? 'PASS  生成图纸并自动保存' : 'FAIL  生成图纸（body: ' + body.slice(0, 220).replace(/\n+/g, ' | ') + '）')

    // ① 颜色重映射（留空）→ 用豆减少
    const beadsBefore = await page.evaluate(() => {
      const m = document.body.innerText.match(/共\s*(\d+)\s*颗豆/)
      return m ? Number(m[1]) : -1
    })
    const remapSet = await page.evaluate(() => {
      const sel = document.querySelector('details[open] select')
      if (!sel) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      setter.call(sel, '__empty')
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })
    await new Promise((r) => setTimeout(r, 500))
    const beadsAfterRemap = await page.evaluate(() => {
      const m = document.body.innerText.match(/共\s*(\d+)\s*颗豆/)
      return m ? Number(m[1]) : -1
    })
    console.log(remapSet && beadsAfterRemap >= 0 && beadsAfterRemap < beadsBefore
      ? 'PASS  颜色重映射：留空后用豆减少'
      : 'FAIL  颜色重映射（before=' + beadsBefore + ' after=' + beadsAfterRemap + '）')

    // ② 清空重映射 → 用豆恢复
    await clickByText(page, '清空重映射')
    await new Promise((r) => setTimeout(r, 400))
    const beadsAfterClear = await page.evaluate(() => {
      const m = document.body.innerText.match(/共\s*(\d+)\s*颗豆/)
      return m ? Number(m[1]) : -1
    })
    console.log(beadsAfterClear === beadsBefore ? 'PASS  清空重映射恢复用豆' : 'FAIL  清空重映射（' + beadsBefore + ' vs ' + beadsAfterClear + '）')

    // ③ 颜色合并 / 去杂色
    await page.evaluate(() => {
      const inp = document.querySelector('details[open] input[type=range]')
      if (!inp) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(inp, '12')
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      inp.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })
    await clickByText(page, '应用优化')
    await new Promise((r) => setTimeout(r, 600))
    body = await page.evaluate(() => document.body.innerText)
    console.log(body.includes('已合并') || body.includes('没有需要合并')
      ? 'PASS  颜色合并/去杂色'
      : 'FAIL  颜色合并/去杂色（body: ' + body.slice(0, 200) + '）')

    // ④ A4 分区打印（弹出新窗口）
    let a4ok = false
    const popupPromise = new Promise((res) => page.once('popup', (p) => res(p)))
    await clickByText(page, 'A4 分区打印')
    try {
      const popup = await Promise.race([
        popupPromise,
        new Promise((_, rej) => setTimeout(() => rej(new Error('no popup')), 5000))
      ])
      await new Promise((r) => setTimeout(r, 1200))
      const popupText = await popup.evaluate(() => document.body.innerText)
      a4ok = popupText.includes('第 1/') && popupText.includes('页')
      try { await popup.close() } catch { /* ignore */ }
    } catch { a4ok = false }
    console.log(a4ok ? 'PASS  A4 分区打印弹出打印页' : 'FAIL  A4 分区打印弹出打印页')

    // ⑤ 上传前裁剪：重新上传 → 开启裁剪 → 拖动右下角缩小选区 → 生成
    await page.goto(BASE + '#/generator', { waitUntil: 'networkidle0' })
    const input2 = await page.$('input[type=file]')
    await input2.uploadFile(TEST_IMG)
    await new Promise((r) => setTimeout(r, 800))
    const cropToggled = await page.evaluate(() => {
      const cb = [...document.querySelectorAll('input[type=checkbox]')].find((x) =>
        (x.closest('label')?.innerText || '').includes('裁剪图片')
      )
      if (!cb) return false
      cb.click()
      return true
    })
    await new Promise((r) => setTimeout(r, 500))
    const cropShown = await page.evaluate(() => !!document.querySelector('[data-testid="crop-wrap"]'))
    const sizeBefore = await page.evaluate(() => {
      const el = [...document.querySelectorAll('span')].find((x) => /\d+×\d+/.test(x.innerText || ''))
      return el ? el.innerText : ''
    })
    // 拖动右下角（se）手柄，从整图缩到约 42×30
    const dragOk = await page.evaluate(() => {
      const wrap = document.querySelector('[data-testid="crop-wrap"]')
      const se = wrap.querySelector('[data-handle="se"]')
      if (!wrap || !se) return false
      const wr = wrap.getBoundingClientRect()
      const sr = se.getBoundingClientRect()
      window.__dragStart = {
        x: sr.left + sr.width / 2,
        y: sr.top + sr.height / 2,
        baseX: wr.left,
        baseY: wr.top
      }
      return true
    })
    if (dragOk) {
      const d = await page.evaluate(() => window.__dragStart)
      await page.mouse.move(d.x, d.y)
      await page.mouse.down()
      await page.mouse.move(d.baseX + 42, d.baseY + 30, { steps: 5 })
      await page.mouse.up()
      await new Promise((r) => setTimeout(r, 300))
    }
    const sizeAfter = await page.evaluate(() => {
      const el = [...document.querySelectorAll('span')].find((x) => /\d+×\d+/.test(x.innerText || ''))
      return el ? el.innerText : ''
    })
    const badgeChanged = sizeBefore && sizeAfter && sizeBefore !== sizeAfter
    await clickByText(page, '生成图纸')
    await new Promise((r) => setTimeout(r, 3000))
    body = await page.evaluate(() => document.body.innerText)
    console.log(
      cropToggled && cropShown && dragOk && badgeChanged && body.includes('种颜色')
        ? 'PASS  上传前裁剪（选区 ' + (sizeAfter || '?') + '）'
        : 'FAIL  上传前裁剪（cropShown=' + cropShown + ' dragOk=' + dragOk + ' sizeBefore=' + sizeBefore + ' sizeAfter=' + sizeAfter + '）'
    )

    await page.goto(BASE + '#/warehouse', { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 400))
    const setOk = await page.evaluate(() => {
      const inp = document.querySelector('input[type=number]')
      if (!inp) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(inp, '100')
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      inp.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })
    await new Promise((r) => setTimeout(r, 400))
    console.log(setOk ? 'PASS  豆仓登记库存' : 'FAIL  豆仓登记库存')

    await page.goto(BASE + '#/pattern/builtin-heart', { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 500))
    body = await page.evaluate(() => document.body.innerText)
    console.log(/库存充足|还缺 \d+ 颗/.test(body) ? 'PASS  图例关联库存' : 'FAIL  图例关联库存')

    await page.goto(BASE + '#/editor/builtin-heart', { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 500))
    const paint = await page.evaluate(() => {
      const cell = document.querySelector('[data-cell]')
      if (!cell) return false
      cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
      return true
    })
    await new Promise((r) => setTimeout(r, 300))
    await clickByText(page, '保存')
    await new Promise((r) => setTimeout(r, 400))
    body = await page.evaluate(() => document.body.innerText)
    console.log(paint && body.includes('已保存') ? 'PASS  编辑器涂色+保存' : 'FAIL  编辑器涂色+保存')

    // ⑥ 撤销 / 重做（用未被其他用例碰过的 builtin-apple，首次进入副本=原始状态，结果确定）
    await page.goto(BASE + '#/', { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 400))
    await page.goto(BASE + '#/editor/builtin-apple', { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 700))
    const countCells = () =>
      page.evaluate(() => [...document.querySelectorAll('[data-cell]')].filter((c) => (c.innerText || '').trim() !== '').length)
    const cellsN = await countCells()
    const cellOk = await page.evaluate(() => {
      const cell = document.querySelector('[data-x="1"][data-y="0"]')
      if (!cell) return false
      cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 }))
      cell.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }))
      return true
    })
    await new Promise((r) => setTimeout(r, 400))
    const cellsPainted = await countCells()
    await clickByText(page, '撤销')
    await new Promise((r) => setTimeout(r, 400))
    const cellsUndo = await countCells()
    await clickByText(page, '重做')
    await new Promise((r) => setTimeout(r, 400))
    const cellsRedo = await countCells()
    console.log(
      cellOk && cellsPainted === cellsN + 1 && cellsUndo === cellsN && cellsRedo === cellsN + 1
        ? 'PASS  撤销/重做'
        : 'FAIL  撤销/重做（N=' + cellsN + ' painted=' + cellsPainted + ' undo=' + cellsUndo + ' redo=' + cellsRedo + '）'
    )

    // 回到原始状态，避免未保存修改触发离开确认弹窗阻塞导航
    await clickByText(page, '撤销')
    await new Promise((r) => setTimeout(r, 300))

    await page.goto(BASE + '#/mine', { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 400))
    await page.reload({ waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 500))
    body = await page.evaluate(() => document.body.innerText)
    console.log(body.includes('我的图纸（') ? 'PASS  本地持久化（我的图纸计数）' : 'FAIL  本地持久化')

    // ⑦ 图纸库扩充：首页能搜到新增内置图纸
    await page.goto(BASE + '#/', { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 400))
    await page.type('input[type=search]', '苹果')
    await new Promise((r) => setTimeout(r, 400))
    let homeBody = await page.evaluate(() => document.body.innerText)
    console.log(homeBody.includes('苹果') ? 'PASS  图纸库扩充（可搜到苹果）' : 'FAIL  图纸库扩充')

    // ⑧ 导入图纸（色号网格）
    await page.goto(BASE + '#/mine', { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 400))
    await clickByText(page, '导入图纸')
    await new Promise((r) => setTimeout(r, 400))
    await page.evaluate(() => {
      const ta = document.querySelector('textarea')
      if (!ta) return
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, 'A1,B23,.\n.,A1,B23\nB23,.,A1')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 500))
    const previewOk = await page.evaluate(() => document.body.innerText.includes('可导入'))
    await clickByText(page, '导入到我的图纸')
    await new Promise((r) => setTimeout(r, 600))
    body = await page.evaluate(() => document.body.innerText)
    const importMsgOk = body.includes('已导入')
    console.log(previewOk && importMsgOk ? 'PASS  导入图纸（色号网格）' : 'FAIL  导入图纸（preview=' + previewOk + ' importMsg=' + importMsgOk + '）')

    // ⑨ 拼豆进度追踪：详情页开启拼豆模式 → 点一格 → 进度+1，刷新后保留
    await page.goto(BASE + '#/pattern/builtin-heart', { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 500))
    const boardHint = await page.evaluate(() => document.body.innerText.includes('📦'))
    await clickByText(page, '拼豆模式')
    await new Promise((r) => setTimeout(r, 400))
    await page.evaluate(() => {
      const cell = document.querySelector('.grid-cell')
      const canvas = document.querySelector('canvas')
      if (cell) { cell.click(); return }
      if (canvas) {
        const r = canvas.getBoundingClientRect()
        canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
      }
    })
    await new Promise((r) => setTimeout(r, 400))
    const progAfter = await page.evaluate(() => {
      const m = document.body.innerText.match(/已完成\s*(\d+)\/(\d+)/)
      return m ? { done: Number(m[1]), total: Number(m[2]) } : null
    })
    await page.reload({ waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 600))
    await clickByText(page, '拼豆模式')
    await new Promise((r) => setTimeout(r, 300))
    const progPersist = await page.evaluate(() => {
      const m = document.body.innerText.match(/已完成\s*(\d+)\/(\d+)/)
      return m ? Number(m[1]) : -1
    })
    console.log(
      boardHint && progAfter && progAfter.done === 1 && progPersist === 1
        ? 'PASS  拼豆进度追踪（' + (progAfter ? progAfter.done + '/' + progAfter.total : '?') + '，刷新后保留）'
        : 'FAIL  拼豆进度（boardHint=' + boardHint + ' after=' + JSON.stringify(progAfter) + ' persist=' + progPersist + '）'
    )

    // ⑩ 换色卡：详情页转换到另一套色卡并保存副本
    await clickByText(page, '换色卡')
    await new Promise((r) => setTimeout(r, 300))
    const convertSelOk = await page.evaluate(() => {
      const sel = document.querySelector('select')
      if (!sel || sel.options.length < 2) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      setter.call(sel, sel.options[1].value)
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })
    await clickByText(page, '转换并保存副本')
    await new Promise((r) => setTimeout(r, 1200))
    const urlAfterConvert = page.url()
    const convertBody = await page.evaluate(() => document.body.innerText)
    const convertOk = convertSelOk && urlAfterConvert.includes('/pattern/') && !urlAfterConvert.includes('builtin-heart') && convertBody.includes('我的图纸')
    console.log(convertOk ? 'PASS  换色卡生成副本并跳转' : 'FAIL  换色卡（sel=' + convertSelOk + ' url=' + urlAfterConvert + '）')

    // ⑪ 购物清单：弹出打印窗口包含需购
    let shopOk = false
    const shopPopup = new Promise((res) => page.once('popup', (p) => res(p)))
    await clickByText(page, '购物清单')
    try {
      const popup = await Promise.race([shopPopup, new Promise((_, rej) => setTimeout(() => rej(new Error('no popup')), 5000))])
      await new Promise((r) => setTimeout(r, 1000))
      const popupText = await popup.evaluate(() => document.body.innerText)
      shopOk = popupText.includes('需购') && popupText.includes('色号')
      try { await popup.close() } catch { /* ignore */ }
    } catch { shopOk = false }
    console.log(shopOk ? 'PASS  购物清单导出（含需购）' : 'FAIL  购物清单导出')

    // ⑫ 仅用手头颜色生成：生成器勾选后仍能生成成功
    await page.goto(BASE + '#/generator', { waitUntil: 'networkidle0' })
    const input3 = await page.$('input[type=file]')
    await input3.uploadFile(TEST_IMG)
    await new Promise((r) => setTimeout(r, 800))
    const ownedToggle = await page.evaluate(() => {
      const cb = [...document.querySelectorAll('input[type=checkbox]')].find((x) =>
        (x.closest('label')?.innerText || '').includes('仅用手头颜色')
      )
      if (!cb) return false
      cb.click()
      return true
    })
    await clickByText(page, '生成图纸')
    await new Promise((r) => setTimeout(r, 3000))
    body = await page.evaluate(() => document.body.innerText)
    const ownedGenOk = ownedToggle && (body.includes('已保存在') || body.includes('种颜色'))
    console.log(ownedGenOk ? 'PASS  仅用手头颜色生成' : 'FAIL  仅用手头颜色生成（toggle=' + ownedToggle + '）')

    await browser.close()
    console.log(errors.length ? '\nERRORS:\n  ' + errors.join('\n  ') : '\nNo console/page errors.')
  } finally { server.kill() }
})().catch((e) => { console.error('DEEP FAILED:', e.message); process.exit(1) })