<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import type { Pattern } from '../types'
import { getPalette } from '../data/palettes'
import { useStore } from '../composables/useStore'
import { buildPatternFromRows } from '../utils/quantize'
import { contrastText } from '../utils/color'

const route = useRoute()
const router = useRouter()
const store = useStore()

const working = ref<Pattern | null>(null)
const saved = ref(false)
const cellSize = ref(24)
const showCodes = ref(true)
const showCoords = ref(false)
const boardSize = ref(29)
const tool = ref<'brush' | 'eraser' | 'pipette' | 'fill' | 'select'>('brush')
const selectedColor = ref('')
const painting = ref(false)
const gridRef = ref<HTMLElement | null>(null)
const originalRows = ref<string[][] | null>(null)
const unsavedModal = ref(false)
let pendingLeave: string | null = null
let allowLeave = false

// 对称绘制：笔刷/橡皮镜像到对称位置
const symH = ref(false)
const symV = ref(false)
// 放大镜
const magnifier = ref(false)
const hoverCell = ref<{ x: number; y: number } | null>(null)
const hoverPos = ref({ x: 0, y: 0 })
// 框选 / 复制 / 剪切 / 粘贴
const selection = ref<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
const selecting = ref(false)
const clip = ref<{ rows: string[][]; w: number; h: number } | null>(null)
const selMsg = ref('')

// 撤销 / 重做历史栈（每步保存 rows 快照）
const history = ref<string[][][]>([])
const historyIndex = ref(-1)
const MAX_HISTORY = 60
const canUndo = computed(() => historyIndex.value > 0)
const canRedo = computed(() => historyIndex.value < history.value.length - 1)

function pushHistory() {
  if (!working.value) return
  history.value = history.value.slice(0, historyIndex.value + 1)
  history.value.push(working.value.rows.map((r) => [...r]))
  if (history.value.length > MAX_HISTORY) history.value.shift()
  historyIndex.value = history.value.length - 1
}
function restore() {
  if (!working.value || historyIndex.value < 0) return
  working.value.rows = history.value[historyIndex.value].map((r) => [...r])
  saved.value = false
}
function undo() {
  if (!canUndo.value) return
  historyIndex.value--
  restore()
}
function redo() {
  if (!canRedo.value) return
  historyIndex.value++
  restore()
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    clearSelection()
    return
  }
  if (!(e.ctrlKey || e.metaKey)) return
  const k = e.key.toLowerCase()
  if (k === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
  } else if (k === 'y') {
    e.preventDefault()
    redo()
  } else if (k === 'c') {
    e.preventDefault()
    copySelection()
  } else if (k === 'x') {
    e.preventDefault()
    cutSelection()
  } else if (k === 'v') {
    e.preventDefault()
    pasteSelection()
  }
}

const palette = computed(() => (working.value ? getPalette(working.value.paletteId) : undefined))
const colorMap = computed(() => new Map(palette.value?.colors.map((c) => [c.code, c]) ?? []))

const usedColors = computed(() => {
  if (!working.value) return []
  const set = new Set<string>()
  for (const row of working.value.rows) for (const ch of row) if (ch !== '.') set.add(ch)
  return [...set]
})

const gridStyle = computed(() =>
  working.value ? { gridTemplateColumns: `repeat(${working.value.width}, ${cellSize.value}px)` } : {}
)

// 坐标/参考线：每 5 格浅红细线，每 boardSize 格深红粗线（对齐详情页底板分割线风格）
function cellFrameStyle(x: number, y: number): string {
  const shadows = ['inset 0 0 0 0.5px rgba(0,0,0,0.12)']
  if (showCoords.value) {
    if (x > 0 && x % 5 === 0) shadows.push('inset 0.5px 0 0 rgba(224,36,36,0.55)')
    if (y > 0 && y % 5 === 0) shadows.push('inset 0 0.5px 0 rgba(224,36,36,0.55)')
    if (x > 0 && x % boardSize.value === 0) shadows.push('inset 1.5px 0 0 rgba(224,36,36,0.85)')
    if (y > 0 && y % boardSize.value === 0) shadows.push('inset 0 1.5px 0 rgba(224,36,36,0.85)')
  }
  return shadows.join(', ')
}

