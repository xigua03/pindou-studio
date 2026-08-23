<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { GenMode, Pattern } from '../types'
import { PALETTES, getPalette, paletteGroups } from '../data/palettes'
import { useStore } from '../composables/useStore'
import PatternGrid from '../components/PatternGrid.vue'
import ColorLegend from '../components/ColorLegend.vue'
import ImageCropper from '../components/ImageCropper.vue'
import type { CropRect } from '../types'
import { loadImageFromFile, imageToGridColors, quantizeImageAsync, detectBackgroundColor, backgroundFromHex, rgbTripleToHex, cropEmptyBorders, buildGrowBgMask, buildBorderBgMask, emptyOuterBackground, mergePatternColors, applyRemap, nearestUsedCode, limitColorCount, applyOutline, removeSpeckles, convertPatternPalette, estimateContentRatio, isPixelArt, isLineArt, bridgeLineGaps, selectAdaptivePalette, computeUsedCounts } from '../utils/quantize'
import { generateBestPattern } from '../utils/patternScoring'
import { computeColorUsage, patternToCanvas, renderPatternSheet, downloadCanvas, exportUsageCSV, downloadText, safeFileName, printPatternTiled } from '../utils/export'

const router = useRouter()
const store = useStore()

interface LoadedImage {
  el: HTMLImageElement
  name: string
  w: number
  h: number
}

const fileInput = ref<HTMLInputElement | null>(null)
const image = ref<LoadedImage | null>(null)
const dragOver = ref(false)

const paletteId = ref('mard-221-github')
const width = ref(64)
const mode = ref<GenMode>('nearest')
const detail = ref(2) // 超采样倍数 1/2/3
const enhance = ref(true) // 色彩增强
const removeBg = ref(true) // 去除背景留空（默认开）
const smartBg = ref(true) // 智能抠图：边缘连通去背景
const borderTol = ref(30) // 抠图灵敏度（RGB 距离阈值）
const bgThreshold = ref(18) // 背景阈值（CIEDE2000）
const bgColor = ref('#FFFFFF') // 背景色
const autoCrop = ref(true) // 自动裁剪空白边距
const showMargin = ref(true) // 底板外围留空显示（预览/下载按底板补齐，空位显示为空格子）
// 图片细节丰富度：缩到 128 宽后统计的独特颜色数，越高越复杂（照片数百上千，卡通几十）
const detailScore = ref(0)
const detailNote = ref('')
// 上传前裁剪
const cropEnabled = ref(false)
const cropRect = ref<CropRect | null>(null)
const cropOpen = ref(false) // 裁剪面板是否展开（确认后收起面板但保留裁剪选区）
// 对比度（-50 ~ +50，0 不变；默认 5，温和增强轮廓）
const contrast = ref(5)
// 亮度（-50 ~ +50，0 不变）
const brightness = ref(0)
// 饱和度（0.5 ~ 2.0，1 不变；默认 1.15，轻微提色，避免过艳失真）
const saturate = ref(1.15)
// 颜色数量上限（0=关闭，默认 32，减少杂色更干净）
const maxColors = ref(32)
// 深色描边：把外边缘加深色轮廓（类似卡通描边）
const outline = ref(false)
const protectDark = ref(true) // keep thin dark lines (whiskers/outlines), default on
// 去杂点：清理孤立的单色噪点，让画面更干净
const denoise = ref(true)
// 边缘锐化：默认关闭（锐化会在量化后产生噪点，需要时再开）
const sharpen = ref(false)
// 仅用手头颜色（豆仓）
const onlyOwnedColors = ref(false)
// 底板尺寸（固定 29×29 标准板）：仅用于结果区的底板排布参考与外围留空显示，不向用户暴露「板数」参数
const boardSize = 29
// 颜色优化
const mergeThreshold = ref(0)
const noiseMin = ref(0)
const remapMap = ref<Record<string, string>>({})
const mergeMsg = ref('')
const generating = ref(false)
const progress = ref(0)
const result = ref<Pattern | null>(null)
const resultName = ref('我的拼豆图纸')
const previewCell = ref(14)
const showCodes = ref(true)
const error = ref('')
// F1 原色预览：看「不映射色卡的原始效果」，与拼豆图纸同一网格分辨率
const showOriginal = ref(false)
interface OriginalPreview { pixels: Uint8ClampedArray; w: number; h: number }
const originalPreview = ref<OriginalPreview | null>(null)
// 自动生成模式：默认只显示「一键生成」；高级调参入口后续可折叠到“高级设置”
const autoMode = ref(true)
const showAdvanced = ref(false)
const originalCanvasRef = ref<HTMLCanvasElement | null>(null)
// 线条画（白底黑线简笔画）：自动检测，使用专门的描边保留算法
const lineArt = ref(false)
// 选项区的「原图预览」：展示上传的原图（含裁剪框），不依赖生成
const showSrcPreview = ref(false)
const srcPreviewRef = ref<HTMLCanvasElement | null>(null)
// 生成时的裁剪前网格尺寸（用于结果区说明自动裁剪）
const preCropSize = ref<{ w: number; h: number } | null>(null)
function drawOriginalPreview() {
  const cv = originalCanvasRef.value
  const op = originalPreview.value
  if (!cv || !op) return
  const cell = Math.max(1, previewCell.value || 1)
  cv.width = op.w * cell
  cv.height = op.h * cell
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  const tmp = document.createElement('canvas')
  tmp.width = op.w
  tmp.height = op.h
  const tctx = tmp.getContext('2d')
  if (!tctx) return
  tctx.putImageData(new ImageData(new Uint8ClampedArray(op.pixels), op.w, op.h), 0, 0)
  ctx.drawImage(tmp, 0, 0, cv.width, cv.height)
}
watch([showOriginal, previewCell, originalPreview], () => {
  if (showOriginal.value) nextTick(drawOriginalPreview)
})

