import type { BeadPalette, GenMode } from '../../types'

export interface CandidateConfig {
  label: string
  width: number
  detail: number
  enhance: boolean
  saturate: number
  sharpen: boolean
  contrast: number
  brightness: number
  protectDark: number
  maxColors: number
  removeBg: boolean
  bgThreshold: number
  smartBg: boolean
  borderTol: number
  denoise: boolean
  outline: boolean
  mode: GenMode
  autoCrop: boolean
  onlyOwnedColors: boolean
  weight?: number
}

export interface ScoringWeights {
  color: number
  speckle: number
  hole: number
  line: number
  bg: number
  detail: number
}

export interface PatternScore {
  total: number
  colorScore: number
  speckleScore: number
  holeScore: number
  lineScore: number
  bgScore: number
  detailScore: number
  raw: {
    colorCount: number
    totalBeads: number
    speckleCells: number
    speckleClusters: number
    holes: number
    lineContinuity: number
    bgResidual: number
    detailPreservation: number
  }
}

export interface GenerateOptions {
  image: HTMLImageElement
  palette: BeadPalette
  srcRect: { x: number; y: number; w: number; h: number } | null
  userWidth?: number
  userMaxColors?: number
  exclude?: Set<string> | null
  mode?: GenMode
  paletteId?: string
  bgColor?: string
  bgThreshold?: number
}

export interface GenerateCandidateResult {
  rows: string[][]
  totalBeads: number
  config: CandidateConfig
  width: number
  height: number
  previewPixels: Uint8ClampedArray
  previewW: number
  previewH: number
  detailScore: number
  lineArt: boolean
  strategyId?: string
  strategyLabel?: string
  strategyFamily?: StrategyFamily
  strategyReason?: string
}

export interface GenerateBestPatternResult extends GenerateCandidateResult {
  score: PatternScore
}

export interface ImageAnalysis {
  lineArt: boolean
  pixelArt: boolean
  detailScore: number
  contentRatio: number
}

export type StrategyFamily = 'line-art' | 'pixel-art' | 'flat-art' | 'photo'

export interface StrategyAnalysis {
  family: StrategyFamily
  lineArt: boolean
  pixelArt: boolean
  detailScore: number
  contentRatio: number
  source: string
}

export interface StrategySpec {
  id: string
  label: string
  family: StrategyFamily
  reason: string
  weights: ScoringWeights
  candidates: CandidateConfig[]
}

export interface StrategyPlan {
  family: StrategyFamily
  strategies: StrategySpec[]
}

export interface CleanupOptions {
  removeBg: boolean
  smartBg: boolean
  autoCrop: boolean
  denoise: boolean
  outline: boolean
  borderTol: number
  bgThreshold: number
}
