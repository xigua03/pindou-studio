import app, { startCollector } from './app.mjs'
import { initDb } from './db.mjs'
import { markUpdateRestarted } from './update.mjs'

const PORT = Number(process.env.PORT) || 8787

initDb()
markUpdateRestarted()
startCollector()

const server = app.listen(PORT, () => {
  console.log(`pindou server listening on http://localhost:${PORT}`)
})
// 与 Nginx 长连接兼容：Node 默认 keepAliveTimeout 仅 5s，闲置后浏览器/Nginx 复用旧连接会导致请求卡住（表现为“点击没反应”）
server.keepAliveTimeout = 65000
server.headersTimeout = 70000