/** 选项区「原图预览」：绘制原图 + 裁剪框 */
function drawSourcePreview() {
  const cv = srcPreviewRef.value
  const im = image.value
  if (!cv || !im) return
  const maxW = 520
  const maxH = 360
  const scale = Math.min(1, maxW / im.w, maxH / im.h)
  cv.width = Math.max(1, Math.round(im.w * scale))
  cv.height = Math.max(1, Math.round(im.h * scale))
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.drawImage(im.el, 0, 0, cv.width, cv.height)
  if (cropEnabled.value && cropRect.value) {
    const r = cropRect.value
    const sx = r.x * scale
    const sy = r.y * scale
    const sw = r.w * scale
    const sh = r.h * scale
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.clearRect(sx, sy, sw, sh)
    ctx.strokeStyle = '#ff7043'
    ctx.lineWidth = 2
    ctx.strokeRect(sx + 1, sy + 1, sw - 2, sh - 2)
  }
}
watch([showSrcPreview, image, cropEnabled, cropRect], () => {
  if (showSrcPreview.value) nextTick(drawSourcePreview)
})

const palette = computed(() => getPalette(paletteId.value)!)

/** 实际参与生成的图片尺寸（开启裁剪后使用裁剪区域） */
const effectiveImage = computed(() => {
  if (!image.value) return null
  if (cropEnabled.value && cropRect.value) return { w: cropRect.value.w, h: cropRect.value.h }
  return { w: image.value.w, h: image.value.h }
})

const outputSize = computed(() => {
  const src = effectiveImage.value
  if (!src) return { w: 0, h: 0 }
  const { w, h } = src
  let outW = Math.max(8, Math.min(256, width.value))
  let outH = Math.max(8, Math.round((outW * h) / w))
  if (outH > 256) {
    outH = 256
    outW = Math.max(8, Math.round((256 * w) / h))
  }
  return { w: outW, h: outH }
})

/** 重映射后的展示图纸（实时预览，不直接改 result） */
function padToBoard(rows: string[][], b: number): string[][] {
  const w = rows[0]?.length ?? 0
  const h = rows.length
  if (b <= 1) return rows
  const tw = Math.ceil(w / b) * b
  const th = Math.ceil(h / b) * b
  if (tw === w && th === h) return rows
  const out: string[][] = []
  for (let y = 0; y < th; y++) {
    const row: string[] = []
    const src = rows[y]
    for (let x = 0; x < tw; x++) row.push(src && x < w ? src[x] : '.')
    out.push(row)
  }
  return out
}
const displayPattern = computed(() => {
  if (!result.value) return null
  let rows = result.value.rows
  if (showMargin.value) rows = padToBoard(rows, boardSize)
  return { ...result.value, rows: applyRemap(rows, remapMap.value), width: rows[0]?.length ?? 0, height: rows.length }
})
const marginInfo = computed(() => {
  if (!result.value || !showMargin.value) return null
  const b = boardSize
  const tw = Math.ceil(result.value.width / b) * b
  const th = Math.ceil(result.value.height / b) * b
  return { tw, th, right: tw - result.value.width, bottom: th - result.value.height }
})
const usage = computed(() => (displayPattern.value ? computeColorUsage(displayPattern.value) : []))
const totalBeads = computed(() => usage.value.reduce((s, u) => s + u.count, 0))
const isSaved = computed(() => (result.value ? store.getPattern(result.value.id) !== undefined : false))

/** 豆仓里已有库存的颜色数（用于「仅用手头颜色」提示） */
const ownedColorCount = computed(() => {
  const inv = store.state.inventory[paletteId.value]
  return inv ? Object.keys(inv).filter((c) => (inv[c] ?? 0) > 0).length : 0
})

/** 底板规划：按所选底板尺寸计算需要几块板 */
const boardInfo = computed(() => {
  const pat = displayPattern.value
  if (!pat) return null
  const b = boardSize
  const bx = Math.ceil(pat.width / b)
  const by = Math.ceil(pat.height / b)
  return { b, bx, by, total: bx * by }
})

const remapRows = computed(() => (result.value ? computeColorUsage(result.value) : []))
const hasRemap = computed(() => Object.keys(remapMap.value).length > 0)
function colorOf(code: string): string {
  return palette.value.colors.find((c) => c.code === code)?.hex ?? '#ccc'
}
function otherCodes(code: string): string[] {
  return remapRows.value.filter((r) => r.code !== code).map((r) => r.code)
}
function remapValue(code: string): string {
  return remapMap.value[code] ?? '__keep'
}
function onRemapChange(code: string, target: string) {
  const next = { ...remapMap.value }
  if (target === '__keep') delete next[code]
  else if (target === '__empty') next[code] = '.'
  else if (target === '__auto') {
    const nearest = nearestUsedCode(code, remapRows.value.map((r) => r.code), palette.value)
    next[code] = nearest && nearest !== code ? nearest : '.'
  } else next[code] = target
  remapMap.value = next
}
function clearRemap() {
  remapMap.value = {}
}
function applyOptimize() {
  if (!result.value) return
  const { rows, merged } = mergePatternColors(result.value.rows, palette.value, {
    mergeThreshold: mergeThreshold.value,
    noiseMinCount: noiseMin.value
  })
  if (merged.length === 0) {
    mergeMsg.value = '没有需要合并的颜色'
    setTimeout(() => (mergeMsg.value = ''), 3000)
    return
  }
  result.value.rows = rows
  result.value.width = rows[0]?.length ?? 0
  result.value.height = rows.length
  remapMap.value = {}
  store.savePattern(result.value)
  const n = merged.reduce((s, m) => s + m.count, 0)
  mergeMsg.value = `已合并 ${merged.length} 组颜色，共 ${n} 颗豆`
  setTimeout(() => (mergeMsg.value = ''), 4000)
}
function saveRemap() {
  if (!result.value || !hasRemap.value) return
  result.value.rows = applyRemap(result.value.rows, remapMap.value)
  remapMap.value = {}
  store.savePattern(result.value)
  mergeMsg.value = '重映射已应用并保存'
  setTimeout(() => (mergeMsg.value = ''), 3000)
}

