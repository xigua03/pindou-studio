<script setup lang="ts">
import { computed } from 'vue'
import type { Pattern, BeadPalette } from '../types'
import { computeColorUsage } from '../utils/export'
import PatternGrid from './PatternGrid.vue'

const props = defineProps<{ pattern: Pattern; palette: BeadPalette }>()

const cell = computed(() => {
  const max = Math.max(props.pattern.width, props.pattern.height)
  return Math.max(6, Math.floor(160 / max))
})
const usage = computed(() => computeColorUsage(props.pattern))
const totalBeads = computed(() => usage.value.reduce((s, u) => s + u.count, 0))
</script>

<template>
  <router-link
    :to="`/pattern/${pattern.id}`"
    class="card group block overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md"
  >
    <div class="flex aspect-square items-center justify-center overflow-hidden bg-stone-100 p-3">
      <PatternGrid :pattern="pattern" :palette="palette" :cell-size="cell" :grid="false" />
    </div>
    <div class="border-t border-stone-100 p-3">
      <div class="flex items-center justify-between gap-2">
        <h3 class="truncate text-sm font-semibold text-stone-800 group-hover:text-brand-600">
          {{ pattern.name }}
        </h3>
        <span class="shrink-0 text-xs text-stone-400">{{ pattern.width }}×{{ pattern.height }}</span>
      </div>
      <p class="mt-1 text-xs text-stone-400">{{ usage.length }} 种颜色 · 共 {{ totalBeads }} 颗豆</p>
      <p v-if="pattern.sourceLabel" class="mt-1 text-[11px] text-brand-400">来源：{{ pattern.sourceLabel }}</p>
      <div class="mt-2 flex flex-wrap gap-1">
        <span
          v-for="t in pattern.tags.slice(0, 3)"
          :key="t"
          class="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-600"
        >
          {{ t }}
        </span>
      </div>
    </div>
  </router-link>
</template>