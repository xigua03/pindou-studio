import { reactive, watch } from 'vue'
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

interface PersistedState {
  favorites: string[]
  savedPatterns: Pattern[]
  inventory: Inventory
}

const initialFavorites = loadJSON<string[]>('favorites', [])
const initialPatterns = loadJSON<Pattern[]>('patterns', []).map(migratePattern)
const { patterns: dedupedPatterns, favorites: dedupedFavorites } = dedupeAndRemap(initialPatterns, initialFavorites)

const state = reactive<PersistedState>({
  favorites: dedupedFavorites,
  savedPatterns: dedupedPatterns,
  inventory: loadJSON<Inventory>('inventory', {})
})

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

export function useStore() {
  const allPatterns = (): Pattern[] => [...BUILTIN_PATTERNS, ...state.savedPatterns]

  const getPattern = (id: string): Pattern | undefined =>
    BUILTIN_PATTERNS.find((p) => p.id === id) ?? state.savedPatterns.find((p) => p.id === id)

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
    if (i >= 0) state.savedPatterns[i] = pattern
    else state.savedPatterns.unshift(pattern)
    return pattern.id
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

  const resetAll = (): void => {
    state.favorites = []
    state.savedPatterns = []
    state.inventory = {}
  }

  return {
    state,
    allPatterns,
    getPattern,
    isFavorite,
    toggleFavorite,
    setFavorites,
    savePattern,
    deletePattern,
    deletePatterns,
    ownedCount,
    setInventory,
    addInventory,
    resetAll
  }
}