// 细节丰富度估算：将图片缩到 128 宽后统计“4bit/通道”去重后的颜色数。
// 照片/人像等连续色调图像颜色数很高（数百~上千），纯色卡通则很少（几十），据此判断是否建议加大板数。
function estimateDetail(el: HTMLImageElement, src?: { x: number; y: number; w: number; h: number } | null): number {
  const S = 128
  const canvas = document.createElement('canvas')
  const sxx = src && src.w > 0 && src.h > 0 ? src.x : 0
  const syy = src && src.w > 0 && src.h > 0 ? src.y : 0
  const sw0 = src && src.w > 0 && src.h > 0 ? src.w : el.naturalWidth
  const sh0 = src && src.w > 0 && src.h > 0 ? src.h : el.naturalHeight
  const w = S
  const h = Math.max(2, Math.round((S * sh0) / sw0))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 0
  ctx.drawImage(el, sxx, syy, sw0, sh0, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  const shift = 4
  const cols = new Set<number>()
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    cols.add(((data[o] >> shift) << 8) | ((data[o + 1] >> shift) << 4) | (data[o + 2] >> shift))
  }
  return cols.size
}

const isComplex = computed(() => detailScore.value >= 200)

/** 按图片细节复杂度自动选择默认图纸尺寸档位（标准版/大板/超大版） */
function pickTier(detail: number): { label: string; width: number } {
  if (detail < 50) return { label: '标准版', width: 48 }
  if (detail < 170) return { label: '大板', width: 64 }
  return { label: '超大版', width: 80 }
}

function applyLoadedImage(el: HTMLImageElement, name: string) {
  cropEnabled.value = false
  cropRect.value = null
  cropOpen.value = false
  image.value = { el, name, w: el.naturalWidth, h: el.naturalHeight }
  // 自动识别「白底黑线简笔画」，走描边保留算法
  lineArt.value = isLineArt(el)
  resultName.value = name || '我的拼豆图纸'
  // 自动检测背景色（四角中位色）
  bgColor.value = rgbTripleToHex(detectBackgroundColor(el))
  // 默认宽度按图片复杂度自动选档：标准版 58 / 大板 87 / 超大版 116（不再让用户手动选板数）
  detailScore.value = estimateDetail(el)
  const tier = pickTier(detailScore.value)
  let targetWidth = tier.width
  // 有纯色背景且默认开启「背景留空 + 自动裁剪」时，按主体占比放大网格，
  // 让裁剪后的主体实际宽度达到档位宽度（避免白边图生成出来的主体过小、细节不足）
  if (removeBg.value && autoCrop.value && !isPixelArt(el)) {
    const ratio = estimateContentRatio(el)
    targetWidth = Math.min(112, Math.max(tier.width, Math.round(tier.width / ratio)))
  }
  width.value = targetWidth
  result.value = null
  detailNote.value = `已按图片细节自动选择「${tier.label}」：${targetWidth} 豆宽`
}

async function onFile(file: File | undefined) {
  error.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    error.value = '请选择图片文件'
    return
  }
  try {
    const el = await loadImageFromFile(file)
    applyLoadedImage(el, file.name.replace(/\.[^.]+$/, ''))
  } catch {
    error.value = '图片加载失败，请换一张试试'
  }
}

onMounted(() => {
  // 从「AI 生成图纸」页跳转过来：载入 sessionStorage 里暂存的 AI 图片
  const ai = sessionStorage.getItem('pd_ai_image')
  if (ai) {
    sessionStorage.removeItem('pd_ai_image')
    const el = new Image()
    el.onload = () => applyLoadedImage(el, 'AI 生成图片')
    el.onerror = () => (error.value = 'AI 图片加载失败，请返回 AI 生成页重新生成')
    el.src = ai
  }
})

function autoBg() {
  if (!image.value) return
  const srcRect = cropEnabled.value && cropRect.value ? cropRect.value : null
  bgColor.value = rgbTripleToHex(detectBackgroundColor(image.value.el, srcRect))
}

function onCropToggle() {
  if (cropEnabled.value) {
    // 开启裁剪：展开面板，默认框选整图方便直接缩小/移动
    cropOpen.value = true
    if (!cropRect.value && image.value) {
      cropRect.value = { x: 0, y: 0, w: image.value.w, h: image.value.h }
    }
  } else {
    // 关闭裁剪：清空选区
    cropOpen.value = false
    cropRect.value = null
  }
}

function onCropConfirm() {
  // 完成裁剪：收起面板但保留裁剪区域，生成时使用该区域
  cropOpen.value = false
}

function onCropCancel() {
  cropOpen.value = false
  cropEnabled.value = false
  cropRect.value = null
}

