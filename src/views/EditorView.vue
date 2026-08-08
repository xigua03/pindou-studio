<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Pattern } from '../types'
import { getPalette } from '../data/palettes'
import { useStore } from '../composables/useStore'
import { buildPatternFromRows } from '../utils/quantize'

const route = useRoute()
const router = useRouter()
const store = useStore()

const working = ref<Pattern | null>(null)
const saved = ref(false)
const cellSize = ref(24)
const showCodes = ref(true)
const tool = ref<'brush' | 'eraser' | 'pipette'>('brush')
const selectedColor = ref('')
const painting = ref(false)

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
  if (!(e.ctrlKey || e.metaKey)) return
  const k = e.key.toLowerCase()
  if (k === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
  } else if (k === 'y') {
    e.preventDefault()
    redo()
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

const tooBig = computed(() => (working.value ? working.value.width * working.value.height > 9000 : false))

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
  pushHistory() // 记录初始状态，保证第一步操作也能撤销
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

function endStroke() {
  if (painting.value && (tool.value === 'brush' || tool.value === 'eraser')) pushHistory()
  painting.value = false
}
function paintCell(x: number, y: number) {
  if (!working.value) return
  const arr = working.value.rows[y] ?? []
  if (tool.value === 'eraser') arr[x] = '.'
  else if (tool.value === 'pipette') {
    const code = arr[x]
    if (code && code !== '.') {
      selectedColor.value = code
      tool.value = 'brush'
    }
    return
  } else {
    if (!selectedColor.value) return
    arr[x] = selectedColor.value
  }
}

function onPointerDown(e: PointerEvent) {
  const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')
  if (!cell) return
  painting.value = true
  try {
    cell.setPointerCapture?.(e.pointerId)
  } catch {
    /* ignore */
  }
  const x = Number(cell.dataset.x)
  const y = Number(cell.dataset.y)
  paintCell(x, y)
}

function onPointerEnter(e: PointerEvent) {
  if (!painting.value) return
  const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')
  if (!cell) return
  paintCell(Number(cell.dataset.x), Number(cell.dataset.y))
}

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
  saved.value = true
  setTimeout(() => (saved.value = false), 1500)
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
          <div class="grid grid-cols-3 gap-1.5">
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

        <div class="space-y-2 text-xs text-stone-500">
          <label class="flex cursor-pointer items-center gap-2">
            <input v-model="showCodes" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" /> 显示色号
          </label>
          <label class="flex items-center gap-2">
            <span>格子大小</span>
            <input v-model.number="cellSize" type="range" min="12" max="40" class="w-28 accent-brand-500" />
          </label>
        </div>
      </aside>

      <section class="card p-4">
        <div v-if="tooBig" class="rounded-xl bg-amber-50 p-6 text-center text-sm text-amber-700">
          这张图纸有 {{ working.width }} × {{ working.height }} = {{ working.width * working.height }} 格，超过编辑器建议上限（9000 格）。
          <br />请到「图片转图纸」用更小的宽度重新生成，或在详情页直接下载使用。
          <router-link :to="`/pattern/${working.id}`" class="mt-3 block font-medium text-amber-700 underline">返回详情页</router-link>
        </div>
        <div
          v-else
          class="select-none overflow-auto rounded-xl bg-stone-50 p-4"
          style="max-height: 72vh"
          @pointerdown="onPointerDown"
          @pointerenter="onPointerEnter"
          @pointerup="endStroke"
          @pointerleave="endStroke"
        >
          <div class="inline-grid touch-none" :style="gridStyle">
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
                boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.12)'
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
        <p class="mt-2 text-xs text-stone-400">按住鼠标在格子上拖动可以连续涂色；编辑内容需要点击「保存」才会生效。</p>
      </section>
    </div>
  </div>

  <div v-else class="card p-10 text-center">
    <p class="text-lg font-medium text-stone-600">图纸不存在</p>
    <router-link to="/" class="btn btn-primary mt-4">返回图纸库</router-link>
  </div>
</template>

<style scoped>
.grid-cell {
  display: grid;
  place-items: center;
  color: rgba(0, 0, 0, 0.65);
  font-family: ui-monospace, monospace;
  font-weight: 600;
  cursor: crosshair;
  user-select: none;
}
</style>
