/**
 * 后端 API 请求工具：自动附带 JWT，统一错误处理，带超时防止请求永久挂起
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

/** 带超时的 fetch：避免后端不可用/网络异常时请求永久挂起（表现为点击“没反应”） */
export async function fetchTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const STATUS_TEXT: Record<number, string> = {
  400: '请求参数有误',
  401: '登录已过期，请重新登录',
  403: '没有权限执行此操作',
  404: '请求的接口不存在',
  408: '请求超时',
  413: '上传的文件过大',
  429: '请求过于频繁，请稍后再试',
  500: '服务器内部错误',
  502: '网关错误，请稍后重试',
  503: '服务暂不可用',
  504: '网关超时，请稍后重试'
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string> | undefined) || {})
  }
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = 'Bearer ' + token
  let res: Response
  try {
    res = await fetchTimeout('/api' + path, { ...options, headers })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    const err: ApiError = new Error(aborted ? '请求超时，请检查网络后重试' : '无法连接服务器，请稍后重试')
    err.status = 0
    throw err
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    const err: ApiError = new Error(data.error || STATUS_TEXT[res.status] || '请求失败（' + res.status + '）')
    err.status = res.status
    throw err
  }
  return data as T
}
