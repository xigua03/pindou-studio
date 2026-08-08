<script setup lang="ts">
import { computed, ref } from 'vue'
import { PALETTES, getPalette, paletteGroups } from '../data/palettes'
import { useStore } from '../composables/useStore'

const store = useStore()
const paletteId = ref('mard-221-github')
const keyword = ref('')
const onlyOwned = ref(false)

const palette = computed(() => getPalette(paletteId.value)!)
const groups = computed(() => {
  const map = new Map<string, { code: string; hex: string; owned: number }[]>()
  const kw = keyword.value.trim().toLowerCase()
  for (const c of palette.value.colors) {
    if (kw && !c.code.toLowerCase().includes(kw) && !c.hex.toLowerCase().includes(kw)) continue
    const owned = store.ownedCount(paletteId.value, c.code)
    if (onlyOwned.value && owned <= 0) continue
    const list = map.get(c.group) ?? []
    list.push({ code: c.code, hex: c.hex, owned })
    map.set(c.group, list)
  }
  return [...map.entries()]
})

const stats = computed(() => {
  let colors = 0
  let beads = 0
  for (const [, list] of groups.value) {
    for (const c of list) {
      if (c.owned > 0) {
        colors++
        beads += c.owned
      }
    }
  }
  return { colors, beads }
})

function setCount(code: string, count: number) {
  store.setInventory(paletteId.value, code, Math.max(0, Math.floor(count)))
}

function clearAll() {
  if (confirm(`确定清空「${palette.value.title}」的所有库存登记吗？`)) {
    for (const c of palette.value.colors) store.setInventory(paletteId.value, c.code, 0)
  }
}

// 批量修改：作用于当前筛选结果
const batchCount = ref(0)
const batchMsg = ref('')
let batchTimer: ReturnType<typeof setTimeout> | undefined
const filteredColors = computed(() => groups.value.flatMap(([, list]) => list))
function batchApply(mode: 'set' | 'add' | 'sub' | 'clear') {
  const list = filteredColors.value
  if (!list.length) {
    batchMsg.value = '当前筛选没有颜色'
    setTimeout(() => (batchMsg.value = ''), 2500)
    return
  }
  if (mode === 'clear') {
    for (const c of list) store.setInventory(paletteId.value, c.code, 0)
    batchMsg.value = `已清空 ${list.length} 个颜色`
  } else if (mode === 'set') {
    const n = Math.max(0, Math.floor(batchCount.value || 0))
    for (const c of list) store.setInventory(paletteId.value, c.code, n)
    batchMsg.value = `已将 ${list.length} 个颜色设为 ${n}`
  } else {
    const delta = (mode === 'add' ? 1 : -1) * Math.floor(batchCount.value || 0)
    for (const c of list) store.addInventory(paletteId.value, c.code, delta)
    batchMsg.value = `已为 ${list.length} 个颜色${delta >= 0 ? '增加' : '减少'} ${Math.abs(delta)}`
  }
  if (batchTimer) clearTimeout(batchTimer)
  batchTimer = setTimeout(() => (batchMsg.value = ''), 3000)
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-stone-800 sm:text-2xl">📦 豆仓</h1>
        <p class="mt-1 text-sm text-stone-500">登记你拥有的拼豆颜色和数量，生成图纸后自动帮你算"缺什么豆、缺多少颗"。</p>
      </div>
      <div class="flex items-center gap-3 rounded-2xl bg-white px-4 py-2 text-sm ring-1 ring-stone-200">
        <span class="text-stone-400">已登记 <b class="text-brand-500">{{ stats.colors }}</b> 色 / <b class="text-brand-500">{{ stats.beads }}</b> 颗</span>
      </div>
    </div>

    <div class="card flex flex-wrap items-center gap-3 p-4">
      <select v-model="paletteId" class="input max-w-xs">
        <optgroup v-for="g in paletteGroups()" :key="g.label" :label="g.label">
          <option v-for="p in g.items" :key="p.id" :value="p.id">{{ p.title }}（{{ p.count }} 色）</option>
        </optgroup>
      </select>
      <input v-model="keyword" type="search" placeholder="搜索色号或颜色，如 F4 / ff7043" class="input max-w-xs" />
      <label class="flex cursor-pointer items-center gap-2 text-sm text-stone-600">
        <input v-model="onlyOwned" type="checkbox" class="h-4 w-4 accent-brand-500" />
        只看已登记
      </label>
      <button class="btn btn-danger ml-auto" @click="clearAll">清空当前色卡</button>
    </div>

    <div class="card p-4">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-sm font-semibold text-stone-700">批量修改</span>
        <span class="text-xs text-stone-400">作用于当前筛选的 <b class="text-brand-500">{{ filteredColors.length }}</b> 个颜色</span>
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-stone-500">数量</span>
          <input v-model.number="batchCount" type="number" min="0" class="input !w-24 !py-1.5" placeholder="0" />
        </div>
        <button class="btn btn-secondary !py-1.5 text-xs" @click="batchApply('set')">设为</button>
        <button class="btn btn-secondary !py-1.5 text-xs" @click="batchApply('add')">增加</button>
        <button class="btn btn-secondary !py-1.5 text-xs" @click="batchApply('sub')">减少</button>
        <button class="btn btn-danger !py-1.5 text-xs" @click="batchApply('clear')">清零</button>
      </div>
      <p v-if="batchMsg" class="mt-2 text-xs font-medium text-brand-600">{{ batchMsg }}</p>
      <p class="mt-1 text-[11px] text-stone-400">例：筛选“只看已登记”后点“清零”；整盒入库时输入数量点“增加”。</p>
    </div>

    <div class="space-y-3">
      <details
        v-for="[group, list] in groups"
        :key="group"
        class="card overflow-hidden"
        :open="list.length <= 40"
      >
        <summary class="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
          <span class="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-xs font-bold text-brand-600">{{ group }}</span>
          {{ group }} 系列
          <span class="ml-auto text-xs font-normal text-stone-400">{{ list.length }} 色</span>
        </summary>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-stone-100 px-4 py-3 sm:grid-cols-3 lg:grid-cols-4">
          <div v-for="c in list" :key="c.code" class="flex items-center gap-2 py-1">
            <span
              class="h-7 w-7 shrink-0 rounded-lg ring-1 ring-stone-200"
              :style="{ background: c.hex }"
              :title="c.hex"
            ></span>
            <span class="w-11 shrink-0 font-mono text-xs font-semibold text-stone-600">{{ c.code }}</span>
            <input
              type="number"
              min="0"
              :value="c.owned"
              class="w-16 rounded-lg px-1.5 py-1 text-right text-xs ring-1 ring-stone-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
              @change="setCount(c.code, Number(($event.target as HTMLInputElement).value))"
            />
            <span class="text-[10px] text-stone-300">颗</span>
          </div>
        </div>
      </details>
    </div>
  </div>
</template>