const tooBig = computed(() => (working.value ? working.value.width * working.value.height > 9000 : false))
const hasChanges = computed(() => {
  if (!working.value || !originalRows.value) return false
  return JSON.stringify(working.value.rows) !== JSON.stringify(originalRows.value)
})

onMounted(() => {
  const id = String(route.params.id)
  const src = store.getPattern(id)
  if (!src) return
  if (src.source === 'builtin') {
    // 内置图纸：复用已存在的副本，避免重复创建
    const copyName = src.name + '（我的副本）'
    const existing = store.state.savedPatterns.find(
      (p) => p.source === 'edited' && p.name === copyName && p.paletteId === src.paletteId
    )
    if (existing) {
      working.value = { ...existing, rows: existing.rows.map((r) => r) }
    } else {
      working.value = buildPatternFromRows(src.rows, src.paletteId, copyName, 'edited', src.tags)
      working.value.description = src.description
      store.savePattern(working.value)
    }
  } else {
    working.value = {
      ...src,
      rows: src.rows.map((r) => [...r]),
      source: 'edited'
    }
  }
  if (!selectedColor.value && usedColors.value.length) selectedColor.value = usedColors.value[0]
  originalRows.value = working.value.rows.map((r) => [...r])
  pushHistory() // 记录初始状态，保证第一步操作也能撤销
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
})

function endStroke() {
  if (selecting.value && tool.value === 'select') {
    selecting.value = false
    return
  }
  if (painting.value && (tool.value === 'brush' || tool.value === 'eraser')) pushHistory()
  painting.value = false
  lastCellX = -1
  lastCellY = -1
}
function writeCell(x: number, y: number, value: string) {
  if (!working.value) return
  const arr = working.value.rows[y]
  if (!arr || x < 0 || x >= arr.length) return
  arr[x] = value
}
function mirrorPts(x: number, y: number): Array<[number, number]> {
  if (!working.value) return [[x, y]]
  const w = working.value.width
  const h = working.value.height
  const pts: Array<[number, number]> = [[x, y]]
  if (symH.value) pts.push([w - 1 - x, y])
  if (symV.value) pts.push([x, h - 1 - y])
  if (symH.value && symV.value) pts.push([w - 1 - x, h - 1 - y])
  return pts
}
function paintCell(x: number, y: number) {
  if (!working.value) return
  const arr = working.value.rows[y] ?? []
  if (tool.value === 'pipette') {
    const code = arr[x]
    if (code && code !== '.') {
      selectedColor.value = code
      tool.value = 'brush'
    }
    return
  }
  if (tool.value === 'brush' || tool.value === 'eraser') {
    const value = tool.value === 'eraser' ? '.' : selectedColor.value
    if (tool.value === 'brush' && !value) return
    for (const [mx, my] of mirrorPts(x, y)) writeCell(mx, my, value)
  }
}

// 泛洪填充（油漆桶）：把与点击格同色的连通区域整体换成当前颜色
function floodFill(x: number, y: number) {
  if (!working.value || !selectedColor.value) return
  const rows = working.value.rows
  const w = working.value.width
  const h = working.value.height
  if (x < 0 || y < 0 || x >= w || y >= h) return
  const target = rows[y]?.[x] ?? '.'
  const replace = selectedColor.value
  if (target === replace) return
  pushHistory()
  const stack: Array<[number, number]> = [[x, y]]
  while (stack.length) {
    const [cx, cy] = stack.pop()!
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue
    const cur = rows[cy]?.[cx] ?? '.'
    if (cur !== target) continue
    rows[cy][cx] = replace
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
  }
  saved.value = false
}

