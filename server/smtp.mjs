/**
 * Minimal SMTP client built on node:net + node:tls.
 *
 * Why: nodemailer 9.x hangs on TLS connections under Node 24 in this environment
 * (no response on any server), so we implement the small SMTP subset needed for
 * the password-reset emails:
 *   connect(greeting) -> EHLO -> (STARTTLS?) -> AUTH LOGIN/PLAIN -> MAIL FROM -> RCPT TO -> DATA -> QUIT
 * Every step has a timeout, so the API never hangs forever.
 */
import net from 'node:net'
import tls from 'node:tls'

const CONNECT_TIMEOUT = 10000
const STEP_TIMEOUT = 20000

/**
 * Line reader over a socket. Lines arriving while no consumer is waiting are
 * buffered, so multi-line SMTP replies (250-a / 250-b / 250 ok) are never lost.
 */
function makeReader(sock) {
  let buf = ''
  const queue = []
  const pending = []
  sock.on('data', (d) => {
    buf += d.toString('utf8')
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '')
      buf = buf.slice(idx + 1)
      const waiter = queue.shift()
      if (waiter) waiter(line)
      else pending.push(line)
    }
  })
  return {
    next() {
      if (pending.length) {
        const line = pending.shift()
        return Promise.resolve(line)
      }
      return new Promise((resolve) => queue.push(resolve))
    }
  }
}

function connect(host, port, secure) {
  return new Promise((resolve, reject) => {
    let sock
    try {
      sock = secure
        ? tls.connect({ host, port, servername: host, rejectUnauthorized: false })
        : net.connect({ host, port })
    } catch (e) {
      reject(e)
      return
    }
    const timer = setTimeout(() => {
      try { sock.destroy() } catch { /* ignore */ }
      reject(new Error('SMTP 连接超时，请检查服务器地址/端口'))
    }, CONNECT_TIMEOUT)
    const onError = (e) => {
      clearTimeout(timer)
      reject(e)
    }
    const onConnect = () => {
      clearTimeout(timer)
      sock.removeListener('error', onError)
      resolve(sock)
    }
    sock.once('error', onError)
    sock.once(secure ? 'secureConnect' : 'connect', onConnect)
  })
}

/** Read one SMTP reply, which may span multiple lines (250-a / 250-b / 250 ok). */
function readReply(reader) {
  return new Promise((resolve, reject) => {
    const lines = []
    const step = (line) => {
      lines.push(line)
      const m = /^(\d{3})([ -])(.*)$/.exec(line)
      if (!m) return reject(new Error('SMTP 响应异常：' + line))
      if (m[2] === ' ') resolve({ code: m[1], lines: lines.slice() })
      else reader.next().then(step, reject)
    }
    reader.next().then(step, reject)
  })
}

function withTimeout(promise, ms, msg) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(msg)), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

function chunkBase64(str) {
  const b64 = Buffer.from(str, 'utf8').toString('base64')
  const out = []
  for (let i = 0; i < b64.length; i += 76) out.push(b64.slice(i, i + 76))
  return out
}

function buildMessage({ from, to, subject, html, text }) {
  const boundary = '----=_Pindou_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const enc = (s) => '=?UTF-8?B?' + Buffer.from(String(s), 'utf8').toString('base64') + '?='
  const lines = [
    'From: ' + String(from).replace(/\r|\n/g, ' '),
    'To: ' + String(to).replace(/\r|\n/g, ' '),
    'Subject: ' + enc(subject),
    'MIME-Version: 1.0',
    'Date: ' + new Date().toUTCString(),
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    ...chunkBase64(text || '请使用支持 HTML 的邮件客户端查看'),
    '--' + boundary,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    ...chunkBase64(html || '<p></p>'),
    '--' + boundary + '--',
    ''
  ]
  // Dot-stuffing: a line starting with "." must be escaped to ".."
  return lines.join('\r\n').replace(/^\./gm, '..')
}

/**
 * Send one email.
 * @param {{host:string, port:number, user:string, pass:string, from:string, to:string, subject:string, html?:string, text?:string}} opts
 * @returns {Promise<boolean>}
 */
export async function sendMail({ host, port, user, pass, from, to, subject, html, text }) {
  if (!host || !user || !pass || !from || !to) throw new Error('SMTP 配置不完整')
  const secure = Number(port) === 465
  let sock
  try {
    sock = await connect(host, Number(port), secure)
  } catch (e) {
    throw new Error(e && e.message ? e.message : 'SMTP 连接失败')
  }
  let reader = makeReader(sock)
  const sendLine = (line) => sock.write(line + '\r\n')
  const reply = () => withTimeout(readReply(reader), STEP_TIMEOUT, 'SMTP 服务器无响应（超时）')

  try {
    // 1. greeting
    let r = await reply()
    if (r.code !== '220') throw new Error('SMTP 服务器异常：' + r.lines[0])

    // 2. EHLO
    sendLine('EHLO pindou.local')
    r = await reply()
    if (r.code !== '250') throw new Error('EHLO 失败：' + r.lines[0])
    const caps = r.lines.join('\n').toUpperCase()

    // 3. STARTTLS upgrade (non-implicit TLS and server supports it)
    if (!secure && /STARTTLS/.test(caps)) {
      sendLine('STARTTLS')
      r = await reply()
      if (r.code !== '220') throw new Error('STARTTLS 失败：' + r.lines[0])
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('TLS 升级超时')), CONNECT_TIMEOUT)
        let upgraded
        try {
          upgraded = tls.connect({ socket: sock, servername: host, rejectUnauthorized: false }, () => {
            clearTimeout(t)
            resolve()
          })
        } catch (e) {
          clearTimeout(t)
          reject(e)
          return
        }
        sock = upgraded
        upgraded.once('error', (e) => { clearTimeout(t); reject(e) })
      })
      reader = makeReader(sock)
      sendLine('EHLO pindou.local')
      r = await reply()
      if (r.code !== '250') throw new Error('EHLO 失败：' + r.lines[0])
    }

    // 4. AUTH LOGIN / PLAIN
    const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64')
    sendLine('AUTH LOGIN')
    r = await reply()
    if (r.code !== '334' && /AUTH PLAIN/.test(caps)) {
      sendLine('AUTH PLAIN ' + b64('\u0000' + user + '\u0000' + pass))
      r = await reply()
    } else if (r.code === '334') {
      sendLine(b64(user))
      r = await reply()
      if (r.code === '334') {
        sendLine(b64(pass))
        r = await reply()
      }
    }
    if (r.code !== '235') throw new Error('SMTP 认证失败：' + (r.lines[0] || '请检查账号/密码'))

    // 5. MAIL FROM / RCPT TO
    sendLine('MAIL FROM:<' + from.replace(/[<>]/g, '') + '>')
    r = await reply()
    if (r.code !== '250') throw new Error('发件人被拒绝：' + r.lines[0])
    sendLine('RCPT TO:<' + to.replace(/[<>]/g, '') + '>')
    r = await reply()
    if (r.code !== '250') throw new Error('收件人被拒绝：' + r.lines[0])

    // 6. DATA
    sendLine('DATA')
    r = await reply()
    if (r.code !== '354') throw new Error('DATA 失败：' + r.lines[0])
    sock.write(buildMessage({ from, to, subject, html, text }) + '.\r\n')
    r = await reply()
    if (r.code !== '250') throw new Error('发送失败：' + r.lines[0])

    // 7. QUIT
    try { sendLine('QUIT'); await withTimeout(readReply(reader), 5000, '') } catch { /* ignore */ }
    return true
  } finally {
    try { sock.destroy() } catch { /* ignore */ }
  }
}