function resetCrop() {
  if (!image.value) return
  cropRect.value = { x: 0, y: 0, w: image.value.w, h: image.value.h }
}

async function generate() {
  if (!image.value) return
  error.value = ''
  generating.value = true
  progress.value = 0
  originalPreview.value = null
  preCropSize.value = null
  try {
    const srcRect = cropEnabled.value && cropRect.value ? cropRect.value : null
    if (srcRect) detailScore.value = estimateDetail(image.value.el, srcRect)
    preCropSize.value = { w: outputSize.value.w, h: outputSize.value.h }

    const best = await generateBestPattern(
      {
        image: image.value.el,
        palette: palette.value,
        srcRect,
        userWidth: outputSize.value.w,
        userMaxColors: maxColors.value,
        exclude: onlyOwnedColors.value && ownedColorCount.value > 0
          ? new Set(palette.value.colors.filter((c) => store.ownedCount(paletteId.value, c.code) <= 0).map((c) => c.code))
          : null,
        mode: mode.value,
        bgColor: bgColor.value,
        bgThreshold: bgThreshold.value,
        // 高级设置：真正透传给生成管线
        detail: detail.value,
        enhance: enhance.value,
        saturate: saturate.value,
        sharpen: sharpen.value,
        contrast: contrast.value,
        brightness: brightness.value,
        protectDark: protectDark.value,
        denoise: denoise.value,
        outline: outline.value,
        removeBg: removeBg.value,
        smartBg: smartBg.value,
        autoCrop: autoCrop.value,
        borderTol: borderTol.value,
      },
      (p) => (progress.value = p)
    )

    const id = result.value?.id ?? `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const pat: Pattern = {
      id,
      name: resultName.value || '我的拼豆图纸',
      description: '由图片自动生成的拼豆图纸',
      tags: ['图片转图纸'],
      paletteId: paletteId.value,
      width: best.width,
      height: best.height,
      rows: best.rows,
      source: 'generated',
      createdAt: Date.now(),
    }
    result.value = pat
    remapPaletteId.value = paletteId.value
    previewCell.value = Math.max(6, Math.min(16, Math.floor(1000 / (best.width + 1))))
    originalPreview.value = {
      pixels: best.previewPixels,
      w: best.previewW,
      h: best.previewH,
    }
    pat.id = store.savePattern(pat)
  } catch {
    error.value = '生成失败，请重试'
  } finally {
    generating.value = false
  }
}

function rename() {
  if (!result.value) return
  result.value.name = resultName.value || '我的拼豆图纸'
  store.savePattern(result.value)
}

/** A2：一键拼豆风 —— 预设一组适合卡通拼豆的参数并重新生成 */
function applyBeadStyle() {
  mode.value = 'nearest'
  maxColors.value = 24
  contrast.value = 12
  saturate.value = 1.3
  brightness.value = 0
  sharpen.value = true
  protectDark.value = true
  denoise.value = true
  outline.value = true
  enhance.value = true
  generate()
}

/** A5：一键切换品牌色卡并重新映射当前图纸 */
const remapPaletteId = ref('')
const brandMsg = ref('')
function switchBrandPalette() {
  if (!result.value) return
  const target = getPalette(remapPaletteId.value)
  if (!target) return
  if (target.id === result.value.paletteId) {
    brandMsg.value = '已经是这套色卡了'
    setTimeout(() => (brandMsg.value = ''), 2500)
    return
  }
  const converted = convertPatternPalette(result.value, palette.value, target)
  result.value.rows = converted.rows
  result.value.width = converted.width
  result.value.height = converted.height
  result.value.paletteId = target.id
  paletteId.value = target.id
  remapPaletteId.value = target.id
  store.savePattern(result.value)
  brandMsg.value = `已重新映射到「${target.title}」并保存到我的图纸`
  setTimeout(() => (brandMsg.value = ''), 3500)
}

function downloadPNG(withCodes: boolean) {
  const pat = displayPattern.value
  if (!pat) return
  const cell = withCodes ? 24 : 12
  const canvas = patternToCanvas(pat, palette.value, {
    cellSize: cell,
    showCodes: withCodes,
    showGrid: true,
    background: '#ffffff',
    padding: 8,
    showCoords: true,
    boardSize
  })
  downloadCanvas(canvas, `${safeFileName(pat.name)}${withCodes ? '-色号版' : ''}.png`)
}

function exportCSV() {
  const pat = displayPattern.value
  if (!pat) return
  downloadText(
    exportUsageCSV(pat, palette.value),
    `${safeFileName(pat.name)}-用豆统计.csv`,
    'text/csv;charset=utf-8'
  )
}

function edit() {
  if (!result.value) return
  // 有重映射未保存时先落盘，保证编辑器里看到的是当前效果
  if (hasRemap.value) saveRemap()
  router.push(`/editor/${result.value.id}`)
}

function downloadSheet() {
  const pat = displayPattern.value
  if (!pat) return
  const canvas = renderPatternSheet(pat, palette.value, { showCoords: true, boardSize })
  downloadCanvas(canvas, `${safeFileName(pat.name)}-图纸+色号统计.png`)
}

function printA4() {
  const pat = displayPattern.value
  if (!pat) return
  printPatternTiled(pat, palette.value, { cellSize: 14, showCoords: true, boardSize })
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-stone-800 sm:text-2xl">🖼️ 图片转图纸</h1>
        <p class="mt-1 text-sm text-stone-500">上传任意图片，自动匹配色卡转成拼豆图纸。</p>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-[360px_1fr]">
      <!-- 左侧：上传 + 参数 -->
      <section class="card h-fit min-w-0 space-y-4 p-5">
        <div
          class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition"
          :class="dragOver ? 'border-brand-400 bg-brand-50' : 'border-stone-200 bg-stone-50 hover:border-brand-300 hover:bg-brand-50/50'"
          @click="fileInput?.click()"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop.prevent="dragOver = false; onFile($event.dataTransfer?.files?.[0])"
        >
          <div v-if="!image" class="text-stone-400">
            <div class="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-white text-2xl shadow-sm">🖼️</div>
            <p class="text-sm font-medium text-stone-500">点击或拖拽图片到这里</p>
            <p class="mt-1 text-xs">支持 JPG / PNG / WebP 等格式</p>
          </div>
          <div v-else class="flex items-center gap-3">
            <img :src="image.el.src" class="h-16 w-16 rounded-xl object-cover ring-1 ring-stone-200" />
            <div class="text-left">
              <p class="max-w-[220px] truncate text-sm font-medium text-stone-700">{{ image.name }}</p>
              <p class="mt-0.5 text-xs text-stone-400">{{ image.w }} × {{ image.h }} px</p>
              <button class="mt-1 text-xs font-medium text-brand-500 hover:underline" @click.stop="fileInput?.click()">
                重新选择
              </button>
            </div>
          </div>
          <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFile(($event.target as HTMLInputElement).files?.[0])" />
        </div>

        <div v-if="image" class="space-y-4">
          <label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-500">
            <input v-model="cropEnabled" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" @change="onCropToggle" /> 裁剪图片（生成前）
          </label>
          <div v-if="cropEnabled && cropRect && !cropOpen" class="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700">
            <span class="font-medium">✂️ 已裁剪 {{ cropRect.w }}×{{ cropRect.h }} px，生成时将只使用该区域</span>
            <button type="button" class="shrink-0 rounded-md bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-600" @click="cropOpen = true">
              重新裁剪
            </button>
          </div>

          <div v-if="cropOpen" class="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <ImageCropper
              v-model="cropRect"
              :src="image.el.src"
              :image-w="image.w"
              :image-h="image.h"
              @confirm="onCropConfirm"
              @cancel="onCropCancel"
            />
            <div class="mt-3 rounded-lg border border-stone-200 bg-white p-2 shadow-sm">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <button type="button" class="rounded-md border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-600 shadow-sm hover:bg-stone-100" @click="resetCrop">
                    ↺ 重置整图
                  </button>
                  <button type="button" class="rounded-md border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-600 shadow-sm hover:bg-stone-100" @click="onCropCancel">
                    ✕ 取消裁剪
                  </button>
                </div>
                <button type="button" class="rounded-md bg-brand-500 px-6 py-2 text-sm font-semibold text-white shadow hover:bg-brand-600" @click="onCropConfirm">
                  ✓ 完成裁剪
                </button>
              </div>
              <p class="mt-1.5 text-[11px] text-stone-400">拖动选区移动，拖动四角/四边缩放；回车或右键完成裁剪</p>
            </div>
          </div>

          <label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-500">
            <input v-model="showSrcPreview" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" /> 原图预览（查看原始图片与裁剪范围）
          </label>
          <div v-if="showSrcPreview" class="overflow-hidden rounded-xl border border-stone-200 bg-white p-2">
            <canvas ref="srcPreviewRef" class="mx-auto block max-w-full" style="image-rendering: auto"></canvas>
            <p class="mt-1 text-center text-[11px] text-stone-400">{{ image.w }} × {{ image.h }} px<template v-if="cropEnabled && cropRect"> · 裁剪区域 {{ cropRect.w }}×{{ cropRect.h }}（橙色框）</template></p>
          </div>

          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">品牌色卡</label>
            <select v-model="paletteId" class="input">
              <optgroup v-for="g in paletteGroups()" :key="g.label" :label="g.label">
                <option v-for="p in g.items" :key="p.id" :value="p.id">{{ p.title }}（{{ p.count }} 色）</option>
              </optgroup>
            </select>
          </div>

          <div>
            <div class="mb-1.5 flex items-center justify-between text-xs font-medium text-stone-500">
              <label for="width-slider">生成宽度（豆数）</label>
              <span class="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-brand-600">
                {{ outputSize.w }}×{{ outputSize.h }} 豆
              </span>
            </div>
            <input
              id="width-slider"
              v-model.number="width"
              type="range"
              min="16"
              max="256"
              step="1"
              class="w-full accent-brand-500"
            />
            <div v-if="detailNote" class="mt-2 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-[11px] leading-4 text-brand-700">
              {{ detailNote }}
              <button class="ml-1 font-medium text-brand-600 hover:underline" @click="detailNote = ''">知道了</button>
            </div>
            <div class="mt-1 flex justify-between text-[10px] text-stone-300"><span>16 豆</span><span>256 豆</span></div>
            <p class="mt-1 text-[11px] text-stone-400">上传后按图片复杂度自动选择「标准版 / 大板 / 超大版」，也可拖动自由调整；豆数越多细节越丰富。开启「自动裁剪空白」后，实际图纸会比这里的生成尺寸小（去掉了图案外的空白格），最终格数以右侧结果为准。</p>
          </div>

          <button class="btn btn-secondary w-full !py-2 text-sm" @click="showAdvanced = !showAdvanced">
            {{ showAdvanced ? '收起高级设置' : '展开高级设置' }}
          </button>

          <div v-if="showAdvanced">
            <div>
              <label class="mb-1.5 block text-xs font-medium text-stone-500">配色算法</label>
            <div class="grid grid-cols-2 gap-2">
              <button
                class="rounded-xl px-3 py-2 text-xs font-medium ring-1 transition"
                :class="mode === 'nearest' ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200 hover:bg-stone-50'"
                @click="mode = 'nearest'"
              >
                最近色（色块干净）
              </button>
              <button
                class="rounded-xl px-3 py-2 text-xs font-medium ring-1 transition"
                :class="mode === 'floyd' ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200 hover:bg-stone-50'"
                @click="mode = 'floyd'"
              >
                抖动（细腻过渡）
              </button>
            </div>
            <label class="mt-2 flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-500">
              <input v-model="onlyOwnedColors" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" />
              仅用手头颜色（豆仓已有 {{ ownedColorCount }} 色）
            </label>
            <p class="mt-1 text-[11px] leading-4 text-stone-400">没有的颜色会被自动替换成豆仓里最近的颜色，保证图纸能直接拼。</p>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1.5 block text-xs font-medium text-stone-500">细节（采样精度）</label>
              <select v-model.number="detail" class="input !py-1.5">
                <option :value="1">标准</option>
                <option :value="2">精细（推荐）</option>
                <option :value="3">超清</option>
              </select>
            </div>
            <div class="flex flex-col items-start justify-end gap-1.5 pb-1">
              <label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-500">
                <input v-model="enhance" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" />
                色彩增强
              </label>
              <label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-500">
                <input v-model="sharpen" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" />
                边缘锐化
              </label>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1.5 block text-xs font-medium text-stone-500">颜色数量上限</label>
              <select v-model.number="maxColors" class="input !py-1.5">
                <option :value="0">关闭（全部颜色）</option>
                <option :value="16">16 色</option>
                <option :value="24">24 色</option>
                <option :value="32">32 色（推荐）</option>
                <option :value="48">48 色（细节更多）</option>
              </select>
              <p class="mt-1 text-[11px] text-stone-400">限制颜色数会自动合并相似色，去掉杂色，图案更干净好拼。</p>
              <label class="mt-1.5 flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-500">
                <input v-model="outline" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" />
                深色描边（勾出轮廓）
              </label>
              <label class="mt-1.5 flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-500">
                <input v-model="protectDark" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" />
                保留细线细节（胡须/轮廓）
              </label>
              <label class="mt-1.5 flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-500">
                <input v-model="denoise" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" />
                去杂点（清理孤立噪点）
              </label>
            </div>
            <div class="space-y-3">
              <div>
                <label class="mb-1.5 block text-xs font-medium text-stone-500">对比度：{{ contrast > 0 ? '+' : '' }}{{ contrast }}</label>
                <input v-model.number="contrast" type="range" min="-50" max="50" step="1" class="w-full accent-brand-500" />
                <div class="mt-1 flex justify-between text-[10px] text-stone-400"><span>-50</span><span>+50</span></div>
                <p class="mt-1 text-[11px] text-stone-400">提高对比度让轮廓更清晰、颜色更分明。</p>
              </div>
              <div>
                <label class="mb-1.5 block text-xs font-medium text-stone-500">亮度：{{ brightness > 0 ? '+' : '' }}{{ brightness }}</label>
                <input v-model.number="brightness" type="range" min="-50" max="50" step="1" class="w-full accent-brand-500" />
                <div class="mt-1 flex justify-between text-[10px] text-stone-400"><span>变暗</span><span>变亮</span></div>
                <p class="mt-1 text-[11px] text-stone-400">整体调亮/调暗画面。</p>
              </div>
              <div>
                <label class="mb-1.5 block text-xs font-medium text-stone-500">饱和度：{{ saturate.toFixed(2) }}</label>
                <input v-model.number="saturate" type="range" min="0.5" max="2" step="0.05" class="w-full accent-brand-500" />
                <div class="mt-1 flex justify-between text-[10px] text-stone-400"><span>0.5 灰</span><span>2.0 鲜艳</span></div>
                <p class="mt-1 text-[11px] text-stone-400">颜色更鲜艳或更素；关闭「色彩增强」时按 1 计算。</p>
              </div>
            </div>
          </div>

          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">背景处理</label>
            <div class="grid grid-cols-2 gap-2">
              <button
                class="rounded-xl px-3 py-2 text-xs font-medium ring-1 transition"
                :class="!removeBg ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200 hover:bg-stone-50'"
                @click="removeBg = false"
              >
                保留背景
              </button>
              <button
                class="rounded-xl px-3 py-2 text-xs font-medium ring-1 transition"
                :class="removeBg ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200 hover:bg-stone-50'"
                @click="removeBg = true"
              >
                背景留空
              </button>
            </div>
            <div v-if="removeBg" class="mt-3 space-y-2 rounded-xl bg-stone-50 p-3">
              <div class="flex items-center gap-2">
                <span class="text-xs text-stone-500">背景色</span>
                <input v-model="bgColor" type="color" class="h-7 w-10 cursor-pointer rounded ring-1 ring-stone-200" />
                <span class="font-mono text-xs text-stone-500">{{ bgColor.toUpperCase() }}</span>
                <button class="ml-auto text-xs font-medium text-brand-500 hover:underline" @click="autoBg">自动</button>
              </div>
              <div class="flex items-center gap-2 text-xs text-stone-500">
                <span class="shrink-0">灵敏度</span>
                <input v-model.number="bgThreshold" type="range" min="5" max="50" step="1" class="w-24 accent-brand-500" />
                <span class="w-6 text-right">{{ bgThreshold }}</span>
              </div>
              <label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-500">
                <input v-model="smartBg" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" />
                智能抠图（边缘连通去背景）
              </label>
              <div v-if="smartBg" class="flex items-center gap-2 text-xs text-stone-500">
                <span class="shrink-0">抠图灵敏度</span>
                <input v-model.number="borderTol" type="range" min="10" max="80" step="1" class="w-24 accent-brand-500" />
                <span class="w-6 text-right">{{ borderTol }}</span>
              </div>
              <label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-500">
                <input v-model="autoCrop" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" />
                自动裁剪空白边距
              </label>
              <p class="text-[11px] leading-4 text-stone-400">与背景色接近的格子会留空不拼豆（默认开启），生成后自动裁掉图案外的空白边距，用豆统计也只算图案部分。</p>
            </div>
          </div>
          </div>

          <button class="btn btn-secondary w-full !py-2.5" :disabled="generating || !image" @click="applyBeadStyle">
            ✨ 一键拼豆风（预设参数并重新生成）
          </button>
          <button class="btn btn-primary w-full !py-2.5" :disabled="generating" @click="generate">
            <template v-if="!generating">⚡ 生成图纸</template>
            <template v-else>
              <span class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
              正在生成… {{ Math.round(progress * 100) }}%
            </template>
          </button>
          <div v-if="generating" class="h-1.5 overflow-hidden rounded-full bg-stone-100">
            <div class="h-full rounded-full bg-brand-500 transition-all" :style="{ width: progress * 100 + '%' }"></div>
          </div>
          <p v-if="error" class="text-xs text-red-500">{{ error }}</p>
        </div>
      </section>

      <!-- 右侧：结果 -->
      <section v-if="!result" class="card min-h-[320px] min-w-0 place-items-center p-10 text-center">
        <div>
          <p class="text-4xl">🧩</p>
          <p class="mt-3 text-sm text-stone-400">上传图片并点击「生成图纸」后，这里会显示结果</p>
        </div>
      </section>

      <section v-else class="card min-w-0 space-y-4 p-5">
        <div class="flex flex-wrap items-center gap-3">
          <input v-model="resultName" class="input max-w-xs !py-1.5" @change="rename" />
          <button class="btn btn-secondary" @click="rename">✏️ 重命名</button>
          <span v-if="isSaved" class="rounded-full bg-green-50 px-2 py-1 text-[11px] font-medium text-green-600">✓ 已保存在「我的图纸」</span>
        </div>

        <div class="flex flex-wrap gap-2 text-xs text-stone-400">
          <span>{{ result.width }} × {{ result.height }} 格</span>
          <span v-if="preCropSize && (preCropSize.w !== result.width || preCropSize.h !== result.height)" class="rounded-full bg-stone-100 px-2 py-0.5 text-stone-500" title="生成网格尺寸与自动裁剪空白后的实际尺寸">
            生成 {{ preCropSize.w }}×{{ preCropSize.h }} → 裁剪后 {{ result.width }}×{{ result.height }}
          </span>
          <span>·</span>
          <span>{{ usage.length }} 种颜色</span>
          <span>·</span>
          <span>共 {{ totalBeads }} 颗豆</span>
          <span v-if="boardInfo" class="rounded-full bg-sky-50 px-2 py-0.5 text-sky-600">
            📦 需 {{ boardInfo.total }} 块 {{ boardInfo.b }}×{{ boardInfo.b }} 板（{{ boardInfo.bx }}×{{ boardInfo.by }} 排布）
          </span>
          <span v-if="marginInfo" class="rounded-full bg-stone-100 px-2 py-0.5 text-stone-500">
            底板 {{ marginInfo.tw }}×{{ marginInfo.th }} · 外围留空：右 {{ marginInfo.right }} · 下 {{ marginInfo.bottom }}
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-2 rounded-xl bg-stone-100 px-3 py-2 text-xs text-stone-600">
          <span class="font-medium">🔁 切换品牌色卡并重新映射：</span>
          <select v-model="remapPaletteId" class="input !w-56 !py-1 text-xs">
            <optgroup v-for="g in paletteGroups()" :key="g.label" :label="g.label">
              <option v-for="p in g.items" :key="p.id" :value="p.id">{{ p.title }}（{{ p.count }} 色）</option>
            </optgroup>
          </select>
          <button class="btn btn-primary !py-1 text-xs" @click="switchBrandPalette">重新映射并保存</button>
          <span v-if="brandMsg" class="text-brand-600">{{ brandMsg }}</span>
        </div>

        
        <div class="flex flex-wrap items-center gap-3 rounded-xl bg-stone-100 px-3 py-2 text-xs text-stone-600">
          <div class="flex items-center gap-1 rounded-lg bg-white p-1 ring-1 ring-stone-200">
            <button
              class="rounded-md px-2.5 py-1 font-medium transition"
              :class="showOriginal ? 'text-stone-500 hover:text-stone-700' : 'bg-brand-500 text-white'"
              @click="showOriginal = false"
            >拼豆图纸</button>
            <button
              class="rounded-md px-2.5 py-1 font-medium transition"
              :class="showOriginal ? 'bg-brand-500 text-white' : 'text-stone-500 hover:text-stone-700'"
              @click="showOriginal = true"
            >原色预览</button>
          </div>
          <label v-if="!showOriginal" class="flex cursor-pointer items-center gap-1.5 font-medium">
            <input v-model="showCodes" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" /> 显示色号
          </label>
          <label v-if="!showOriginal" class="flex cursor-pointer items-center gap-1.5 font-medium" title="把图纸按底板补齐，外围空位显示为空格子，方便数出要空几格">
            <input v-model="showMargin" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" /> 底板外围留空
          </label>
          <span class="text-stone-300">|</span>
          <span>格子大小</span>
          <input v-model.number="previewCell" type="range" min="4" max="18" step="1" class="w-40 accent-brand-500" />
          <span class="w-9 text-right font-mono">{{ previewCell }}px</span>
          <span v-if="result.width * previewCell > 900" class="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-600">
            图纸较宽，可在下方预览区横向滚动查看
          </span>
        </div>

        <div class="overflow-auto rounded-xl bg-stone-50 p-4" style="max-height: 60vh">
          <canvas
            v-if="showOriginal"
            ref="originalCanvasRef"
            class="mx-auto block"
            style="image-rendering: pixelated; max-width: 100%; height: auto"
          ></canvas>
          <PatternGrid
            v-else
            :pattern="displayPattern!"
            :palette="palette"
            :cell-size="previewCell"
            :show-codes="showCodes"
            show-coords
            :board-size="boardSize"
            force-canvas
          />
        </div>

        <div class="flex flex-wrap gap-2">
          <button class="btn btn-primary" @click="downloadPNG(false)">⬇ 下载图片</button>
          <button class="btn btn-secondary" @click="downloadPNG(true)">⬇ 色号版</button>
          <button class="btn btn-secondary" @click="downloadSheet">🖨 图纸+色号统计</button>
          <button class="btn btn-secondary" @click="printA4">🖨 A4 分区打印</button>
          <button class="btn btn-secondary" @click="exportCSV">⇩ CSV 用豆统计</button>
          <button class="btn btn-secondary" @click="edit">✏️ 去编辑</button>
        </div>

        <details open class="rounded-xl bg-stone-50 p-3">
          <summary class="cursor-pointer text-xs font-medium text-stone-500">🧮 库存对照（这张图纸用多少豆 / 豆仓还差多少）</summary>
          <div class="mt-3">
            <ColorLegend :pattern="displayPattern!" :palette="palette" />
            <p class="mt-2 text-[11px] leading-4 text-stone-400">
              上表「需要」即这张图纸每种颜色要用多少颗豆；在「豆仓」登记库存后会显示够不够、还差几颗。
              <router-link to="/warehouse" class="font-medium text-brand-500 hover:underline">去豆仓登记 →</router-link>
            </p>
          </div>
        </details>

        <details open class="rounded-xl bg-stone-50 p-3">
          <summary class="cursor-pointer text-xs font-medium text-stone-500">🎨 颜色优化（合并相似色 / 去杂色 / 排除重映射）</summary>
          <div class="mt-3 space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="mb-1 block text-[11px] text-stone-500">合并相似色阈值</label>
                <input v-model.number="mergeThreshold" type="range" min="0" max="30" step="1" class="w-full accent-brand-500" />
                <div class="flex justify-between text-[10px] text-stone-400"><span>关闭 0</span><span>{{ mergeThreshold }}</span></div>
              </div>
              <div>
                <label class="mb-1 block text-[11px] text-stone-500">去杂色（少于 N 颗 → 最近色）</label>
                <input v-model.number="noiseMin" type="range" min="0" max="10" step="1" class="w-full accent-brand-500" />
                <div class="flex justify-between text-[10px] text-stone-400"><span>关闭 0</span><span>{{ noiseMin }}</span></div>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button class="btn btn-secondary !py-1.5 text-xs" @click="applyOptimize">应用优化</button>
              <button v-if="hasRemap" class="btn btn-primary !py-1.5 text-xs" @click="saveRemap">保存重映射</button>
              <span v-if="mergeMsg" class="text-xs text-brand-600">{{ mergeMsg }}</span>
            </div>
            <div class="border-t border-stone-200 pt-3">
              <div class="mb-1.5 flex items-center justify-between">
                <span class="text-[11px] font-medium text-stone-500">颜色排除 / 重映射（实时预览）</span>
                <button v-if="hasRemap" class="text-[11px] font-medium text-brand-500 hover:underline" @click="clearRemap">清空重映射</button>
              </div>
              <div class="max-h-56 space-y-1 overflow-auto pr-1">
                <div v-for="u in remapRows" :key="u.code" class="flex items-center gap-2 text-xs">
                  <span class="h-5 w-5 shrink-0 rounded ring-1 ring-stone-200" :style="{ background: colorOf(u.code) }"></span>
                  <span class="w-12 shrink-0 font-mono">{{ u.code }}</span>
                  <span class="w-12 shrink-0 text-right text-stone-400">{{ u.count }}</span>
                  <select
                    class="input !min-w-0 flex-1 !py-1 text-xs"
                    :value="remapValue(u.code)"
                    @change="onRemapChange(u.code, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="__keep">保持</option>
                    <option value="__empty">留空（不拼）</option>
                    <option value="__auto">自动→最近色</option>
                    <optgroup v-if="otherCodes(u.code).length" label="替换为其他已用色号">
                      <option v-for="o in otherCodes(u.code)" :key="o" :value="o">{{ o }}</option>
                    </optgroup>
                  </select>
                </div>
              </div>
              <p class="mt-2 text-[11px] leading-4 text-stone-400">留空=该色不拼豆；自动→最近色=换成视觉上最接近的其他颜色；替换为其他色号则全部换掉。预览满意后点「保存重映射」。</p>
            </div>
          </div>
        </details>
      </section>
    </div>
  </div>
</template>