// 全局颜色替换：把整张图纸里的某个色号全部换成另一个色号
const replaceFrom = ref('')
const replaceTo = ref('')
const replaceMsg = ref('')
function globalReplace() {
  if (!working.value || !replaceFrom.value || !replaceTo.value) return
  if (replaceFrom.value === replaceTo.value) {
    replaceMsg.value = '源色号与目标色号相同'
    setTimeout(() => (replaceMsg.value = ''), 2000)
    return
  }
  pushHistory()
  let n = 0
  for (const row of working.value.rows) {
    for (let i = 0; i < row.length; i++) {
      if (row[i] === replaceFrom.value) {
        row[i] = replaceTo.value
        n++
      }
    }
  }
  saved.value = false
  replaceMsg.value = `已替换 ${n} 颗豆`
  setTimeout(() => (replaceMsg.value = ''), 2500)
}

// ---------- 框选 / 复制 / 剪切 / 粘贴 ----------
function selBounds(): { x: number; y: number; w: number; h: number } | null {
  if (!selection.value) return null
  const { x0, y0, x1, y1 } = selection.value
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 }
}
const hasSelection = computed(() => !!selection.value)
function isInSelection(x: number, y: number): boolean {
  const b = selBounds()
  if (!b) return false
  return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h
}
function clearSelection() {
  selection.value = null
  selecting.value = false
}
function copySelection() {
  const b = selBounds()
  if (!b || !working.value) return
  const rows: string[][] = []
  for (let y = b.y; y < b.y + b.h; y++) {
    const row = working.value.rows[y] ?? []
    rows.push(Array.from({ length: b.w }, (_, i) => row[b.x + i] ?? '.'))
  }
  clip.value = { rows, w: b.w, h: b.h }
  selMsg.value = `已复制 ${b.w}×${b.h} 区域`
  setTimeout(() => (selMsg.value = ''), 2000)
}
function deleteSelection() {
  const b = selBounds()
  if (!b || !working.value) return
  pushHistory()
  for (let y = b.y; y < b.y + b.h; y++) {
    const row = working.value.rows[y]
    if (!row) continue
    for (let x = b.x; x < b.x + b.w; x++) if (x < row.length) row[x] = '.'
  }
  saved.value = false
}
function cutSelection() {
  copySelection()
  deleteSelection()
}
function pasteSelection() {
  if (!clip.value || !working.value) return
  pushHistory()
  const b = selBounds()
  const ox = b ? b.x : 0
  const oy = b ? b.y : 0
  for (let j = 0; j < clip.value.h; j++) {
    const row = working.value.rows[oy + j]
    if (!row) continue
    for (let i = 0; i < clip.value.w; i++) {
      const tx = ox + i
      if (tx < row.length) row[tx] = clip.value.rows[j][i]
    }
  }
  saved.value = false
  selMsg.value = `已粘贴 ${clip.value.w}×${clip.value.h}`
  setTimeout(() => (selMsg.value = ''), 2000)
}

// ---------- 放大镜 ----------
const magnifyCells = computed(() => {
  const out: { code: string; hex: string }[][] = []
  if (!working.value || !hoverCell.value) return out
  const w = working.value.width
  const h = working.value.height
  const cx = hoverCell.value.x
  const cy = hoverCell.value.y
  for (let dy = -3; dy <= 3; dy++) {
    const row: { code: string; hex: string }[] = []
    for (let dx = -3; dx <= 3; dx++) {
      const x = cx + dx
      const y = cy + dy
      const code = x >= 0 && y >= 0 && x < w && y < h ? working.value.rows[y]?.[x] ?? '.' : ''
      row.push({ code: code || '.', hex: colorMap.value.get(code)?.hex ?? 'rgba(0,0,0,0.06)' })
    }
    out.push(row)
  }
  return out
})

function cellBoxShadow(x: number, y: number): string {
  const parts = [cellFrameStyle(x, y)]
  if (isInSelection(x, y)) parts.push('inset 0 0 0 2px rgba(59,130,246,0.85)')
  return parts.join(', ')
}

let lastCellX = -1
let lastCellY = -1

function paintLine(x0: number, y0: number, x1: number, y1: number) {
  if (!working.value) return
  const w = working.value.width
  const h = working.value.height
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let x = x0
  let y = y0
  for (;;) {
    if (x >= 0 && y >= 0 && x < w && y < h) paintCell(x, y)
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x += sx }
    if (e2 < dx) { err += dx; y += sy }
  }
}

