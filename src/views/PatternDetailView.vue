<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Pattern } from '../types'
import { getPalette } from '../data/palettes'
import { useStore } from '../composables/useStore'
import PatternGrid from '../components/PatternGrid.vue'
import ColorLegend from '../components/ColorLegend.vue'
import {
  computeColorUsage,
  patternToCanvas,
  renderPatternSheet,
  downloadCanvas,
  exportUsageCSV,
  downloadText,
  printPattern,
  printPatternTiled,
  safeFileName
} from '../utils/export'
import { buildPatternFromRows } from '../utils/quantize'

const route = useRoute()
const router = useRouter()
const store = useStore()

const pattern = computed<Pattern | undefined>(() => store.getPattern(String(route.params.id)))
const palette = computed(() => (pattern.value ? getPalette(pattern.value.paletteId) : undefined))

const showCodes = ref(true)
const showGrid = ref(true)
const cellSize = ref(22)
const copied = ref(false)

const usage = computed(() => (pattern.value ? computeColorUsage(pattern.value) : []))
const totalBeads = computed(() => usage.value.reduce((s, u) => s + u.count, 0))
const isFav = computed(() => (pattern.value ? store.isFavorite(pattern.value.id) : false))
const isSaved = computed(() => (pattern.value ? pattern.value.source !== 'builtin' : false))

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
    padding: 8
  })
  downloadCanvas(canvas, `${safeFileName(pattern.value.name)}${withCodes ? '-色号版' : ''}.png`)
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
  printPattern(pattern.value, palette.value, { showCodes: true })
}

function printA4() {
  if (!pattern.value || !palette.value) return
  printPatternTiled(pattern.value, palette.value, { cellSize: 14 })
}

function downloadSheet() {
  if (!pattern.value || !palette.value) return
  const canvas = renderPatternSheet(pattern.value, palette.value)
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
    store.savePattern(target)
  }
  router.push(`/editor/${target.id}`)
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
        <button class="btn btn-secondary" @click="exportCSV">⇩ CSV</button>`n        <button class="btn btn-secondary" @click="downloadSheet">🖨 图纸+色号统计</button>
        <button class="btn btn-secondary" @click="doPrint">🖨 打印</button>
        <button class="btn btn-secondary" @click="printA4">🖨 A4 分区打印</button>
        <button class="btn btn-primary" @click="edit">✏️ 编辑</button>
        <button v-if="isSaved" class="btn btn-danger" @click="remove">🗑 删除</button>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-[1fr_320px]">
      <!-- 图纸 -->
      <section class="card p-4 sm:p-6">
        <div class="no-print mb-4 flex flex-wrap items-center gap-3">
          <label class="flex cursor-pointer items-center gap-2 text-sm text-stone-600">
            <input v-model="showCodes" type="checkbox" class="h-4 w-4 accent-brand-500" />
            显示色号
          </label>
          <label class="flex cursor-pointer items-center gap-2 text-sm text-stone-600">
            <input v-model="showGrid" type="checkbox" class="h-4 w-4 accent-brand-500" />
            显示网格
          </label>
          <div class="ml-auto flex items-center gap-2 text-sm text-stone-500">
            <span>格子</span>
            <input v-model.number="cellSize" type="range" min="10" max="40" step="1" class="w-32 accent-brand-500" />
            <span class="w-8 text-right text-xs">{{ cellSize }}px</span>
          </div>
        </div>

        <div class="overflow-auto rounded-xl bg-stone-50 p-4" style="max-height: 70vh">
          <div class="inline-block">
            <PatternGrid
              :pattern="pattern"
              :palette="palette"
              :cell-size="cellSize"
              :show-codes="showCodes"
              :grid="showGrid"
            />
          </div>
        </div>
      </section>

      <!-- 用豆统计 -->
      <aside class="card p-4 sm:p-5">
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
</template>