<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Pattern } from '../types'
import { getPalette, PALETTES, paletteGroups } from '../data/palettes'
import { useStore } from '../composables/useStore'
import { loadJSON, saveJSON } from '../utils/storage'
import PatternGrid from '../components/PatternGrid.vue'
import ColorLegend from '../components/ColorLegend.vue'
import Bead3DPreview from '../components/Bead3DPreview.vue'
import {
  computeColorUsage,
  patternToCanvas,
  renderPatternSheet,
  downloadCanvas,
  exportUsageCSV,
  downloadText,
  printPattern,
  printPatternTiled,
  safeFileName,
  computeShoppingList,
  printShoppingList,
  exportShoppingCSV,
  renderBoardLayout
} from '../utils/export'
import { buildPatternFromRows, convertPatternPalette } from '../utils/quantize'
import { remoteSaveShare, remoteDeleteShare, remoteGetShare } from '../utils/shareApi'

const route = useRoute()
const router = useRouter()
const store = useStore()

const pattern = computed<Pattern | undefined>(() => store.getPattern(String(route.params.id)))
const palette = computed(() => (pattern.value ? getPalette(pattern.value.paletteId) : undefined))

const showCodes = ref(true)
const showGrid = ref(true)
const cellSize = ref(22)
const fitWidth = ref(true)
const fittedCell = ref(14)
const copied = ref(false)

// 拼豆进度追踪
const progressMode = ref(false)
const progressSet = ref<Set<string>>(new Set())
// 换色卡
const showConvert = ref(false)
const convertPaletteId = ref('mard-221-github')
const convertMsg = ref('')
// 底板规划
const boardSize = ref(29)
// 3D 预览
const show3d = ref(false)
// 购物清单 / BOM
const showBom = ref(false)
const beadPrice = ref(Number(loadJSON('bead_price', 0.05)) || 0.05)
const showShare = ref(false)
const shareUrl = ref('')
const shareCopied = ref(false)
const bomItems = computed(() =>
  pattern.value && palette.value
    ? computeShoppingList(pattern.value, palette.value, (code) => store.ownedCount(pattern.value!.paletteId, code))
    : []
)
const bomTotalNeed = computed(() => bomItems.value.reduce((s, i) => s + i.need, 0))
const bomTotalCost = computed(() => bomTotalNeed.value * beadPrice.value)

const gridWrap = ref<HTMLElement | null>(null)
let fitObserver: ResizeObserver | undefined
function updateFit() {
  const el = gridWrap.value
  const p = pattern.value
  if (!el || !p) return
  const avail = Math.max(120, el.clientWidth - 24)
  fittedCell.value = Math.max(6, Math.min(28, Math.floor(avail / (p.width + 1))))
}
function useManualCell() {
  fitWidth.value = false
  updateFit()
}
const usage = computed(() => (pattern.value ? computeColorUsage(pattern.value) : []))
const totalBeads = computed(() => usage.value.reduce((s, u) => s + u.count, 0))
const isFav = computed(() => (pattern.value ? store.isFavorite(pattern.value.id) : false))
const isSaved = computed(() => (pattern.value ? pattern.value.source !== 'builtin' : false))

// 底板规划：按当前板型计算需要几块板
const boardInfo = computed(() => {
  if (!pattern.value) return null
  const b = boardSize.value
  const bx = Math.ceil(pattern.value.width / b)
  const by = Math.ceil(pattern.value.height / b)
  return { b, bx, by, total: bx * by }
})

// 拼豆进度统计
const progressDone = computed(() => progressSet.value.size)
const progressTotal = computed(() => (pattern.value ? pattern.value.width * pattern.value.height : 0))
const progressPct = computed(() =>
  progressTotal.value ? Math.round((progressDone.value / progressTotal.value) * 100) : 0
)

onMounted(() => {
  if (!pattern.value) return
  const raw = loadJSON<string[]>(`progress_${pattern.value.id}`, [])
  progressSet.value = new Set(raw)
  convertPaletteId.value = pattern.value.paletteId
  updateFit()
  fitObserver = new ResizeObserver(updateFit)
  if (gridWrap.value) fitObserver.observe(gridWrap.value)
})
onUnmounted(() => fitObserver?.disconnect())

