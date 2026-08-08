import type { Pattern } from '../types'
import raw from './patterns.json'

interface RawPattern {
  id: string
  name: string
  description?: string
  tags: string[]
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
    createdAt: 0
  }
}

export const BUILTIN_PATTERNS: Pattern[] = (raw as unknown as RawPattern[]).map(convert)

export const BUILTIN_TAGS: string[] = (() => {
  const set = new Set<string>()
  for (const p of BUILTIN_PATTERNS) for (const t of p.tags) set.add(t)
  return [...set]
})()
