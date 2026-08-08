/** 跨设备分享后端 API（开发时经 vite 代理 /api → 后端；部署时前端指向后端地址） */
export interface ShareEntryData {
  name?: string
  paletteId?: string
  rows?: string[][]
  tags?: string[]
  createdAt?: number
  patternKey?: string
}

const API_BASE = '/api'

export async function remoteSaveShare(id: string, entry: ShareEntryData): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/share/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    })
    return res.ok
  } catch {
    return false
  }
}

export async function remoteDeleteShare(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/share/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return res.ok || res.status === 404
  } catch {
    return false
  }
}

export async function remoteGetShare(id: string): Promise<ShareEntryData | null> {
  try {
    const res = await fetch(`${API_BASE}/share/${encodeURIComponent(id)}`)
    if (!res.ok) return null
    const data = (await res.json()) as { entry?: ShareEntryData }
    return data.entry ?? null
  } catch {
    return null
  }
}

export async function remoteHealth(): Promise<{ ok: boolean; ai: boolean } | null> {
  try {
    const res = await fetch(`${API_BASE}/health`)
    if (!res.ok) return null
    return (await res.json()) as { ok: boolean; ai: boolean }
  } catch {
    return null
  }
}
