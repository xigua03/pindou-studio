<script setup lang="ts">
import { computed } from 'vue'
import type { Pattern, BeadPalette } from '../types'
import { computeColorUsage } from '../utils/export'
import { useStore } from '../composables/useStore'

const props = defineProps<{ pattern: Pattern; palette: BeadPalette }>()
const store = useStore()
const byCode = computed(() => new Map(props.palette.colors.map((c) => [c.code, c])))

interface Row {
  code: string
  hex: string
  count: number
  owned: number
  status: 'enough' | 'short' | 'none' | 'noData'
}

const rows = computed<Row[]>(() =>
  computeColorUsage(props.pattern).map((u) => {
    const color = byCode.value.get(u.code)
    const owned = store.ownedCount(props.pattern.paletteId, u.code)
    let status: Row['status'] = 'noData'
    if (owned >= u.count) status = 'enough'
    else if (owned > 0) status = 'short'
    else status = 'none'
    return { code: u.code, hex: color?.hex ?? '#cccccc', count: u.count, owned, status }
  })
)

const total = computed(() => rows.value.reduce((s, r) => s + r.count, 0))
const summary = computed(() => {
  let need = 0
  let needColors = 0
  for (const r of rows.value) {
    if (r.owned < r.count) {
      need += r.count - r.owned
      needColors++
    }
  }
  return { need, needColors }
})
</script>

<template>
  <div>
    <div class="mb-2 flex items-center justify-between text-xs text-stone-400">
      <span>共 {{ rows.length }} 种颜色 · {{ total }} 颗豆</span>
      <span v-if="summary.need > 0" class="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-500">
        还缺 {{ summary.need }} 颗（{{ summary.needColors }} 色）
      </span>
      <span v-else-if="rows.some((r) => r.status !== 'noData')" class="rounded-full bg-green-50 px-2 py-0.5 font-medium text-green-600">库存充足 ✓</span>
    </div>
    <ul class="divide-y divide-stone-100">
      <li v-for="r in rows" :key="r.code" class="flex items-center gap-3 py-2">
        <span
          class="h-7 w-7 shrink-0 rounded-lg ring-1 ring-stone-200"
          :style="{ background: r.hex }"
          :title="r.hex"
        ></span>
        <span class="w-12 shrink-0 font-mono text-sm font-semibold text-stone-700">{{ r.code }}</span>
        <span class="flex-1 text-xs text-stone-400">需要 {{ r.count }} 颗</span>
        <span
          v-if="r.status === 'enough'"
          class="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-600"
        >
          库存充足
        </span>
        <span
          v-else-if="r.status === 'short'"
          class="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600"
        >
          差 {{ r.count - r.owned }} 颗
        </span>
        <span
          v-else-if="r.status === 'none'"
          class="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-500"
        >
          需购 {{ r.count }} 颗
        </span>
        <span v-else class="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-500">需购 {{ r.count }} 颗</span>
      </li>
    </ul>
  </div>
</template>