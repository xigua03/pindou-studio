import app from './app.mjs'
import { initDb } from './db.mjs'

const PORT = Number(process.env.PORT) || 8787

initDb()

app.listen(PORT, () => {
  console.log(`pindou server listening on http://localhost:${PORT}`)
})