function onPointerDown(e: PointerEvent) {
  const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')
  if (!cell) return
  const x = Number(cell.dataset.x)
  const y = Number(cell.dataset.y)
  if (tool.value === 'fill') {
    floodFill(x, y)
    return
  }
  if (tool.value === 'select') {
    selection.value = { x0: x, y0: y, x1: x, y1: y }
    selecting.value = true
    try {
      gridRef.value?.setPointerCapture?.(e.pointerId)
    } catch {
      /* ignore */
    }
    return
  }
  painting.value = true
  try {
    gridRef.value?.setPointerCapture?.(e.pointerId)
  } catch {
    /* ignore */
  }
  lastCellX = x
  lastCellY = y
  paintCell(x, y)
}

function onPointerMove(e: PointerEvent) {
  const g = gridRef.value
  if (!g || !working.value) return
  const rect = g.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const x = Math.floor((e.clientX - rect.left) / cellSize.value)
  const y = Math.floor((e.clientY - rect.top) / cellSize.value)
  if (x < 0 || y < 0 || x >= working.value.width || y >= working.value.height) return
  if (magnifier.value) {
    hoverCell.value = { x, y }
    hoverPos.value = { x: e.clientX, y: e.clientY }
  }
  if (selecting.value && selection.value) {
    selection.value = { ...selection.value, x1: x, y1: y }
    return
  }
  if (!painting.value) return
  if (x === lastCellX && y === lastCellY) return
  if (lastCellX >= 0 && lastCellY >= 0) paintLine(lastCellX, lastCellY, x, y)
  else paintCell(x, y)
  lastCellX = x
  lastCellY = y
}

function doSaveLeave() {
  save()
  allowLeave = true
  const target = pendingLeave
  pendingLeave = null
  unsavedModal.value = false
  if (target) router.push(target)
}

function doDiscardLeave() {
  allowLeave = true
  const target = pendingLeave
  pendingLeave = null
  unsavedModal.value = false
  if (target) router.push(target)
}

function cancelLeave() {
  unsavedModal.value = false
  pendingLeave = null
}

onBeforeRouteLeave((to) => {
  if (allowLeave) {
    allowLeave = false
    return true
  }
  if (!hasChanges.value) return true
  pendingLeave = to.fullPath
  unsavedModal.value = true
  return false
})

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (hasChanges.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}
window.addEventListener('beforeunload', onBeforeUnload)

function rotate() {
  if (!working.value) return
  pushHistory()
  const h = working.value.height
  const w = working.value.width
  const out: string[][] = Array.from({ length: w }, () => Array(h).fill('.'))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[x][h - 1 - y] = (working.value.rows[y] ?? [])[x] ?? '.'
    }
  }
  working.value.rows = out
  working.value.width = w
  working.value.height = h
  saved.value = false
}

function flipH() {
  if (!working.value) return
  pushHistory()
  working.value.rows = working.value.rows.map((r) => [...r].reverse())
  saved.value = false
}

function clearAll() {
  if (!working.value) return
  if (confirm('确定清空整张图纸吗？')) {
    pushHistory()
    working.value.rows = working.value.rows.map((r) => r.map(() => '.'))
    saved.value = false
  }
}