watch(
  () => pattern.value?.id,
  () => {
    if (!pattern.value) return
    progressMode.value = false
    progressSet.value = new Set(loadJSON<string[]>(`progress_${pattern.value.id}`, []))
    convertPaletteId.value = pattern.value.paletteId
  }
)

watch(
  () => progressSet.value,
  (v) => {
    if (pattern.value) saveJSON(`progress_${pattern.value.id}`, [...v])
  }
)

function toggleCell(x: number, y: number) {
  if (!progressMode.value || !pattern.value) return
  const key = `${x},${y}`
  const next = new Set(progressSet.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  progressSet.value = next
}

/** C14：拖拽连续标记为已完成 */
function dragCell(x: number, y: number) {
  if (!progressMode.value || !pattern.value) return
  const key = `${x},${y}`
  const next = new Set(progressSet.value)
  next.add(key)
  progressSet.value = next
}

/** C14：Shift+拖拽框选矩形区域（区域内全部已标记则取消，否则全部标记） */
function boxSelect(x0: number, y0: number, x1: number, y1: number) {
  if (!progressMode.value || !pattern.value) return
  const minX = Math.min(x0, x1)
  const maxX = Math.max(x0, x1)
  const minY = Math.min(y0, y1)
  const maxY = Math.max(y0, y1)
  const keys: string[] = []
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) keys.push(`${x},${y}`)
  }
  const allDone = keys.every((k) => progressSet.value.has(k))
  const next = new Set(progressSet.value)
  for (const k of keys) {
    if (allDone) next.delete(k)
    else next.add(k)
  }
  progressSet.value = next
}

function resetProgress() {
  if (!confirm('确定重置这张图纸的拼豆进度吗？')) return
  progressSet.value = new Set()
}

function doConvert() {
  if (!pattern.value || !palette.value) return
  const target = getPalette(convertPaletteId.value)
  if (!target) return
  if (target.id === pattern.value.paletteId) {
    convertMsg.value = '已经是这套色卡了'
    setTimeout(() => (convertMsg.value = ''), 2500)
    return
  }
  const converted = convertPatternPalette(pattern.value, palette.value, target)
  // 生成全新 id 的副本，避免与内置图纸同 id 导致跳转/保存冲突
  const copy = buildPatternFromRows(
    converted.rows,
    target.id,
    `${pattern.value.name}（${target.title}）`,
    'edited',
    pattern.value.tags
  )
  copy.description = `由「${pattern.value.name}」从 ${palette.value.title} 转换到 ${target.title}`
  const id = store.savePattern(copy)
  convertMsg.value = `已生成「${target.title}」版本并保存到我的图纸`
  setTimeout(() => (convertMsg.value = ''), 3500)
  router.push(`/pattern/${id}`)
}

function openShoppingList() {
  showBom.value = true
}

function printBom() {
  if (!pattern.value || !palette.value) return
  printShoppingList(pattern.value, palette.value, bomItems.value, beadPrice.value)
}

function exportBomCsv() {
  if (!pattern.value || !palette.value) return
  downloadText(
    exportShoppingCSV(pattern.value, palette.value, bomItems.value, beadPrice.value),
    `${safeFileName(pattern.value.name)}-购物清单.csv`,
    'text/csv;charset=utf-8'
  )
}

watch(beadPrice, (v) => saveJSON('bead_price', Number(v) || 0))

function downloadBoardLayout() {
  if (!pattern.value || !palette.value) return
  const canvas = renderBoardLayout(pattern.value, palette.value, { boardSize: boardSize.value })
  downloadCanvas(canvas, `${safeFileName(pattern.value.name)}-底板布局图.png`)
}

const SHARE_MAP_KEY = 'share_map'
const PATTERN_SHARE_KEY = 'pattern_share'
const SHARE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const shareId = ref('')
const shareErr = ref('')
const shareOk = ref(false)
const shareHint = ref('')
// 跨设备分享：是否已同步到服务器
const shareRemote = ref(false)
const shareBusy = ref(false)

