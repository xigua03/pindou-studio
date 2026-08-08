<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { GenMode, Pattern } from '../types'
import { PALETTES, getPalette, paletteGroups } from '../data/palettes'
import { useStore } from '../composables/useStore'
import PatternGrid from '../components/PatternGrid.vue'
import ColorLegend from '../components/ColorLegend.vue'
import ImageCropper from '../components/ImageCropper.vue'
import type { CropRect } from '../types'
import { loadImageFromFile, imageToGridColors, quantizeImageAsync, detectBackgroundColor, backgroundFromHex, rgbTripleToHex, cropEmptyBorders, buildBgMask, emptyOuterBackground, mergePatternColors, applyRemap, nearestUsedCode } from '../utils/quantize'
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
const bgThreshold = ref(18) // 背景阈值（CIEDE2000）
const bgColor = ref('#FFFFFF') // 背景色
const autoCrop = ref(true) // 自动裁剪空白边距
const sharpen = ref(true) // 边缘锐化
// 上传前裁剪
const cropEnabled = ref(false)
const cropRect = ref<CropRect | null>(null)
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
  let outW = Math.max(8, Math.min(200, width.value))
  let outH = Math.max(8, Math.round((outW * h) / w))
  if (outH > 200) {
    outH = 200
    outW = Math.max(8, Math.round((200 * w) / h))
  }
  return { w: outW, h: outH }
})

/** 重映射后的展示图纸（实时预览，不直接改 result） */
const displayPattern = computed(() => {
  if (!result.value) return null
  return { ...result.value, rows: applyRemap(result.value.rows, remapMap.value) }
})
const usage = computed(() => (displayPattern.value ? computeColorUsage(displayPattern.value) : []))
const totalBeads = computed(() => usage.value.reduce((s, u) => s + u.count, 0))
const isSaved = computed(() => (result.value ? store.getPattern(result.value.id) !== undefined : false))

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

async function onFile(file: File | undefined) {
  error.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    error.value = '请选择图片文件'
    return
  }
  try {
    const el = await loadImageFromFile(file)
    cropEnabled.value = false
    cropRect.value = null
    image.value = { el, name: file.name.replace(/\.[^.]+$/, ''), w: el.naturalWidth, h: el.naturalHeight }
    resultName.value = image.value.name || '我的拼豆图纸'
    // 自动检测背景色（四角中位色）
    bgColor.value = rgbTripleToHex(detectBackgroundColor(el))
    // 默认宽度按图片尺寸自适应（约 1/4 宽，48-110 之间）
    width.value = Math.max(48, Math.min(110, Math.round(el.naturalWidth / 4)))
    result.value = null
  } catch {
    error.value = '图片加载失败，请换一张试试'
  }
}

function autoBg() {
  if (!image.value) return
  const srcRect = cropEnabled.value && cropRect.value ? cropRect.value : null
  bgColor.value = rgbTripleToHex(detectBackgroundColor(image.value.el, srcRect))
}

function onCropToggle() {
  // 开启裁剪时默认框选整图，方便直接缩小/移动
  if (cropEnabled.value && !cropRect.value && image.value) {
    cropRect.value = { x: 0, y: 0, w: image.value.w, h: image.value.h }
  }
}