function save() {
  if (!working.value) return
  store.savePattern(working.value)
  originalRows.value = working.value.rows.map((r) => [...r])
  saved.value = true
  setTimeout(() => (saved.value = false), 1500)
}
function exitEditor() {
  // 有未保存修改时 onBeforeRouteLeave 会弹窗确认；默认返回上一页，无历史则回图纸详情
  if (window.history.length > 1) router.back()
  else if (working.value?.id) router.push('/pattern/' + working.value.id)
  else router.push('/')
}
</script>
<template>
  <div v-if="working && palette" class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-stone-800">✏️ 编辑图纸</h1>
        <p class="mt-1 text-sm text-stone-500">{{ working.name }} · {{ working.width }}×{{ working.height }} 格 · {{ palette.title }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-secondary" title="退出编辑" @click="exitEditor">← 退出</button>
        <button class="btn btn-secondary" :disabled="!canUndo" @click="undo">⟲ 撤销</button>
        <button class="btn btn-secondary" :disabled="!canRedo" @click="redo">⟳ 重做</button>
        <button class="btn btn-secondary" @click="rotate">⟳ 旋转90°</button>
        <button class="btn btn-secondary" @click="flipH">⇋ 左右翻转</button>
        <button class="btn btn-secondary" @click="clearAll">🧹 清空</button>
        <button class="btn btn-primary" @click="save">{{ saved ? '✓ 已保存' : '💾 保存' }}</button>
      </div>
    </div>

    <div class="grid gap-5 lg:grid-cols-[260px_1fr]">
      <aside class="card h-fit space-y-4 p-4">
        <div>
          <label class="mb-1.5 block text-xs font-medium text-stone-500">工具</label>
          <div class="grid grid-cols-5 gap-1.5">
            <button
              class="rounded-lg px-2 py-2 text-xs font-medium ring-1 transition"
              :class="tool === 'brush' ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200'"
              @click="tool = 'brush'"
            >
              🖌 画笔
            </button>
            <button
              class="rounded-lg px-2 py-2 text-xs font-medium ring-1 transition"
              :class="tool === 'eraser' ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200'"
              @click="tool = 'eraser'"
            >
              ◻ 橡皮
            </button>
            <button
              class="rounded-lg px-2 py-2 text-xs font-medium ring-1 transition"
              :class="tool === 'pipette' ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200'"
              @click="tool = 'pipette'"
            >
              💉 吸管
            </button>
            <button
              class="rounded-lg px-2 py-2 text-xs font-medium ring-1 transition"
              :class="tool === 'fill' ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200'"
              @click="tool = 'fill'"
            >
              🪣 填充
            </button>
            <button
              class="rounded-lg px-2 py-2 text-xs font-medium ring-1 transition"
              :class="tool === 'select' ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200'"
              @click="tool = 'select'"
            >
              ▦ 框选
            </button>
          </div>
        </div>

        <div>
          <label class="mb-1.5 block text-xs font-medium text-stone-500">当前颜色：{{ selectedColor || '未选择' }}</label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="c in usedColors"
              :key="c"
              class="h-7 w-7 rounded-lg ring-1 ring-stone-200 transition"
              :class="selectedColor === c ? 'ring-2 ring-brand-500' : ''"
              :style="{ background: colorMap.get(c)?.hex ?? '#ccc' }"
              :title="c"
              @click="selectedColor = c; tool = 'brush'"
            ></button>
          </div>
        </div>

        <div>
          <label class="mb-1.5 block text-xs font-medium text-stone-500">选择其他色号</label>
          <select v-model="selectedColor" class="input !py-1.5" @change="tool = 'brush'">
            <option v-for="c in palette.colors" :key="c.code" :value="c.code">{{ c.code }} · {{ c.hex }}</option>
          </select>
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-medium text-stone-500">全局替换颜色（整张图纸）</label>
          <div class="flex items-center gap-1.5">
            <select v-model="replaceFrom" class="input !min-w-0 !flex-1 !px-1.5 !py-1 text-xs">
              <option value="" disabled>源色号</option>
              <option v-for="c in usedColors" :key="'rf' + c" :value="c">{{ c }}</option>
            </select>
            <span class="shrink-0 text-stone-400">→</span>
            <select v-model="replaceTo" class="input !min-w-0 !flex-1 !px-1.5 !py-1 text-xs">
              <option value="" disabled>目标色号</option>
              <option v-for="c in palette.colors" :key="'rt' + c.code" :value="c.code">{{ c.code }}</option>
            </select>
            <button class="btn btn-secondary shrink-0 !px-2 !py-1 text-xs" @click="globalReplace">替换</button>
          </div>
          <p v-if="replaceMsg" class="mt-1 text-[11px] text-brand-600">{{ replaceMsg }}</p>
        </div>

        <div class="space-y-2 text-xs text-stone-500">
          <label class="flex cursor-pointer items-center gap-2">
            <input v-model="showCodes" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" /> 显示色号
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input v-model="showCoords" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" /> 坐标/参考线
          </label>
          <div class="flex gap-3">
            <label class="flex cursor-pointer items-center gap-1.5">
              <input v-model="symH" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" /> 左右对称
            </label>
            <label class="flex cursor-pointer items-center gap-1.5">
              <input v-model="symV" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" /> 上下对称
            </label>
          </div>
          <p v-if="symH || symV" class="text-[11px] leading-4 text-stone-400">开启后笔刷/橡皮会同时画到对称位置（中心对称=左右+上下同时开）。</p>
          <label class="flex cursor-pointer items-center gap-2">
            <input v-model="magnifier" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" /> 放大镜（悬停查看局部）
          </label>
          <label v-if="showCoords" class="flex items-center gap-2">
            <span>底板</span>
            <select v-model.number="boardSize" class="input !w-20 !py-0.5 text-xs">
              <option :value="29">29×29</option>
              <option :value="50">50×50</option>
              <option :value="104">104×104</option>
            </select>
          </label>
          <label class="flex items-center gap-2">
            <span>格子大小</span>
            <input v-model.number="cellSize" type="range" min="12" max="40" class="w-28 accent-brand-500" />
          </label>
        </div>
      </aside>

      <section class="card p-4">
        <div
          v-if="hasSelection"
          class="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700"
        >
          <span class="font-medium">框选：{{ selBounds()?.w }}×{{ selBounds()?.h }} 格</span>
          <span v-if="selMsg" class="text-blue-500">{{ selMsg }}</span>
          <div class="ml-auto flex flex-wrap gap-1.5">
            <button class="rounded-md bg-white px-2 py-1 font-medium ring-1 ring-blue-200 hover:bg-blue-100" @click="copySelection">⧉ 复制</button>
            <button class="rounded-md bg-white px-2 py-1 font-medium ring-1 ring-blue-200 hover:bg-blue-100" @click="cutSelection">✂ 剪切</button>
            <button class="rounded-md bg-white px-2 py-1 font-medium ring-1 ring-blue-200 hover:bg-blue-100" :disabled="!clip" @click="pasteSelection">📋 粘贴</button>
            <button class="rounded-md bg-white px-2 py-1 font-medium ring-1 ring-blue-200 hover:bg-blue-100" @click="deleteSelection">🗑 删除</button>
            <button class="rounded-md bg-white px-2 py-1 font-medium ring-1 ring-blue-200 hover:bg-blue-100" @click="clearSelection">✕ 清除</button>
          </div>
        </div>
        <div v-if="tooBig" class="rounded-xl bg-amber-50 p-6 text-center text-sm text-amber-700">
          这张图纸有 {{ working.width }} × {{ working.height }} = {{ working.width * working.height }} 格，超过编辑器建议上限（9000 格）。
          <br />请到「图片转图纸」用更小的宽度重新生成，或在详情页直接下载使用。
          <router-link :to="`/pattern/${working.id}`" class="mt-3 block font-medium text-amber-700 underline">返回详情页</router-link>
        </div>
        <div
          v-else
          class="select-none overflow-auto rounded-xl bg-stone-50 p-4"
          style="max-height: 72vh; touch-action: manipulation; -webkit-tap-highlight-color: transparent;"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="endStroke"
          @pointercancel="endStroke"
          @pointerleave="endStroke"
          @contextmenu.prevent
        >
          <div class="inline-block align-top">
            <!-- 顶部坐标数字 -->
            <div v-if="showCoords" class="flex">
              <div :style="{ width: cellSize + 'px', height: cellSize + 'px' }"></div>
              <div
                v-for="x in working.width"
                :key="'cx' + x"
                class="grid shrink-0 place-items-center text-stone-400"
                :style="{ width: cellSize + 'px', height: cellSize + 'px', fontSize: Math.max(6, cellSize * 0.34) + 'px' }"
              >{{ x }}</div>
            </div>
            <div class="flex">
              <!-- 左侧坐标数字 -->
              <div v-if="showCoords" class="flex flex-col">
                <div
                  v-for="y in working.height"
                  :key="'cy' + y"
                  class="grid shrink-0 place-items-center text-stone-400"
                  :style="{ width: cellSize + 'px', height: cellSize + 'px', fontSize: Math.max(6, cellSize * 0.34) + 'px' }"
                >{{ y }}</div>
              </div>
              <div ref="gridRef" class="inline-grid touch-none" :style="gridStyle">
                <div
                  v-for="(_, idx) in working.width * working.height"
                  :key="idx"
                  data-cell
                  :data-x="idx % working.width"
                  :data-y="Math.floor(idx / working.width)"
                  class="grid-cell"
                  :style="{
                    width: cellSize + 'px',
                    height: cellSize + 'px',
                    background: (() => { const code = working.rows[Math.floor(idx / working.width)]?.[idx % working.width]; return code && code !== '.' ? (colorMap.get(code)?.hex ?? '#fff') : 'rgba(0,0,0,0.04)' })(),
                    boxShadow: cellBoxShadow(idx % working.width, Math.floor(idx / working.width))
                  }"
                >
                  <span
                    v-if="showCodes"
                    :style="{ fontSize: Math.max(6, cellSize * 0.32) + 'px' }"
                  >
                    {{ (() => { const code = working.rows[Math.floor(idx / working.width)]?.[idx % working.width]; return code && code !== '.' ? code : '' })() }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <!-- 放大镜浮层 -->
        <div
          v-if="magnifier && hoverCell"
          class="pointer-events-none fixed z-50 rounded-xl bg-white p-1.5 shadow-xl ring-1 ring-stone-200"
          :style="{ left: (hoverPos.x + 16) + 'px', top: (hoverPos.y + 16) + 'px' }"
        >
          <div class="mb-1 px-1 text-[10px] font-medium text-stone-400">行 {{ hoverCell.y + 1 }} · 列 {{ hoverCell.x + 1 }}</div>
          <div class="grid" :style="{ gridTemplateColumns: 'repeat(7, 18px)' }">
            <template v-for="(row, dy) in magnifyCells" :key="'mr' + dy">
              <div
                v-for="(c, dx) in row"
                :key="'mc' + dy + '-' + dx"
                class="grid h-[18px] w-[18px] place-items-center text-[8px] font-bold"
                :style="{ background: c.hex, color: c.code !== '.' ? contrastText(c.hex) : '#c9c9c9' }"
              >{{ c.code === '.' ? '' : c.code }}</div>
            </template>
          </div>
        </div>

        <p class="mt-2 text-xs text-stone-400">按住鼠标在格子上拖动可以连续涂色；油漆桶点击填充连通区域；编辑内容需要点击「保存」才会生效。</p>
      </section>
    </div>
  </div>

  <div v-else class="card p-10 text-center">
    <p class="text-lg font-medium text-stone-600">图纸不存在</p>
    <router-link to="/" class="btn btn-primary mt-4">返回图纸库</router-link>
  </div>
  <!-- unsaved changes modal -->
  <div v-if="unsavedModal" class="fixed inset-0 z-50 grid place-items-center bg-black/40">
    <div class="w-[340px] rounded-2xl bg-white p-5 shadow-xl">
      <h3 class="text-base font-semibold text-stone-800">有未保存的修改</h3>
      <p class="mt-1.5 text-sm leading-5 text-stone-500">当前图纸有改动还没保存，要保存后再离开吗？</p>
      <div class="mt-5 flex flex-col gap-2">
        <button class="btn btn-primary" @click="doSaveLeave">保存并离开</button>
        <button class="btn btn-secondary" @click="doDiscardLeave">不保存，直接离开</button>
        <button class="rounded-lg px-3 py-2 text-sm font-medium text-stone-500 hover:bg-stone-100" @click="cancelLeave">取消</button>
      </div>
    </div>
  </div>
</template>