interface ShareEntry {
  name: string
  paletteId: string
  rows: string[][]
  tags: string[]
  createdAt: number
  patternKey: string
}
function loadShareMap(): Record<string, ShareEntry> {
  return loadJSON(SHARE_MAP_KEY, {})
}
function loadPatternShare(): Record<string, string> {
  return loadJSON(PATTERN_SHARE_KEY, {})
}
function randomShareId() {
  const map = loadShareMap()
  let id = ''
  do {
    id = Array.from({ length: 5 }, () => SHARE_ALPHABET[Math.floor(Math.random() * SHARE_ALPHABET.length)]).join('')
  } while (map[id])
  shareId.value = id
}
function openShare() {
  if (!pattern.value) return
  shareErr.value = ''
  shareHint.value = ''
  const patternShare = loadPatternShare()
  const existingId = patternShare[pattern.value.id]
  const map = loadShareMap()
  if (existingId && map[existingId]) {
    // 该图纸已生成过链接：直接显示已有链接，不让用户重复生成
    shareId.value = existingId
    shareUrl.value = `${location.origin}${location.pathname}#/share/${existingId}`
    shareOk.value = true
    // 检测该链接是否已同步到服务器（决定是否跨设备有效）
    remoteGetShare(existingId).then((r) => (shareRemote.value = !!r))
  } else {
    shareOk.value = false
    shareRemote.value = false
    randomShareId()
  }
  showShare.value = true
}
function modifyShare() {
  shareOk.value = false
  shareErr.value = ''
  shareHint.value = '重新生成后，原来的链接会立即失效'
}
async function generateShare() {
  if (!pattern.value) return
  const id = shareId.value.trim()
  if (!/^[A-Za-z0-9]{5}$/.test(id)) {
    shareErr.value = '编号需为 5 位，可由大小写字母和数字组成'
    return
  }
  const map = loadShareMap()
  const patternShare = loadPatternShare()
  const oldId = patternShare[pattern.value.id]
  if (map[id] && map[id].patternKey !== pattern.value.id) {
    shareErr.value = `该链接已存在（${id}），请换一个编号`
    return
  }
  shareBusy.value = true
  // 生成新链接时让旧链接立即失效（同一张图纸只保留一个有效链接）
  if (oldId && oldId !== id) {
    await remoteDeleteShare(oldId)
    if (map[oldId]) delete map[oldId]
  }
  const entry = {
    name: pattern.value.name,
    paletteId: pattern.value.paletteId,
    rows: pattern.value.rows.map((r) => [...r]),
    tags: pattern.value.tags ?? [],
    createdAt: Date.now(),
    patternKey: pattern.value.id
  }
  map[id] = entry
  patternShare[pattern.value.id] = id
  saveJSON(SHARE_MAP_KEY, map)
  saveJSON(PATTERN_SHARE_KEY, patternShare)
  // 同步到服务器：成功则任何设备都能打开；失败则回退为仅本机浏览器
  const remoteOk = await remoteSaveShare(id, entry)
  shareRemote.value = remoteOk
  shareUrl.value = `${location.origin}${location.pathname}#/share/${id}`
  shareErr.value = ''
  shareHint.value = ''
  shareOk.value = true
  shareCopied.value = false
  shareBusy.value = false
}
async function copyShareUrl() {
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    shareCopied.value = true
    setTimeout(() => (shareCopied.value = false), 2000)
  } catch {
    prompt('请手动复制下面的链接', shareUrl.value)
  }
}
function selectShareText(e: Event) {
  ;(e.target as HTMLInputElement).select()
}

async function copyGrid() {
  if (!pattern.value) return
  const text = pattern.value.rows.join('\n')
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    alert('复制失败，请手动选择复制')
  }
}

function downloadPNG(withCodes: boolean) {
  if (!pattern.value || !palette.value) return
  const canvas = patternToCanvas(pattern.value, palette.value, {
    cellSize: 24,
    showCodes: withCodes,
    showGrid: true,
    background: '#ffffff',
    padding: 8,
    showCoords: true,
    boardSize: boardSize.value
  })
  downloadCanvas(canvas, `${safeFileName(pattern.value.name)}${withCodes ? '-色号版' : ''}.png`)
}

