<script setup lang="ts">
import { computed, ref } from 'vue'
import { PALETTES, getPalette, paletteGroups, customPalettes, addCustomPalette, updateCustomPaletteColors, deleteCustomPalette } from '../data/palettes'
import type { BeadColor } from '../types'
import { colorDistance, hexToRgb, rgbToHex } from '../utils/color'

const paletteId = ref('mard-221-github')
const pickColor = ref('#FF7043')
const lookupHex = ref('#FF7043')
const copiedCode = ref('')

// E25 自定义调色板
const customs = computed(() => customPalettes())
const customTitle = ref('')
const customDesc = ref('')
const editingCustomId = ref('')
const customColorRows = ref<{ code: string; hex: string }[]>([])
const customMsg = ref('')

function createCustom() {
  const pal = addCustomPalette({
    title: customTitle.value,
    description: customDesc.value,
    colors: [{ code: 'C01', hex: '#FF0000' }]
  })
  if (!pal) {
    customMsg.value = '创建失败：请先填写名称（创建后会自动带 1 个色号）'
    return
  }
  customTitle.value = ''
  customDesc.value = ''
  editingCustomId.value = pal.id
  customColorRows.value = pal.colors.map((c) => ({ code: c.code, hex: c.hex }))
  customMsg.value = `已创建「${pal.title}」，可继续添加色号`
  setTimeout(() => (customMsg.value = ''), 3000)
}
function pickCustom(id: string) {
  const pal = getPalette(id)
  if (!pal) return
  editingCustomId.value = id
  customColorRows.value = pal.colors.map((c) => ({ code: c.code, hex: c.hex }))
}
function addCustomRow() {
  customColorRows.value.push({ code: '', hex: '#888888' })
}
function removeCustomRow(i: number) {
  customColorRows.value.splice(i, 1)
}
function saveCustom() {
  if (!editingCustomId.value) return
  const ok = updateCustomPaletteColors(editingCustomId.value, customColorRows.value)
  customMsg.value = ok ? '💾 已保存' : '保存失败：至少保留一个有效色号（色号不能重复）'
  setTimeout(() => (customMsg.value = ''), 2500)
}
function removeCustom() {
  if (!editingCustomId.value) return
  if (!confirm('确定删除这个自定义调色板吗？使用它的图纸可能无法正常显示颜色。')) return
  const delId = editingCustomId.value
  deleteCustomPalette(delId)
  if (paletteId.value === delId) paletteId.value = 'mard-221-github'
  editingCustomId.value = ''
  customColorRows.value = []
  customMsg.value = '已删除'
  setTimeout(() => (customMsg.value = ''), 2000)
}

const palette = computed(() => getPalette(paletteId.value)!)

const groups = computed(() => {
  const map = new Map<string, BeadColor[]>()
  for (const c of palette.value.colors) {
    const list = map.get(c.group) ?? []
    list.push(c)
    map.set(c.group, list)
  }
  return [...map.entries()]
})

const matches = computed(() => {
  const hex = lookupHex.value
  const out: { paletteTitle: string; color: BeadColor; distance: number }[] = []
  for (const p of PALETTES) {
    let best: BeadColor | null = null
    let bestD = Infinity
    for (const c of p.colors) {
      const d = colorDistance(hex, c.hex)
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    if (best) out.push({ paletteTitle: p.title, color: best, distance: bestD })
  }
  return out.sort((a, b) => a.distance - b.distance)
})

function onPick(e: Event) {
  const v = (e.target as HTMLInputElement).value
  pickColor.value = v
  lookupHex.value = v
}

function onHexInput(e: Event) {
  const v = (e.target as HTMLInputElement).value
  const rgb = hexToRgb(v)
  lookupHex.value = rgbToHex(rgb.r, rgb.g, rgb.b)
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    copiedCode.value = code
    setTimeout(() => (copiedCode.value = ''), 1200)
  } catch {
    /* noop */
  }
}
</script>

