<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { Pattern } from '../types'
import { getPalette } from '../data/palettes'
import PatternGrid from '../components/PatternGrid.vue'
import ColorLegend from '../components/ColorLegend.vue'
import {
  computeColorUsage,
  patternToCanvas,
  renderPatternSheet,
  downloadCanvas,
  exportUsageCSV,
  downloadText,
  safeFileName
} from '../utils/export'
import { decompressFromEncodedURIComponent } from 'lz-string'
import { loadJSON } from '../utils/storage'
import { remoteGetShare } from '../utils/shareApi'

const route = useRoute()

interface ShareEntry {
  name?: string
  paletteId?: string
  rows?: string[][]
  tags?: string[]
  createdAt?: number
}

function entryToPattern(raw: ShareEntry, token: string): Pattern | null {
  if (!raw || !Array.isArray(raw.rows) || !raw.paletteId || !getPalette(raw.paletteId)) return null
  const rows = raw.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c)) : []))
  const w = Math.max(1, rows[0]?.length ?? 0)
  const h = rows.length
  let hash = 0
  for (let i = 0; i < token.length; i++) hash = (hash * 31 + token.charCodeAt(i)) >>> 0
  return {
    id: 'shared-' + hash.toString(36),
    name: raw.name || '共享图纸',
    tags: raw.tags ?? [],
    paletteId: raw.paletteId,
    width: w,
    height: h,
    rows,
    source: 'generated',
    createdAt: raw.createdAt ?? 0
  }
}

const pattern = ref<Pattern | null>(null)
const loading = ref(true)

async function load() {
  const token = String(route.params.token ?? '')
  if (!token) {
    pattern.value = null
    loading.value = false
    return
  }
  loading.value = true
  // 1) 优先从服务器读取（跨设备分享）：npm run server 启动后端后任何设备可打开
  const remote = await remoteGetShare(token)
  if (remote && Array.isArray(remote.rows) && remote.paletteId && getPalette(remote.paletteId)) {
    pattern.value = entryToPattern(remote, token)
    loading.value = false
    return
  }
  // 2) 回退：本机已生成的短链接映射
  if (/^[A-Za-z0-9]{5}$/.test(token)) {
    const map = loadJSON<Record<string, ShareEntry>>('share_map', {})
    const entry = map[token]
    if (entry) {
      pattern.value = entryToPattern(entry, token)
      loading.value = false
      return
    }
  }
  // 3) 兼容旧链接：LZ 压缩或原始 JSON
  try {
    const rawText = token.startsWith('{') ? token : (decompressFromEncodedURIComponent(token) || token)
    const raw = JSON.parse(rawText) as ShareEntry
    const p = entryToPattern(raw, token)
    if (p) {
      pattern.value = p
      loading.value = false
      return
    }
  } catch {
    /* ignore */
  }
  pattern.value = null
  loading.value = false
}

onMounted(load)
watch(() => route.params.token, load)

const palette = computed(() => (pattern.value ? getPalette(pattern.value.paletteId) : undefined))
const usage = computed(() => (pattern.value ? computeColorUsage(pattern.value) : []))
const totalBeads = computed(() => usage.value.reduce((s, u) => s + u.count, 0))
const cellSize = ref(20)

function downloadPNG(withCodes: boolean) {
  if (!pattern.value || !palette.value) return
  const canvas = patternToCanvas(pattern.value, palette.value, {
    cellSize: 20,
    showCodes: withCodes,
    showGrid: true,
    background: '#ffffff',
    padding: 8,
    showCoords: true
  })
  downloadCanvas(canvas, `${safeFileName(pattern.value.name)}${withCodes ? '-色号版' : ''}.png`)
}
function downloadPNGTransparent() {
  if (!pattern.value || !palette.value) return
  const canvas = patternToCanvas(pattern.value, palette.value, {
    cellSize: 20,
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
function downloadSheet() {
  if (!pattern.value || !palette.value) return
  const canvas = renderPatternSheet(pattern.value, palette.value, { showCoords: true, boardSize: 29 })
  downloadCanvas(canvas, `${safeFileName(pattern.value.name)}-图纸+色号统计.png`)
}
</script>

<template>
  <div v-if="loading" class="card p-10 text-center">
    <p class="text-sm text-stone-500">正在加载共享图纸…</p>
  </div>

  <div v-else-if="pattern && palette" class="space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-xl font-bold text-stone-800 sm:text-2xl">{{ pattern.name }}</h1>
          <span class="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-600">共享图纸</span>
        </div>
        <p class="mt-1 text-sm text-stone-400">通过链接打开的共享图纸 · 如需编辑请先下载或到「我的」里重新生成</p>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-400">
          <span>{{ pattern.width }} × {{ pattern.height }} 格</span>
          <span>·</span>
          <span>{{ usage.length }} 种颜色</span>
          <span>·</span>
          <span>共 {{ totalBeads }} 颗豆</span>
          <span>·</span>
          <span>色卡：{{ palette.title }}</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-secondary" @click="downloadPNG(false)">⬇ 下载图</button>
        <button class="btn btn-secondary" @click="downloadPNG(true)">⬇ 色号版</button>
        <button class="btn btn-secondary" @click="downloadPNGTransparent">⬇ 透明 PNG</button>
        <button class="btn btn-secondary" @click="downloadSheet">🖨 图纸+色号统计</button>
        <button class="btn btn-secondary" @click="exportCSV">⇩ CSV</button>
        <router-link to="/" class="btn btn-primary">去图纸库</router-link>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section class="card min-w-0 p-4 sm:p-6">
        <div class="mb-3 flex items-center gap-3">
          <label class="flex items-center gap-2 text-sm text-stone-600">
            格子
            <input v-model.number="cellSize" type="range" min="6" max="28" step="1" class="w-40 accent-brand-500" />
          </label>
          <span class="text-xs text-stone-400">{{ cellSize }}px</span>
        </div>
        <div class="overflow-auto rounded-xl bg-stone-50 p-4" style="max-height: 72vh">
          <div class="inline-block">
            <PatternGrid
              :pattern="pattern"
              :palette="palette"
              :cell-size="cellSize"
              show-codes
              show-grid
              show-coords
              :board-size="29"
            />
          </div>
        </div>
      </section>
      <aside class="card min-w-0 p-4 sm:p-5">
        <h2 class="mb-3 text-sm font-semibold text-stone-700">🧮 用豆统计</h2>
        <ColorLegend :pattern="pattern" :palette="palette" />
      </aside>
    </div>
  </div>

  <div v-else class="card p-10 text-center">
    <p class="text-lg font-medium text-stone-600">分享链接不存在或已失效</p>
    <router-link to="/" class="btn btn-primary mt-4">返回图纸库</router-link>
  </div>
</template>