/** E24：透明背景 PNG（只有豆子的色块，空白格透明） */
function downloadPNGTransparent() {
  if (!pattern.value || !palette.value) return
  const canvas = patternToCanvas(pattern.value, palette.value, {
    cellSize: 24,
    showCodes: false,
    showGrid: false,
    background: null,
    padding: 8
  })
  downloadCanvas(canvas, `${safeFileName(pattern.value.name)}-透明背景.png`)
}

function exportCSV() {
  if (!pattern.value || !palette.value) return
  downloadText(
    exportUsageCSV(pattern.value, palette.value),
    `${safeFileName(pattern.value.name)}-用豆统计.csv`,
    'text/csv;charset=utf-8'
  )
}

function doPrint() {
  if (!pattern.value || !palette.value) return
  printPattern(pattern.value, palette.value, { showCodes: true, showCoords: true, boardSize: boardSize.value })
}

function printA4() {
  if (!pattern.value || !palette.value) return
  printPatternTiled(pattern.value, palette.value, { cellSize: 14, showCoords: true, boardSize: boardSize.value })
}

function downloadSheet() {
  if (!pattern.value || !palette.value) return
  const canvas = renderPatternSheet(pattern.value, palette.value, { showCoords: true, boardSize: boardSize.value })
  downloadCanvas(canvas, `${safeFileName(pattern.value.name)}-图纸+色号统计.png`)
}

function edit() {
  if (!pattern.value) return
  let target = pattern.value
  if (pattern.value.source === 'builtin') {
    // 内置图纸：先复制一份到"我的图纸"再编辑
    target = buildPatternFromRows(
      pattern.value.rows,
      pattern.value.paletteId,
      pattern.value.name,
      'edited',
      pattern.value.tags
    )
    target.description = pattern.value.description
  }
  // savePattern 会按内容去重并返回实际存储的 id，必须用返回值跳转，否则可能指向未保存的图纸
  const savedId = store.savePattern(target)
  router.push(`/editor/${savedId}`)
}

function remove() {
  if (!pattern.value || !isSaved.value) return
  if (confirm(`确定删除图纸「${pattern.value.name}」吗？`)) {
    store.deletePattern(pattern.value.id)
    router.push('/mine')
  }
}
</script>

