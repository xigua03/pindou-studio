/**
 * 鉴权层：JWT + bcrypt + 中间件
 */
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

export const JWT_SECRET = process.env.JWT_SECRET || 'pindou-studio-dev-secret'
export const TOKEN_TTL = '30d'

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10)
}
export function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash)
}
export function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL })
}
export function randomToken() {
  return crypto.randomBytes(8).toString('hex')
}

/** 认证中间件：解析 Bearer token，注入 req.user */
export function auth(req, res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (!token) return res.status(401).json({ error: '未登录' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = payload
    next()
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' })
  }
}

/** 管理员中间件 */
export function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: '没有权限' })
  next()
}
