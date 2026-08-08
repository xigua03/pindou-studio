/**
 * 后端 API 请求工具：自动附带 JWT，统一错误处理
 */
const TOKEN_KEY = 'pd_token'

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* noop */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* noop */
  }
}

export interface ApiError extends Error {
  status?: number
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string> | undefined) || {})
  }
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch('/api' + path, { ...options, headers })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    const err: ApiError = new Error(data.error || `请求失败（${res.status}）`)
    err.status = res.status
    throw err
  }
  return data as T
}