<template>
  <div v-if="pattern && palette" class="space-y-6">
    <!-- 顶部信息 -->
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-xl font-bold text-stone-800 sm:text-2xl">{{ pattern.name }}</h1>
          <span
            class="rounded-full px-2 py-0.5 text-[11px] font-medium"
            :class="isSaved ? 'bg-sun-400/30 text-amber-700' : 'bg-brand-50 text-brand-600'"
          >
            {{ isSaved ? '我的图纸' : '内置图纸' }}
          </span>
        </div>
        <p class="mt-1 text-sm text-stone-500">{{ pattern.description || '暂无描述' }}</p>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-400">
          <span>{{ pattern.width }} × {{ pattern.height }} 格</span>
          <span>·</span>
          <span>{{ usage.length }} 种颜色</span>
          <span>·</span>
          <span>共 {{ totalBeads }} 颗豆</span>
          <span>·</span>
          <span>色卡：{{ palette.title }}</span>
          <span v-if="boardInfo" class="rounded-full bg-sky-50 px-2 py-0.5 text-sky-600">
            📦 {{ boardInfo.b }}×{{ boardInfo.b }} 板 × {{ boardInfo.total }} 块（{{ boardInfo.bx }}×{{ boardInfo.by }}）
          </span>
          <span v-for="t in pattern.tags" :key="t" class="rounded-full bg-stone-100 px-2 py-0.5 text-stone-500">
            {{ t }}
          </span>
        </div>
      </div>

      <div class="no-print flex flex-wrap gap-2">
        <button class="btn" :class="isFav ? 'btn-primary' : 'btn-secondary'" @click="store.toggleFavorite(pattern.id)">
          {{ isFav ? '♥ 已收藏' : '♡ 收藏' }}
        </button>
        <button class="btn btn-secondary" @click="copyGrid">{{ copied ? '✓ 已复制' : '⧉ 复制色号' }}</button>
        <button class="btn btn-secondary" @click="downloadPNG(false)">⬇ 下载图</button>
        <button class="btn btn-secondary" @click="downloadPNG(true)">⬇ 色号版</button>
        <button class="btn btn-secondary" @click="downloadPNGTransparent">⬇ 透明 PNG</button>
        <button class="btn btn-secondary" @click="exportCSV">⇩ CSV</button>
        <button class="btn btn-secondary" @click="downloadSheet">🖨 图纸+色号统计</button>
        <button class="btn btn-secondary" @click="doPrint">🖨 打印</button>
        <button class="btn btn-secondary" @click="printA4">🖨 A4 分区打印</button>
        <button class="btn btn-secondary" @click="openShoppingList">🛒 购物清单</button>
        <button class="btn btn-secondary" @click="downloadBoardLayout">⬇ 底板布局图</button>
        <button class="btn btn-secondary" @click="openShare">🔗 分享</button>
        <button class="btn btn-secondary" @click="showConvert = !showConvert; convertMsg = ''">
          {{ showConvert ? '✕ 关闭换色' : '🔁 换色卡' }}
        </button>
        <button class="btn btn-secondary" @click="progressMode = !progressMode">
          {{ progressMode ? '🧭 退出拼豆' : '🧭 拼豆模式' }}
        </button>
        <button class="btn btn-secondary" @click="show3d = !show3d">{{ show3d ? '✕ 关闭 3D' : '🧊 3D 预览' }}</button>
        <button class="btn btn-primary" @click="edit">✏️ 编辑</button>
        <button v-if="isSaved" class="btn btn-danger" @click="remove">🗑 删除</button>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-[1fr_320px]">
      <!-- 图纸 -->
      <section class="card min-w-0 p-4 sm:p-6">
        <div v-if="showConvert" class="no-print mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-stone-100 px-3 py-2 text-xs text-stone-600">
          <span>🔁 转换为其他品牌色卡（按颜色最近匹配，生成新图纸保存）：</span>
          <select v-model="convertPaletteId" class="input !w-56 !py-1 text-xs">
            <optgroup v-for="g in paletteGroups()" :key="g.label" :label="g.label">
              <option v-for="p in g.items" :key="p.id" :value="p.id">{{ p.title }}（{{ p.count }} 色）</option>
            </optgroup>
          </select>
          <button class="btn btn-primary !py-1 text-xs" @click="doConvert">转换并保存副本</button>
          <span v-if="convertMsg" class="text-brand-600">{{ convertMsg }}</span>
        </div>

        <div v-if="progressMode" class="no-print mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700">
          <span class="font-medium">🧭 拼豆模式：点击格子标记，按住拖动连续标记，Shift+拖拽框选一整块</span>
          <span>已完成 {{ progressDone }}/{{ progressTotal }}（{{ progressPct }}%）</span>
          <div class="h-1.5 w-40 overflow-hidden rounded-full bg-white">
            <div class="h-full rounded-full bg-green-500 transition-all" :style="{ width: progressPct + '%' }"></div>
          </div>
          <button class="ml-auto rounded-md bg-white px-2 py-1 text-[11px] font-medium ring-1 ring-green-200 hover:bg-green-100" @click="resetProgress">重置进度</button>
        </div>

        <div class="no-print mb-4 flex flex-wrap items-center gap-3">
          <label class="flex cursor-pointer items-center gap-2 text-sm text-stone-600">
            <input v-model="showCodes" type="checkbox" class="h-4 w-4 accent-brand-500" />
            显示色号
          </label>
          <label class="flex cursor-pointer items-center gap-2 text-sm text-stone-600">
            <input v-model="showGrid" type="checkbox" class="h-4 w-4 accent-brand-500" />
            显示网格
          </label>
          <label class="flex cursor-pointer items-center gap-2 text-sm text-stone-600" title="图纸自动适配屏幕宽度，避免格子过大需要来回拖动">
            <input v-model="fitWidth" type="checkbox" class="h-4 w-4 accent-brand-500" /> 适应宽度
          </label>
          <div class="ml-auto flex items-center gap-2 text-sm text-stone-500">
            <span>底板</span>
            <select v-model.number="boardSize" class="input !w-24 !py-1 text-xs">
              <option :value="29">29×29</option>
              <option :value="50">50×50</option>
              <option :value="104">104×104</option>
            </select>
            <span>格子</span>
            <input
              v-model.number="cellSize"
              type="range"
              min="10"
              max="32"
              step="1"
              :disabled="fitWidth"
              class="w-40 accent-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
              title="关闭「适应宽度」后可手动调整格子大小"
              @input="useManualCell"
            />
            <span class="w-11 text-right text-xs tabular-nums">{{ fitWidth ? fittedCell : cellSize }}px</span>
            <button v-if="!fitWidth" type="button" class="text-xs font-medium text-brand-500 hover:underline" @click="fitWidth = true">
              适应
            </button>
          </div>
        </div>

        <div ref="gridWrap" class="overflow-auto rounded-xl bg-stone-50 p-4" style="max-height: 70vh">
          <div class="inline-block">
            <PatternGrid
              :pattern="pattern"
              :palette="palette"
              :cell-size="fitWidth ? fittedCell : cellSize"
              :show-codes="showCodes"
              :grid="showGrid"
              :progress="progressMode ? progressSet : null"
              :clickable="progressMode"
              show-coords
              :board-size="boardSize"
              @cell-click="toggleCell"
              @cell-drag="dragCell"
              @cell-box="boxSelect"
            />
          </div>
        </div>
      </section>

      <!-- 用豆统计 -->
      <aside class="card min-w-0 p-4 sm:p-5">
        <h2 class="mb-3 text-sm font-semibold text-stone-700">🧮 用豆统计</h2>
        <ColorLegend :pattern="pattern" :palette="palette" />
        <p class="no-print mt-4 rounded-xl bg-brand-50 p-3 text-xs leading-5 text-brand-700">
          提示：在「豆仓」登记你拥有的豆子后，这里会自动显示每种颜色是否够用。
        </p>
      </aside>
    </div>
  </div>

  <div v-else class="card p-10 text-center">
    <p class="text-lg font-medium text-stone-600">图纸不存在或已删除</p>
    <router-link to="/" class="btn btn-primary mt-4">返回图纸库</router-link>


  </div>
  <!-- BOM 购物清单弹窗 -->
  <div v-if="showBom && pattern && palette" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
    <div class="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-5 shadow-xl">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-base font-semibold text-stone-800">🛒 购物清单 / BOM · {{ pattern.name }}</h3>
        <button class="rounded-lg px-2 py-1 text-stone-400 hover:bg-stone-100" @click="showBom = false">✕</button>
      </div>
      <p class="mt-1 text-xs text-stone-400">{{ pattern.width }}×{{ pattern.height }} 格 · 色卡 {{ palette.title }} · 共 {{ totalBeads }} 颗豆</p>

      <div class="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
        <label class="flex items-center gap-1.5">
          单价（元/颗）
          <input v-model.number="beadPrice" type="number" min="0" step="0.001" class="input !w-24 !py-1 text-right" />
        </label>
        <span class="ml-auto">需购合计 <b class="text-red-500">{{ bomTotalNeed }}</b> 颗 · 预估费用 <b class="text-red-500">¥{{ bomTotalCost.toFixed(2) }}</b></span>
      </div>

      <div class="mt-3 overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-stone-200 text-left text-stone-400">
              <th class="py-1.5 pr-2">颜色</th>
              <th class="py-1.5 pr-2">色号</th>
              <th class="py-1.5 pr-2 text-right">需要</th>
              <th class="py-1.5 pr-2 text-right">占比</th>
              <th class="py-1.5 pr-2 text-right">已有</th>
              <th class="py-1.5 pr-2 text-right">需购</th>
              <th class="py-1.5">状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in bomItems" :key="i.code" class="border-b border-stone-100">
              <td class="py-1.5 pr-2"><span class="inline-block h-5 w-5 rounded ring-1 ring-stone-200" :style="{ background: i.hex }"></span></td>
              <td class="py-1.5 pr-2 font-mono font-semibold text-stone-700">{{ i.code }}</td>
              <td class="py-1.5 pr-2 text-right">{{ i.count }}</td>
              <td class="py-1.5 pr-2 text-right text-stone-400">{{ i.pct }}%</td>
              <td class="py-1.5 pr-2 text-right">{{ i.owned }}</td>
              <td class="py-1.5 pr-2 text-right font-semibold text-stone-700">{{ i.need }}</td>
              <td class="py-1.5">
                <span v-if="i.status === 'enough'" class="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-600">充足</span>
                <span v-else-if="i.status === 'short'" class="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600">部分缺</span>
                <span v-else class="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-500">需购</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        <button class="btn btn-primary" @click="printBom">🖨 打印 / 存 PDF</button>
        <button class="btn btn-secondary" @click="exportBomCsv">⇩ 导出 CSV</button>
        <button class="btn btn-secondary" @click="showBom = false">关闭</button>
      </div>
    </div>
  </div>

  <!-- 分享链接弹窗 -->
  <div v-if="showShare && pattern" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
    <div class="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-base font-semibold text-stone-800">🔗 分享图纸 · {{ pattern.name }}</h3>
        <button class="rounded-lg px-2 py-1 text-stone-400 hover:bg-stone-100" @click="showShare = false">✕</button>
      </div>
      <p class="mt-1 text-xs leading-5 text-stone-500">生成一个短链接发给别人，对方打开即可查看并下载。编号为 5 位，可由大小写字母和数字组成。</p>
      <div v-if="!shareOk" class="mt-3 flex flex-wrap items-center gap-2">
        <div class="flex flex-1 items-center overflow-hidden rounded-xl ring-1 ring-stone-200 focus-within:ring-2 focus-within:ring-brand-400">
          <span class="shrink-0 pl-3 text-xs text-stone-400">#/share/</span>
          <input
            v-model="shareId"
            class="w-full min-w-0 border-0 bg-transparent px-1 py-2 font-mono text-sm text-stone-800 outline-none placeholder:text-stone-300"
            maxlength="5"
            placeholder="编号"
            @keydown.enter="generateShare"
          />
        </div>
        <button class="btn btn-secondary !py-2 text-xs" @click="randomShareId">🎲 随机</button>
        <button class="btn btn-primary !py-2 text-xs" :disabled="shareBusy" @click="generateShare">{{ shareBusy ? '同步中…' : '生成链接' }}</button>
      </div>
      <p v-if="shareErr" class="mt-2 text-xs text-red-500">{{ shareErr }}</p>
      <p v-if="shareHint" class="mt-2 text-xs text-amber-600">{{ shareHint }}</p>
      <template v-if="shareOk">
        <input readonly :value="shareUrl" class="input mt-3 w-full !py-2 font-mono text-xs" @focus="selectShareText" />
        <p
          class="mt-2 rounded-lg px-2.5 py-1.5 text-xs"
          :class="shareRemote ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'"
        >
          {{ shareRemote ? '🌐 已同步到服务器：任何设备打开此链接都能查看并下载' : '⚠ 后端未启动：链接仅在本机浏览器有效（运行 npm run server 后重新生成即可跨设备）' }}
        </p>
      </template>
      <div class="mt-4 flex flex-wrap gap-2">
        <button v-if="shareOk" class="btn btn-primary" @click="copyShareUrl">{{ shareCopied ? '✓ 已复制' : '复制链接' }}</button>
        <button v-if="shareOk" class="btn btn-secondary" @click="modifyShare">✎ 修改编号</button>
        <button class="btn btn-secondary" @click="showShare = false">关闭</button>
      </div>
    </div>
  </div>

  <!-- 3D 预览弹窗 -->
  <div v-if="show3d && pattern && palette" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
    <div class="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-base font-semibold text-stone-800">🧊 3D 预览 · {{ pattern.name }}</h3>
        <button class="rounded-lg px-2 py-1 text-stone-400 hover:bg-stone-100" @click="show3d = false">✕</button>
      </div>
      <Bead3DPreview :pattern="pattern" :palette="palette" />
    </div>
  </div>
</template>