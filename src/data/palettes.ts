import type { BeadColor, BeadPalette } from '../types'
import { hexToRgb } from '../utils/color'
import { loadJSON, saveJSON } from '../utils/storage'

import mard221Raw from './palettes/mard-221-github.json'
import mard291Raw from './palettes/mard-291-github.json'
import mard221adRaw from './palettes/mard-221-alfonse-doudou.json'
import cocoRaw from './palettes/coco-291.json'
import dodoRaw from './palettes/dodo-291.json'
import kakaRaw from './palettes/kaka-284.json'
import manmanRaw from './palettes/manman-278.json'
import panpanRaw from './palettes/panpan-289.json'
import mixiaowoRaw from './palettes/mixiaowo-290.json'
import xiaowuRaw from './palettes/xiaowu-291.json'
import huangdoudouRaw from './palettes/huangdoudou-291.json'
import shishiRaw from './palettes/shishi-220.json'
import tongquRaw from './palettes/tongqu-120.json'
import youkenRaw from './palettes/youken-public-174.json'
import artkalMRaw from './palettes/artkal-m-221-official.json'
import artkalCRaw from './palettes/artkal-c-197-official.json'
import artkal418Raw from './palettes/artkal-c197-m221-418-official.json'
import perlerRaw from './palettes/perler-103.json'
import hamaRaw from './palettes/hama-92.json'
import nabbiRaw from './palettes/nabbi-25.json'

interface RawPalette {
  id: string
  title: string
  description: string
  count: number
  colors: { code: string; hex: string; rgb: number[]; group: string }[]
}

function convert(raw: RawPalette, brand: string): BeadPalette {
  const colors: BeadColor[] = raw.colors.map((c) => ({
    code: c.code,
    hex: c.hex,
    rgb: [c.rgb[0], c.rgb[1], c.rgb[2]],
    group: c.group
  }))
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    brand,
    count: colors.length,
    colors
  }
}

const DOMESTIC = new Set([
  'mard-221-github',
  'mard-291-github',
  'mard-221-alfonse-doudou',
  'coco-291',
  'dodo-291',
  'kaka-284',
  'manman-278',
  'panpan-289',
  'mixiaowo-290',
  'xiaowu-291',
  'huangdoudou-291',
  'shishi-220',
  'tongqu-120',
  'youken-public-174',
  'artkal-m-221-official',
  'artkal-c-197-official',
  'artkal-c197-m221-418-official'
])

const rawList: RawPalette[] = [
  mard221Raw, mard291Raw, mard221adRaw, cocoRaw, dodoRaw, kakaRaw, manmanRaw,
  panpanRaw, mixiaowoRaw, xiaowuRaw, huangdoudouRaw, shishiRaw, tongquRaw,
  youkenRaw, artkalMRaw, artkalCRaw, artkal418Raw, perlerRaw, hamaRaw, nabbiRaw
] as RawPalette[]

export const PALETTES: BeadPalette[] = rawList.map((r) => convert(r, DOMESTIC.has(r.id) ? '国内' : '进口'))

export function getPalette(id: string): BeadPalette | undefined {
  return PALETTES.find((p) => p.id === id)
}

/**
 * A7 色卡管理后台：后端可用时用数据库中的品牌色卡替换静态内置色卡（保留本地自定义）。
 * 调用后 paletteGroups()/getPalette() 立即生效。
 */
export async function loadServerPalettes(): Promise<boolean> {
  try {
    const res = await fetch('/api/palettes')
    if (!res.ok) return false
    const data = (await res.json()) as { palettes?: BeadPalette[] }
    const list = (data.palettes || []).filter((p) => p && p.id && Array.isArray(p.colors) && p.colors.length)
    if (!list.length) return false
    const custom = PALETTES.filter((p) => p.id.startsWith(CUSTOM_PREFIX))
    const merged = [...list, ...custom]
    PALETTES.splice(0, PALETTES.length, ...merged)
    return true
  } catch {
    return false
  }
}

/* ============ E25 自定义调色板（本地持久化） ============ */
const CUSTOM_PREFIX = 'custom_'
const builtinIds = new Set(PALETTES.map((p) => p.id))
// 启动时把已保存的自定义调色板并入 PALETTES（跳过与内置 id 冲突的脏数据）
const savedCustom = loadJSON<BeadPalette[]>('custom_palettes', [])
for (const p of savedCustom) {
  if (p && p.id && p.id.startsWith(CUSTOM_PREFIX) && !builtinIds.has(p.id) && Array.isArray(p.colors) && p.colors.length > 0) {
    PALETTES.push(p)
  }
}
function persistCustom(): void {
  saveJSON('custom_palettes', PALETTES.filter((p) => p.id.startsWith(CUSTOM_PREFIX)))
}

export interface CustomColorInput {
  code: string
  hex: string
}
export interface CustomPaletteInput {
  title: string
  description?: string
  colors: CustomColorInput[]
}

export function customPalettes(): BeadPalette[] {
  return PALETTES.filter((p) => p.id.startsWith(CUSTOM_PREFIX))
}

function buildCustomColors(colors: CustomColorInput[]): BeadColor[] {
  const list: BeadColor[] = []
  const seen = new Set<string>()
  for (const c of colors) {
    const code = String(c.code ?? '').trim()
    const hex = String(c.hex ?? '').trim()
    if (!code || !/^#[0-9a-fA-F]{3,8}$/.test(hex)) continue
    if (seen.has(code)) continue
    seen.add(code)
    list.push({ code, hex, rgb: [hexToRgb(hex).r, hexToRgb(hex).g, hexToRgb(hex).b], group: 'C' })
  }
  return list
}

export function addCustomPalette(input: CustomPaletteInput): BeadPalette | null {
  const colors = buildCustomColors(input.colors)
  if (colors.length === 0) return null
  const id = CUSTOM_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const pal: BeadPalette = {
    id,
    brand: '自定义',
    title: (input.title ?? '').trim() || '我的调色板',
    description: (input.description ?? '').trim() || '自定义调色板',
    count: colors.length,
    colors
  }
  PALETTES.push(pal)
  persistCustom()
  return pal
}

export function updateCustomPaletteColors(id: string, colors: CustomColorInput[]): boolean {
  const pal = PALETTES.find((p) => p.id === id)
  if (!pal || !id.startsWith(CUSTOM_PREFIX)) return false
  const list = buildCustomColors(colors)
  if (list.length === 0) return false
  pal.colors = list
  pal.count = list.length
  persistCustom()
  return true
}

export function deleteCustomPalette(id: string): boolean {
  const i = PALETTES.findIndex((p) => p.id === id)
  if (i < 0 || !id.startsWith(CUSTOM_PREFIX)) return false
  PALETTES.splice(i, 1)
  persistCustom()
  return true
}

export function getDefaultPaletteId(): string {
  return 'mard-221-github'
}

export interface PaletteGroup {
  label: string
  items: BeadPalette[]
}

/** Group by brand for <optgroup> dropdowns */
export function paletteGroups(): PaletteGroup[] {
  const groups: PaletteGroup[] = [
    { label: '自定义', items: [] },
    { label: '国内品牌', items: [] },
    { label: '进口品牌', items: [] }
  ]
  for (const p of PALETTES) {
    if (p.brand === '自定义') groups[0].items.push(p)
    else if (p.brand === '进口') groups[2].items.push(p)
    else groups[1].items.push(p)
  }
  return groups.filter((g) => g.items.length > 0)
}
