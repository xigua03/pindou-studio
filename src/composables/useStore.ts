import { reactive, ref, watch } from 'vue'
import type { Inventory, Pattern } from '../types'
import { loadJSON, saveJSON } from '../utils/storage'
import { BUILTIN_PATTERNS } from '../data/patterns'
import { getPalette } from '../data/palettes'

/** ????? rows ???????? "A1F4.."?????????????? */
function splitRowCells(row: string, codes: string[]): string[] {
  const sorted = [...codes].sort((a, b) => b.length - a.length)
  const cells: string[] = []
  let i = 0
  while (i < row.length) {
    if (row[i] === '.') {
      cells.push('.')
      i++
      continue
    }
    const hit = sorted.find((c) => row.startsWith(c, i))
    if (hit) {
      cells.push(hit)
      i += hit.length
    } else {
      cells.push(row[i])
      i++
    }
  }
  return cells
}

function migratePattern(p: Pattern): Pattern {
  if (p.rows.length > 0 && typeof p.rows[0] === 'string') {
    const palette = getPalette(p.paletteId)
    const codes = palette ? palette.colors.map((c) => c.code) : []
    return { ...p, rows: (p.rows as unknown as string[]).map((r) => splitRowCells(r, codes)) }
  }
  return p
}

/** ?????????????????? */
function rowsKey(rows: string[][]): string {
  return JSON.stringify(rows)
}

function sameContent(a: Pattern, b: Pattern): boolean {
  return a.paletteId === b.paletteId && rowsKey(a.rows) === rowsKey(b.rows)
}

/** ?????????????????? id ????????? */
function dedupeAndRemap(patterns: Pattern[], favorites: string[]): { patterns: Pattern[]; favorites: string[] } {
  const seen = new Map<string, string>()
  const keep: Pattern[] = []
  const remap = new Map<string, string>()
  for (const p of patterns) {
    const key = p.paletteId + '|' + rowsKey(p.rows)
    const existing = seen.get(key)
    if (existing) {
      remap.set(p.id, existing)
    } else {
      seen.set(key, p.id)
      keep.push(p)
    }
  }
  return { patterns: keep, favorites: favorites.map((id) => remap.get(id) ?? id) }
}

export interface PatternGroup {
  id: string
  name: string
  patternIds: string[]
}

/** 版本历史：每次保存前自动留下上一份快照 */
export interface PatternVersion {
  ts: number
  name: string
  paletteId: string
  width: number
  height: number
  rows: string[][]
}

interface PersistedState {
  favorites: string[]
  savedPatterns: Pattern[]
  inventory: Inventory
  groups: PatternGroup[]
  patternVersions: Record<string, PatternVersion[]>
}

const initialFavorites = loadJSON<string[]>('favorites', [])
const initialPatterns = loadJSON<Pattern[]>('patterns', []).map(migratePattern)
const { patterns: dedupedPatterns, favorites: dedupedFavorites } = dedupeAndRemap(initialPatterns, initialFavorites)

const state = reactive<PersistedState>({
  favorites: dedupedFavorites,
  savedPatterns: dedupedPatterns,
  inventory: loadJSON<Inventory>('inventory', {}),
  groups: loadJSON<PatternGroup[]>('groups', []),
  patternVersions: loadJSON<Record<string, PatternVersion[]>>('pattern_versions', {})
})

/** ?????????????????????? null??????? */
const serverPatterns = ref<Pattern[] | null>(null)

// 启动清理（去重）后立即写回本地，避免旧重复数据残留
if (initialPatterns.length !== dedupedPatterns.length || initialFavorites.length !== dedupedFavorites.length) {
  saveJSON('patterns', dedupedPatterns)
  saveJSON('favorites', dedupedFavorites)
}

watch(
  () => state.favorites,
  (v) => saveJSON('favorites', v),
  { deep: true }
)
watch(
  () => state.savedPatterns,
  (v) => saveJSON('patterns', v),
  { deep: true }
)
watch(
  () => state.inventory,
  (v) => saveJSON('inventory', v),
  { deep: true }
)
watch(
  () => state.groups,
  (v) => saveJSON('groups', v),
  { deep: true }
)
watch(
  () => state.patternVersions,
  (v) => saveJSON('pattern_versions', v),
  { deep: true }
)

