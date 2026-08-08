import type { Pattern } from '../types'
import raw from './patterns.json'

interface RawPattern {
  id: string
  name: string
  description?: string
  tags: string[]
  sourceLabel?: string
  paletteId: string
  legend: Record<string, string>
  rows: string[]
}

// Convert legend chars (JSON) into standard Pattern rows (bead codes or '.')
function convert(raw: RawPattern): Pattern {
  const rows = raw.rows.map((row) => [...row].map((ch) => (ch === '.' ? '.' : raw.legend[ch] ?? '.')))
  const height = rows.length
  const width = height > 0 ? rows[0].length : 0
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? '',
    tags: raw.tags,
    paletteId: raw.paletteId,
    width,
    height,
    rows,
    source: 'builtin',
    sourceLabel: raw.sourceLabel,
    createdAt: 0
  }
}

export const BUILTIN_PATTERNS: Pattern[] = (raw as unknown as RawPattern[]).map(convert)

export const BUILTIN_TAGS: string[] = (() => {
  const set = new Set<string>()
  for (const p of BUILTIN_PATTERNS) for (const t of p.tags) set.add(t)
  return [...set]
})()

export const BUILTIN_SOURCES: string[] = (() => {
  const set = new Set<string>()
  for (const p of BUILTIN_PATTERNS) if (p.sourceLabel) set.add(p.sourceLabel)
  return [...set]
})()

/** D19：统计一张图纸的豆子总数（空格不计） */
export function patternBeadCount(p: Pattern): number {
  let n = 0
  for (const row of p.rows) for (const c of row) if (c && c !== '.') n++
  return n
}

export type Difficulty = '简单' | '中等' | '复杂'
/** 按豆子数量粗略分难度：<500 简单 · 500~2000 中等 · >2000 复杂 */
export function patternDifficulty(p: Pattern): Difficulty {
  const n = patternBeadCount(p)
  if (n < 500) return '简单'
  if (n <= 2000) return '中等'
  return '复杂'
}
