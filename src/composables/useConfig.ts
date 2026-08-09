/**
 * 站点公开配置：功能开关 / 公告 / 维护模式 / 注册开关 / AI 额度
 * 后端不可用时保持默认（全部开放），不影响离线使用
 */
import { reactive } from 'vue'
import { fetchTimeout } from '../utils/api'

export type FeatureKey = 'gallery' | 'generator' | 'ai' | 'palette' | 'warehouse' | 'share'

export interface AppConfig {
  siteNotice: string
  maintenance: boolean
  registerOpen: boolean
  features: Record<FeatureKey, boolean>
  ai: { enabled: boolean; guestLimit: number; userLimit: number }
}

const defaults: AppConfig = {
  siteNotice: '',
  maintenance: false,
  registerOpen: true,
  features: { gallery: true, generator: true, ai: true, palette: true, warehouse: true, share: true },
  ai: { enabled: true, guestLimit: 10, userLimit: 50 }
}

const state = reactive<AppConfig & { loaded: boolean }>({ ...defaults, loaded: false })

export function useConfig() {
  async function loadConfig(): Promise<void> {
    try {
      const res = await fetchTimeout('/api/config')
      if (!res.ok) {
        state.loaded = true
        return
      }
      const data = (await res.json()) as Partial<AppConfig>
      if (data.siteNotice !== undefined) state.siteNotice = data.siteNotice
      if (data.maintenance !== undefined) state.maintenance = !!data.maintenance
      if (data.registerOpen !== undefined) state.registerOpen = !!data.registerOpen
      state.features = { ...defaults.features, ...(data.features || {}) }
      state.ai = { ...defaults.ai, ...(data.ai || {}) }
    } catch {
      /* 后端不可用：保持默认全部开放 */
    }
    state.loaded = true
  }

  function featureEnabled(key: FeatureKey): boolean {
    return state.features[key] !== false
  }

  return { state, loadConfig, featureEnabled }
}