async function generate() {
  if (!image.value) return
  error.value = ''
  generating.value = true
  progress.value = 0
  try {
    const { w, h } = outputSize.value
    const srcRect = cropEnabled.value && cropRect.value ? cropRect.value : null
    const pixels = imageToGridColors(image.value.el, w, h, detail.value, enhance.value ? 1.3 : 1, sharpen.value ? 0.8 : 0, srcRect)
    const { rows } = await quantizeImageAsync(pixels, w, h, palette.value, mode.value, (p) => (progress.value = p))

    // 背景留空：只去掉从边缘连通的背景区域（图案内部的同色部分保留为豆子）
    let finalRows = rows
    if (removeBg.value) {
      const mask = buildBgMask(pixels, w, h, backgroundFromHex(bgColor.value, bgThreshold.value))
      finalRows = emptyOuterBackground(finalRows, mask)
    }

    // 自动裁剪图案外的空白边距
    let outW = w
    let outH = h
    if (autoCrop.value) {
      const cropped = cropEmptyBorders(rows)
      if (cropped) {
        finalRows = cropped.rows
        outW = cropped.w
        outH = cropped.h
      }
    }
    const id = result.value?.id ?? `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const pat: Pattern = {
      id,
      name: resultName.value || '我的拼豆图纸',
      description: '由图片自动生成的拼豆图纸',
      tags: ['图片转图纸'],
      paletteId: paletteId.value,
      width: outW,
      height: outH,
      rows: finalRows,
      source: 'generated',
      createdAt: Date.now()
    }
    result.value = pat
    // 内容相同则复用已有图纸的 id（不新增重复）
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

function downloadPNG(withCodes: boolean) {
  const pat = displayPattern.value
  if (!pat) return
  const cell = withCodes ? 24 : 12
  const canvas = patternToCanvas(pat, palette.value, {
    cellSize: cell,
    showCodes: withCodes,
    showGrid: true,
    background: '#ffffff',
    padding: 8
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
  const canvas = renderPatternSheet(pat, palette.value)
  downloadCanvas(canvas, `${safeFileName(pat.name)}-图纸+色号统计.png`)
}

function printA4() {
  const pat = displayPattern.value
  if (!pat) return
  printPatternTiled(pat, palette.value, { cellSize: 14 })
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-stone-800 sm:text-2xl">🖼️ 图片转图纸</h1>
        <p class="mt-1 text-sm text-stone-500">上传任意图片，自动匹配色卡转成拼豆图纸，全程在本地浏览器处理，图片不会上传。</p>
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
          <div v-if="cropEnabled" class="rounded-xl bg-stone-50 p-3">
            <ImageCropper v-model="cropRect" :src="image.el.src" :image-w="image.w" :image-h="image.h" />
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
              <label for="width-slider">图纸宽度（豆数）</label>
              <span class="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-brand-600">{{ outputSize.w }}×{{ outputSize.h }}</span>
            </div>
            <input id="width-slider" v-model.number="width" type="range" min="16" max="200" step="1" class="w-full accent-brand-500" />
            <div class="mt-1 flex justify-between text-[10px] text-stone-300"><span>16</span><span>200</span></div>
          </div>

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
                抖动（细节丰富）
              </button>
            </div>
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
                <input v-model="autoCrop" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" />
                自动裁剪空白边距
              </label>
              <p class="text-[11px] leading-4 text-stone-400">与背景色接近的格子会留空不拼豆（默认开启），生成后自动裁掉图案外的空白边距，用豆统计也只算图案部分。</p>
            </div>
          </div>

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
          <span>·</span>
          <span>{{ usage.length }} 种颜色</span>
          <span>·</span>
          <span>共 {{ totalBeads }} 颗豆</span>
        </div>

        <div class="flex flex-wrap items-center gap-3 rounded-xl bg-stone-100 px-3 py-2 text-xs text-stone-600">
          <label class="flex cursor-pointer items-center gap-1.5 font-medium">
            <input v-model="showCodes" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" /> 显示色号
          </label>
          <span class="text-stone-300">|</span>
          <span>格子大小</span>
          <input v-model.number="previewCell" type="range" min="4" max="24" step="1" class="w-32 accent-brand-500" />
          <span class="w-9 text-right font-mono">{{ previewCell }}px</span>
          <span v-if="result.width * previewCell > 900" class="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-600">
            图纸较宽，可在下方预览区横向滚动查看
          </span>
        </div>

        <div class="overflow-auto rounded-xl bg-stone-50 p-4" style="max-height: 60vh">
          <PatternGrid
            :pattern="displayPattern!"
            :palette="palette"
            :cell-size="previewCell"
            :show-codes="showCodes"
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

        <details class="rounded-xl bg-stone-50 p-3">
          <summary class="cursor-pointer text-xs font-medium text-stone-500">📊 查看用豆统计</summary>
          <div class="mt-2">
            <ColorLegend :pattern="displayPattern!" :palette="palette" />
          </div>
        </details>
      </section>
    </div>
  </div>
</template>