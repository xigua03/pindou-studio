export interface BeadColor {
  /** 品牌色号，如 A1、B23 */
  code: string
  /** 十六进制颜色 */
  hex: string
  rgb: [number, number, number]
  /** 色系分组（MARD 里 A/B/C/D/E/F/G/H/M） */
  group: string
}

export interface BeadPalette {
  id: string
  /** 国内 / 进口 */
  brand?: string
  title: string
  description: string
  count: number
  colors: BeadColor[]
}

/** 一张图纸：rows[y][x] 是第 y 行第 x 列的色号，'.' 表示空格/无豆 */
export interface Pattern {
  id: string
  name: string
  description?: string
  tags: string[]
  paletteId: string
  width: number
  height: number
  rows: string[][]
  source: 'builtin' | 'generated' | 'edited'
  createdAt: number
}

/** 库存：paletteId -> 色号 -> 拥有数量 */
export type Inventory = Record<string, Record<string, number>>

export interface ColorUsage {
  code: string
  hex: string
  count: number
}

export type GenMode = 'nearest' | 'floyd'

/** ?????????????????? */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}