export function useStore() {
  const allPatterns = (): Pattern[] => [
    ...(serverPatterns.value ?? BUILTIN_PATTERNS),
    ...state.savedPatterns
  ]

  const getPattern = (id: string): Pattern | undefined =>
    (serverPatterns.value ?? BUILTIN_PATTERNS).find((p) => p.id === id) ??
    state.savedPatterns.find((p) => p.id === id)

  /** ?????????????????????????????? */
  const galleryPatterns = (): Pattern[] => serverPatterns.value ?? BUILTIN_PATTERNS

  /** ??????????????/??/??? */
  const loadServerPatterns = async (): Promise<void> => {
    try {
      const res = await fetch('/api/patterns')
      if (!res.ok) return
      const data = (await res.json()) as { patterns?: Array<Record<string, unknown>> }
      const list: Pattern[] = (data.patterns || [])
        .filter((p) => p && p.id && Array.isArray(p.rows))
        .map((p) => ({
          id: String(p.id),
          name: String(p.name || '未命名图纸'),
          description: String(p.description || ''),
          tags: Array.isArray(p.tags) ? (p.tags as string[]) : [],
          paletteId: String(p.paletteId || 'mard-221-github'),
          width: Number(p.width) || 0,
          height: Number(p.height) || 0,
          rows: p.rows as string[][],
          source: 'builtin' as const,
          sourceLabel: p.sourceLabel ? String(p.sourceLabel) : undefined,
          createdAt: Number(p.createdAt) || 0
        }))
      serverPatterns.value = list
    } catch {
      /* ???????????? */
    }
  }

  /** 单图纸加载：本地没有时从服务端拉取并合并进 gallery 状态，避免“图纸不存在” */
  const fetchPattern = async (id: string): Promise<Pattern | undefined> => {
    try {
      const res = await fetch(`/api/patterns/${encodeURIComponent(id)}`)
      if (!res.ok) return undefined
      const p = (await res.json()) as Record<string, unknown>
      if (!p || !p.id || !Array.isArray(p.rows)) return undefined
      const pattern: Pattern = {
        id: String(p.id),
        name: String(p.name || '未命名'),
        description: String(p.description || ''),
        tags: Array.isArray(p.tags) ? (p.tags as string[]) : [],
        paletteId: String(p.paletteId || 'mard-221-github'),
        width: Number(p.width) || 0,
        height: Number(p.height) || 0,
        rows: p.rows as string[][],
        source: 'builtin' as const,
        sourceLabel: p.sourceLabel ? String(p.sourceLabel) : undefined,
        createdAt: Number(p.createdAt) || 0
      }
      if (serverPatterns.value) {
        if (!serverPatterns.value.some((x) => x.id === pattern.id)) {
          serverPatterns.value = [...serverPatterns.value, pattern]
        }
      } else {
        serverPatterns.value = [pattern]
      }
      return pattern
    } catch {
      return undefined
    }
  }

  const isFavorite = (id: string): boolean => state.favorites.includes(id)

  const toggleFavorite = (id: string): void => {
    const i = state.favorites.indexOf(id)
    if (i >= 0) state.favorites.splice(i, 1)
    else state.favorites.push(id)
  }

  /** ???????? */
  const setFavorites = (ids: string[], fav: boolean): void => {
    const set = new Set(ids)
    if (fav) {
      for (const id of set) {
        if (!state.favorites.includes(id)) state.favorites.push(id)
      }
    } else {
      state.favorites = state.favorites.filter((id) => !set.has(id))
    }
  }

  /**
   * ????????????? + ???????????????????????? id?
   */
  const savePattern = (pattern: Pattern): string => {
    const dup = state.savedPatterns.find((p) => sameContent(p, pattern))
    if (dup) {
      dup.name = pattern.name
      dup.tags = pattern.tags
      dup.description = pattern.description
      dup.createdAt = pattern.createdAt
      return dup.id
    }
    const i = state.savedPatterns.findIndex((p) => p.id === pattern.id)
    if (i >= 0) {
      const oldP = state.savedPatterns[i]
      // 内容变化时把旧内容归档为版本（保留最新8个）
      if (rowsKey(oldP.rows) !== rowsKey(pattern.rows)) addVersionLocked(oldP)
      state.savedPatterns[i] = pattern
    } else {
      state.savedPatterns.unshift(pattern)
    }
    return pattern.id
  }

  /** 通知 Vue 观测到版本数组替换（避免深度观察不触发持久化） */
  function addVersionLocked(p: Pattern): void {
    const list = state.patternVersions[p.id] ? [...state.patternVersions[p.id]] : []
    list.unshift({ ts: Date.now(), name: p.name, paletteId: p.paletteId, width: p.width, height: p.height, rows: p.rows.map((r) => [...r]) })
    if (list.length > 8) list.length = 8
    state.patternVersions = { ...state.patternVersions, [p.id]: list }
  }

  const addPatternVersion = (p: Pattern): void => {
    if (!p || !p.id) return
    addVersionLocked(p)
  }

  const getPatternVersions = (id: string): PatternVersion[] => state.patternVersions[id] || []

  /** 回滚到某个版本；如图纸已被删除，重新创建 */
  const restorePatternVersion = (id: string, ts: number): boolean => {
    const list = state.patternVersions[id] || []
    const v = list.find((x) => x.ts === ts)
    if (!v) return false
    const idx = state.savedPatterns.findIndex((p) => p.id === id)
    const restored: Pattern = {
      id,
      name: v.name,
      tags: idx >= 0 ? state.savedPatterns[idx].tags : [],
      description: idx >= 0 ? state.savedPatterns[idx].description : '',
      paletteId: v.paletteId,
      width: v.width,
      height: v.height,
      rows: v.rows.map((r) => [...r]),
      source: 'edited',
      createdAt: idx >= 0 ? state.savedPatterns[idx].createdAt : Date.now()
    }
    if (idx >= 0) state.savedPatterns[idx] = restored
    else state.savedPatterns.unshift(restored)
    return true
  }

  const deletePatternVersion = (id: string, ts: number): void => {
    const list = state.patternVersions[id] || []
    const next = list.filter((x) => x.ts !== ts)
    const copy = { ...state.patternVersions }
    if (next.length) copy[id] = next
    else delete copy[id]
    state.patternVersions = copy
  }

  const deletePattern = (id: string): void => {
    state.savedPatterns = state.savedPatterns.filter((p) => p.id !== id)
    state.favorites = state.favorites.filter((f) => f !== id)
  }

  /** ????????????? */
  const deletePatterns = (ids: string[]): void => {
    const set = new Set(ids)
    state.savedPatterns = state.savedPatterns.filter((p) => !set.has(p.id))
    state.favorites = state.favorites.filter((f) => !set.has(f))
    for (const g of state.groups) g.patternIds = g.patternIds.filter((id) => !set.has(id))
  }

  /** ????????????? */
  const ownedCount = (paletteId: string, code: string): number =>
    state.inventory[paletteId]?.[code] ?? 0

  const setInventory = (paletteId: string, code: string, count: number): void => {
    if (!state.inventory[paletteId]) state.inventory[paletteId] = {}
    if (count <= 0) delete state.inventory[paletteId][code]
    else state.inventory[paletteId][code] = count
  }

  const addInventory = (paletteId: string, code: string, delta: number): void => {
    const cur = ownedCount(paletteId, code)
    setInventory(paletteId, code, cur + delta)
  }

  /** 创建分组，返回新分组 id */
  const createGroup = (name: string): string => {
    const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    state.groups.push({ id, name: name.trim() || '未命名分组', patternIds: [] })
    return id
  }

  const renameGroup = (id: string, name: string): void => {
    const g = state.groups.find((x) => x.id === id)
    if (g) g.name = name.trim() || g.name
  }

  const deleteGroup = (id: string): void => {
    state.groups = state.groups.filter((g) => g.id !== id)
  }

  const addToGroup = (groupId: string, patternId: string): void => {
    const g = state.groups.find((x) => x.id === groupId)
    if (g && !g.patternIds.includes(patternId)) g.patternIds.push(patternId)
  }

  const removeFromGroup = (groupId: string, patternId: string): void => {
    const g = state.groups.find((x) => x.id === groupId)
    if (g) g.patternIds = g.patternIds.filter((id) => id !== patternId)
  }

  /** 把一批图纸移动到某个分组（先移出所有分组再加入）；groupId 为空表示移出所有分组 */
  const assignPatternsToGroup = (patternIds: string[], groupId: string | null): void => {
    for (const g of state.groups) {
      g.patternIds = g.patternIds.filter((id) => !patternIds.includes(id))
    }
    if (groupId) {
      const g = state.groups.find((x) => x.id === groupId)
      if (g) {
        for (const id of patternIds) if (!g.patternIds.includes(id)) g.patternIds.push(id)
      }
    }
  }

  const patternGroups = (patternId: string): PatternGroup[] =>
    state.groups.filter((g) => g.patternIds.includes(patternId))

  const resetAll = (): void => {
    state.favorites = []
    state.savedPatterns = []
    state.inventory = {}
    state.groups = []
  }

  return {
    state,
    allPatterns,
    getPattern,
    galleryPatterns,
    loadServerPatterns,
    fetchPattern,
    isFavorite,
    toggleFavorite,
    setFavorites,
    savePattern,
    deletePattern,
    deletePatterns,
    ownedCount,
    setInventory,
    addInventory,
    createGroup,
    renameGroup,
    deleteGroup,
    addToGroup,
    removeFromGroup,
    assignPatternsToGroup,
    patternGroups,
    addPatternVersion,
    getPatternVersions,
    restorePatternVersion,
    deletePatternVersion,
    resetAll
  }
}
