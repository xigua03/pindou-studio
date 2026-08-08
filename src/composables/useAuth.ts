/**
 * 登录态与云同步组合式函数
 * - 登录 / 注册 / 退出 / 资料 / 改密 / 注销
 * - AI 用量查询
 * - 云同步：本地与服务器数据合并（收藏取并集、图纸/分组按 id 合并、库存取最大）
 */
import { reactive, computed } from 'vue'
import type { Inventory, Pattern } from '../types'
import { api, getToken, setToken, clearToken } from '../utils/api'
import { useStore, type PatternGroup } from './useStore'

export interface User {
  id: number
  username: string
  email: string
  nickname: string
  avatar: string | null
  bio: string | null
  role: 'user' | 'admin'
  status: 'active' | 'banned'
  createdAt: number
  lastLoginAt: number | null
}

export interface AiUsage {
  today: number
  limit: number
  total: number
}

export interface SyncData {
  patterns: Pattern[]
  favorites: string[]
  groups: PatternGroup[]
  inventory: Inventory
}

interface AuthState {
  token: string
  user: User | null
  ready: boolean
}

const state = reactive<AuthState>({
  token: getToken(),
  user: null,
  ready: false
})

/** 供路由守卫等模块外直接读取登录态 */
export const authState = state

/** 云图纸 -> 本地图纸 */
function cloudToLocal(p: Pattern): Pattern {
  return {
    id: p.id,
    name: p.name,
    description: p.description || '',
    tags: p.tags || [],
    paletteId: p.paletteId,
    width: p.width,
    height: p.height,
    rows: p.rows,
    source: p.source === 'builtin' ? 'builtin' : 'edited',
    createdAt: p.createdAt || Date.now()
  }
}

export function useAuth() {
  const isLoggedIn = computed(() => !!state.token && !!state.user)
  const isAdmin = computed(() => state.user?.role === 'admin')

  async function fetchMe(): Promise<void> {
    if (!state.token) {
      state.user = null
      state.ready = true
      return
    }
    try {
      const data = await api<{ user: User }>('/auth/me')
      state.user = data.user
    } catch {
      clearToken()
      state.token = ''
      state.user = null
    }
    state.ready = true
  }

  async function register(username: string, email: string, password: string): Promise<void> {
    const data = await api<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password })
    })
    state.token = data.token
    setToken(data.token)
    state.user = data.user
  }

  async function login(account: string, password: string): Promise<void> {
    const data = await api<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account, password })
    })
    state.token = data.token
    setToken(data.token)
    state.user = data.user
  }

  function logout(): void {
    clearToken()
    state.token = ''
    state.user = null
  }

  async function updateProfile(patch: { nickname?: string; avatar?: string; bio?: string }): Promise<void> {
    const data = await api<{ user: User }>('/auth/update-profile', {
      method: 'POST',
      body: JSON.stringify(patch)
    })
    state.user = data.user
  }

  async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await api('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword })
    })
  }

  async function deleteAccount(password: string): Promise<void> {
    await api('/auth/delete-account', {
      method: 'POST',
      body: JSON.stringify({ password })
    })
    clearToken()
    state.token = ''
    state.user = null
  }

  async function aiUsage(): Promise<AiUsage> {
    return api<AiUsage>('/ai/usage/mine')
  }

  /** 云同步：拉取 -> 合并 -> 推送 -> 写回本地 */
  async function syncNow(): Promise<{ pushed: number; pulled: number }> {
    const store = useStore()
    const cloud = await api<SyncData>('/sync')

    // 收藏：并集
    const mergedFavs = Array.from(new Set([...store.state.favorites, ...(cloud.favorites || [])]))

    // 图纸：按 id 合并，本地优先（本地较新）
    const cloudMap = new Map<string, Pattern>()
    for (const p of cloud.patterns || []) {
      if (p && p.id) cloudMap.set(p.id, cloudToLocal(p))
    }
    const localMap = new Map<string, Pattern>()
    for (const p of store.state.savedPatterns) {
      if (p && p.id) localMap.set(p.id, p)
    }
    const mergedPatterns: Pattern[] = []
    for (const [id, p] of cloudMap) mergedPatterns.push(localMap.get(id) || p)
    for (const [id, p] of localMap) if (!cloudMap.has(id)) mergedPatterns.push(p)

    // 分组：按 id 合并，本地优先
    const cloudGroups = new Map<string, PatternGroup>()
    for (const g of cloud.groups || []) if (g && g.id) cloudGroups.set(g.id, g)
    const mergedGroups: PatternGroup[] = []
    for (const [id, g] of cloudGroups) mergedGroups.push(store.state.groups.find((x) => x.id === id) || g)
    for (const g of store.state.groups) if (!cloudGroups.has(g.id)) mergedGroups.push(g)

    // 库存：取最大值
    const mergedInv: Inventory = {}
    const absorb = (src: Inventory) => {
      for (const [paletteId, codes] of Object.entries(src || {})) {
        if (!codes || typeof codes !== 'object') continue
        if (!mergedInv[paletteId]) mergedInv[paletteId] = {}
        for (const [code, count] of Object.entries(codes)) {
          mergedInv[paletteId][code] = Math.max(mergedInv[paletteId][code] ?? 0, Number(count) || 0)
        }
      }
    }
    absorb(cloud.inventory || {})
    absorb(store.state.inventory)

    // 推送
    await Promise.all([
      api('/sync/patterns', { method: 'POST', body: JSON.stringify({ patterns: mergedPatterns }) }),
      api('/sync/favorites', { method: 'POST', body: JSON.stringify({ favorites: mergedFavs }) }),
      api('/sync/groups', { method: 'POST', body: JSON.stringify({ groups: mergedGroups }) }),
      api('/sync/inventory', { method: 'POST', body: JSON.stringify({ inventory: mergedInv }) })
    ])

    // 写回本地
    store.state.favorites = mergedFavs
    store.state.savedPatterns = mergedPatterns
    store.state.groups = mergedGroups
    store.state.inventory = mergedInv

    return { pushed: mergedPatterns.length + mergedFavs.length + mergedGroups.length, pulled: cloud.patterns?.length || 0 }
  }

  return {
    state,
    isLoggedIn,
    isAdmin,
    fetchMe,
    register,
    login,
    logout,
    updateProfile,
    changePassword,
    deleteAccount,
    aiUsage,
    syncNow
  }
}
