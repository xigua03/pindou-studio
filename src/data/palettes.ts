import type { BeadColor, BeadPalette } from '../types'

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
    { label: '国内品牌', items: [] },
    { label: '进口品牌', items: [] }
  ]
  for (const p of PALETTES) {
    const g = p.brand === '进口' ? groups[1] : groups[0]
    g.items.push(p)
  }
  return groups.filter((g) => g.items.length > 0)
}