<template>
  <div class="space-y-5">
    <div>
      <h1 class="text-xl font-bold text-stone-800 sm:text-2xl">🎨 色卡</h1>
      <p class="mt-1 text-sm text-stone-500">浏览 6 大品牌色卡，或者选一个颜色，跨品牌查找最接近的色号。</p>
    </div>

    <!-- 我的调色板（自定义） -->
    <section class="card p-5">
      <h2 class="text-sm font-semibold text-stone-700">🧪 我的调色板（自定义色卡）</h2>
      <p class="mt-1 text-xs leading-5 text-stone-500">
        创建自己的品牌色卡：填好色号+颜色后，就能在「图片转图纸」「换色卡」里当普通色卡使用（保存在本地浏览器）。
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <input v-model="customTitle" placeholder="调色板名称，如：我的散豆" class="input !w-52" />
        <input v-model="customDesc" placeholder="备注（可选）" class="input !w-52" />
        <button class="btn btn-primary !py-2 text-xs" @click="createCustom">＋ 新建调色板</button>
      </div>

      <div v-if="customs.length" class="mt-4 flex flex-wrap items-center gap-2">
        <span class="text-xs text-stone-500">编辑：</span>
        <select :value="editingCustomId" class="input !w-64" @change="pickCustom(($event.target as HTMLSelectElement).value)">
          <option value="" disabled>选择要编辑的调色板</option>
          <option v-for="c in customs" :key="c.id" :value="c.id">{{ c.title }}（{{ c.count }} 色）</option>
        </select>
      </div>

      <div v-if="editingCustomId" class="mt-4 space-y-2">
        <div v-for="(row, i) in customColorRows" :key="i" class="flex items-center gap-2">
          <span class="h-7 w-7 shrink-0 rounded-md ring-1 ring-stone-200" :style="{ background: row.hex }"></span>
          <input v-model="row.code" placeholder="色号，如 C01" class="input !w-32 !py-1.5 font-mono text-xs" />
          <input v-model="row.hex" type="color" class="h-8 w-12 cursor-pointer rounded ring-1 ring-stone-200" />
          <button class="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-500 hover:bg-red-50 hover:text-red-500" @click="removeCustomRow(i)">删</button>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="btn btn-secondary !py-1.5 text-xs" @click="addCustomRow">＋ 添加色号</button>
          <button class="btn btn-primary !py-1.5 text-xs" @click="saveCustom">💾 保存</button>
          <button class="btn btn-danger !py-1.5 text-xs" @click="removeCustom">🗑 删除此调色板</button>
          <span v-if="customMsg" class="text-xs text-brand-600">{{ customMsg }}</span>
        </div>
      </div>
    </section>

    <!-- 色号查询 -->
    <section class="card grid gap-6 p-5 md:grid-cols-[1fr_1fr]">
      <div>
        <h2 class="mb-3 text-sm font-semibold text-stone-700">🔍 颜色找色号</h2>
        <div class="flex items-center gap-3">
          <input type="color" :value="pickColor" class="h-10 w-14 cursor-pointer rounded-lg ring-1 ring-stone-200" @input="onPick" />
          <input :value="lookupHex" class="input max-w-[120px] font-mono" @input="onHexInput" />
        </div>
        <ul class="mt-4 space-y-1.5">
          <li v-for="m in matches.slice(0, 8)" :key="m.paletteTitle" class="flex items-center gap-2 text-sm">
            <span class="h-5 w-5 rounded ring-1 ring-stone-200" :style="{ background: m.color.hex }"></span>
            <span class="w-40 truncate text-stone-500">{{ m.paletteTitle }}</span>
            <button
              class="rounded bg-stone-100 px-2 py-0.5 font-mono text-xs font-semibold text-stone-700 hover:bg-brand-50 hover:text-brand-600"
              @click="copyCode(m.color.code)"
            >
              {{ m.color.code }}
            </button>
            <span v-if="copiedCode === m.color.code" class="text-[11px] text-green-500">已复制</span>
          </li>
        </ul>
      </div>
      <div>
        <h2 class="mb-3 text-sm font-semibold text-stone-700">📋 当前色卡</h2>
        <select v-model="paletteId" class="input">
          <optgroup v-for="g in paletteGroups()" :key="g.label" :label="g.label">
            <option v-for="p in g.items" :key="p.id" :value="p.id">{{ p.title }}（{{ p.count }} 色）</option>
          </optgroup>
        </select>
        <p class="mt-2 text-xs leading-5 text-stone-400">{{ palette.description }}</p>
      </div>
    </section>

    <!-- 色卡浏览 -->
    <section class="space-y-3">
      <details v-for="[group, list] in groups" :key="group" class="card overflow-hidden" :open="list.length <= 30">
        <summary class="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50">
          <span class="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-xs font-bold text-brand-600">{{ group }}</span>
          {{ group }} 系列
          <span class="ml-auto text-xs font-normal text-stone-400">{{ list.length }} 色</span>
        </summary>
        <div class="grid grid-cols-4 gap-2 border-t border-stone-100 px-4 py-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
          <button
            v-for="c in list"
            :key="c.code"
            class="group flex flex-col items-center gap-1 rounded-lg p-1 hover:bg-stone-100"
            @click="copyCode(c.code)"
          >
            <span class="h-8 w-full rounded-md ring-1 ring-stone-200" :style="{ background: c.hex }"></span>
            <span class="font-mono text-[10px] text-stone-500 group-hover:text-brand-600">{{ c.code }}</span>
          </button>
        </div>
      </details>
    </section>
  </div>
</template>