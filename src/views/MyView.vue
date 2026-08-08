<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStore } from '../composables/useStore'
import { getPalette, PALETTES } from '../data/palettes'
import { buildPatternFromRows } from '../utils/quantize'
import PatternCard from '../components/PatternCard.vue'

const store = useStore()
const tab = ref<'favorites' | 'saved'>('favorites')
const batchMode = ref(false)
const selected = ref<string[]>([])

// ---------- 分组 ----------
const activeGroup = ref<'all' | 'none' | string>('all')
const groupMenuId = ref<string | null>(null)
const batchGroupId = ref('')
// 新建 / 重命名分组弹窗
const groupModal = ref(false)
const groupModalMode = ref<'create' | 'rename'>('create')
const groupModalName = ref('')
const groupModalId = ref<string | null>(null)

const inGroup = (groupId: string, patternId: string) =>
  store.state.groups.find((g) => g.id === groupId)?.patternIds.includes(patternId) ?? false

const groupFilter = (p: { id: string }) => {
  if (activeGroup.value === 'all') return true
  if (activeGroup.value === 'none') return store.patternGroups(p.id).length === 0
  return inGroup(activeGroup.value, p.id)
}
const shownList = computed(() => list.value.filter(groupFilter))

function toggleGroupMenu(id: string) {
  groupMenuId.value = groupMenuId.value === id ? null : id
}
function togglePatternInGroup(g: { id: string }, p: { id: string }) {
  if (inGroup(g.id, p.id)) store.removeFromGroup(g.id, p.id)
  else store.addToGroup(g.id, p.id)
}
function openCreateGroup() {
  groupModalMode.value = 'create'
  groupModalName.value = ''
  groupModalId.value = null
  groupModal.value = true
}
function openRenameGroup(g: { id: string; name: string }) {
  groupModalMode.value = 'rename'
  groupModalName.value = g.name
  groupModalId.value = g.id
  groupModal.value = true
}
function submitGroupModal() {
  const name = groupModalName.value.trim()
  if (!name) return
  if (groupModalMode.value === 'create') {
    store.createGroup(name)
    activeGroup.value = 'all'
  } else if (groupModalId.value) {
    store.renameGroup(groupModalId.value, name)
  }
  groupModal.value = false
}
function deleteGroup(g: { id: string; name: string }) {
  if (confirm(`确定删除分组「${g.name}」吗？图纸不会被删除，只是移出该分组。`)) {
    store.deleteGroup(g.id)
    if (activeGroup.value === g.id) activeGroup.value = 'all'
  }
}
function applyBatchGroup() {
  if (!selected.value.length) return
  store.assignPatternsToGroup(selected.value, batchGroupId.value || null)
  selected.value = []
}

const favoritePatterns = computed(() =>
  store.state.favorites
    .map((id) => store.getPattern(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
)

const list = computed(() => (tab.value === 'saved' ? store.state.savedPatterns : favoritePatterns.value))

const isSelected = (id: string) => selected.value.includes(id)

function toggleSelect(id: string) {
  const i = selected.value.indexOf(id)
  if (i >= 0) selected.value.splice(i, 1)
  else selected.value.push(id)
}

function allSelected() {
  return list.value.length > 0 && selected.value.length === list.value.length
}

function toggleSelectAll() {
  selected.value = allSelected() ? [] : list.value.map((p) => p.id)
}

function enterBatch() {
  batchMode.value = true
  selected.value = []
}

function exitBatch() {
  batchMode.value = false
  selected.value = []
}

function batchFav(fav: boolean) {
  if (!selected.value.length) return
  store.setFavorites(selected.value, fav)
  selected.value = []
}

function batchDelete() {
  if (!selected.value.length) return
  if (confirm(`确定删除选中的 ${selected.value.length} 张图纸吗？`)) {
    store.deletePatterns(selected.value)
    selected.value = []
    batchMode.value = false
  }
}

// ---------- 导入图纸 ----------
const showImport = ref(false)
const importTab = ref<'grid' | 'json'>('grid')
const importText = ref('')
const importName = ref('')
const importPaletteId = ref('mard-221-github')
const importErr = ref('')
const importMsg = ref('')
const importPreview = ref<{ w: number; h: number; colors: number; beads: number } | null>(null)
const importOk = ref(false)

function parseGridText(text: string): string[][] | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  if (!lines.length) return null
  const rows = lines.map((line) => {
    const cells = line.split(/[,;\t ]+/).map((c) => c.trim()).filter((c) => c !== '')
    return cells.map((c) => (c === '.' ? '.' : c))
  })
  const w = rows[0].length
  if (!w) return null
  for (const r of rows) if (r.length !== w) return null
  return rows
}

function parseJsonImport(text: string): { name?: string; paletteId?: string; rows: string[][] } | null {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return null
  }
  if (Array.isArray(obj)) {
    const rows = obj as string[][]
    if (!rows.length || !Array.isArray(rows[0])) return null
    return { rows }
  }
  const o = obj as Record<string, unknown>
  if (o && Array.isArray(o.rows) && (o.rows as unknown[]).length) {
    const first = (o.rows as unknown[])[0]
    if (Array.isArray(first)) {
      return { name: typeof o.name === 'string' ? o.name : undefined, paletteId: typeof o.paletteId === 'string' ? o.paletteId : undefined, rows: o.rows as string[][] }
    }
    if (typeof first === 'string' && o.legend && typeof o.legend === 'object') {
      const legend = o.legend as Record<string, string>
      const rows = (o.rows as string[]).map((r) =>
        [...r].map((ch) => (ch === '.' ? '.' : legend[ch] ?? '.'))
      )
      return { name: typeof o.name === 'string' ? o.name : undefined, paletteId: typeof o.paletteId === 'string' ? o.paletteId : undefined, rows }
    }
  }
  return null
}

function analyzeImport() {
  importErr.value = ''
  importMsg.value = ''
  importOk.value = false
  importPreview.value = null
  const text = importText.value.trim()
  if (!text) return
  let rows: string[][] | null = null
  let paletteId = importPaletteId.value
  if (importTab.value === 'grid') {
    rows = parseGridText(text)
  } else {
    const parsed = parseJsonImport(text)
    if (parsed) {
      rows = parsed.rows
      if (parsed.paletteId && getPalette(parsed.paletteId)) paletteId = parsed.paletteId
      if (parsed.name) importName.value = parsed.name
    }
  }
  if (!rows) {
    importErr.value = '无法解析：请检查格式（每行色号数量要一致）'
    return
  }
  const h = rows.length
  const w = rows[0].length
  const colors = new Set<string>()
  let beads = 0
  for (const r of rows) for (const c of r) if (c && c !== '.') { colors.add(c); beads++ }
  if (w * h > 200 * 200) {
    importErr.value = '图纸过大（超过 200×200 格），请缩小后导入'
    return
  }
  importPreview.value = { w, h, colors: colors.size, beads }
  importOk.value = true
  importPaletteId.value = paletteId
}

function doImport() {
  if (!importOk.value || !importPreview.value) return
  const rows = importTab.value === 'json' ? parseJsonImport(importText.value.trim())?.rows : parseGridText(importText.value.trim())
  if (!rows) return
  const paletteId = getPalette(importPaletteId.value) ? importPaletteId.value : 'mard-221-github'
  const pat = buildPatternFromRows(rows, paletteId, importName.value.trim() || '导入的图纸', 'edited', ['导入'])
  const id = store.savePattern(pat)
  importText.value = ''
  importName.value = ''
  importPreview.value = null
  importOk.value = false
  importErr.value = ''
  importMsg.value = `已导入：${pat.width}×${pat.height} 格，${pat.rows.reduce((s, r) => s + r.filter((c) => c && c !== '.').length, 0)} 颗豆`
  tab.value = 'saved'
}
</script>

<template>
  <div class="space-y-5">
    <div>
      <h1 class="text-xl font-bold text-stone-800 sm:text-2xl">🙋 我的</h1>
      <p class="mt-1 text-sm text-stone-500">管理你收藏和生成的图纸。</p>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button
        class="chip"
        :class="tab === 'favorites' ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200'"
        @click="tab = 'favorites'; exitBatch()"
      >
        ♥ 我的收藏（{{ store.state.favorites.length }}）
      </button>
      <button
        class="chip"
        :class="tab === 'saved' ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200'"
        @click="tab = 'saved'; exitBatch()"
      >
        🧩 我的图纸（{{ store.state.savedPatterns.length }}）
      </button>
      <button v-if="list.length" class="chip ml-auto" :class="batchMode ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200'" @click="batchMode ? exitBatch() : enterBatch()">
        {{ batchMode ? '✕ 退出批量' : '☑ 批量管理' }}
      </button>
      <button class="btn btn-secondary !py-1.5" @click="showImport = !showImport">
        {{ showImport ? '✕ 关闭导入' : '⇪ 导入图纸' }}
      </button>
    </div>

    <!-- 分组筛选 -->
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="mr-1 text-xs font-medium text-stone-400">分组</span>
      <button
        class="chip"
        :class="activeGroup === 'all' ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200'"
        @click="activeGroup = 'all'"
      >
        全部
      </button>
      <button
        class="chip"
        :class="activeGroup === 'none' ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200'"
        @click="activeGroup = 'none'"
      >
        未分组
      </button>
      <div
        v-for="g in store.state.groups"
        :key="g.id"
        class="flex items-center gap-0.5 rounded-lg py-0.5 pl-1 pr-0.5 ring-1"
        :class="activeGroup === g.id ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200'"
      >
        <button class="text-xs font-medium" @click="activeGroup = g.id">{{ g.name }}（{{ g.patternIds.length }}）</button>
        <button
          class="grid h-5 w-5 place-items-center rounded text-[10px]"
          :class="activeGroup === g.id ? 'text-white/80 hover:bg-white/20 hover:text-white' : 'text-stone-400 hover:bg-stone-100 hover:text-brand-600'"
          title="重命名分组"
          @click="openRenameGroup(g)"
        >
          ✎
        </button>
        <button
          class="grid h-5 w-5 place-items-center rounded text-[10px]"
          :class="activeGroup === g.id ? 'text-white/80 hover:bg-white/20 hover:text-white' : 'text-stone-400 hover:bg-stone-100 hover:text-red-500'"
          title="删除分组"
          @click="deleteGroup(g)"
        >
          ✕
        </button>
      </div>
      <button class="btn btn-secondary !px-2 !py-1 text-xs" title="新建分组" @click="openCreateGroup">＋ 新建分组</button>
    </div>

    <!-- 导入图纸面板 -->
    <div v-if="showImport" class="card space-y-3 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-stone-700">⇪ 导入图纸</span>
          <span class="text-[11px] text-stone-400">把其他网站/文本里的图纸粘贴进来，存到「我的图纸」</span>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <button
          class="chip"
          :class="importTab === 'grid' ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200'"
          @click="importTab = 'grid'; importPreview = null; importOk = false"
        >
          色号网格
        </button>
        <button
          class="chip"
          :class="importTab === 'json' ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200'"
          @click="importTab = 'json'; importPreview = null; importOk = false"
        >
          JSON / 字符画
        </button>
        <label class="flex items-center gap-1.5">
          色卡
          <select v-model="importPaletteId" class="input !w-44 !py-1 text-xs">
            <option v-for="p in PALETTES" :key="p.id" :value="p.id">{{ p.title }}（{{ p.count }} 色）</option>
          </select>
        </label>
        <input v-model="importName" class="input !w-44 !py-1 text-xs" placeholder="图纸名称（可留空）" />
      </div>
      <textarea
        v-model="importText"
        class="input min-h-40 w-full !py-2 font-mono text-xs"
        :placeholder="importTab === 'grid'
          ? `每行一个格子，用逗号/空格/制表符分隔色号，用 . 表示空格。例如：A1,B23,.,F5`
          : `粘贴图纸 JSON（本站格式：{name, paletteId, rows:[[A1,.],...]}）；也支持字符画格式：{legend:{R:F4}, rows:[...RR...]}`"
        @input="analyzeImport"
      ></textarea>
      <div v-if="importPreview" class="rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700">
        ✅ 可导入：{{ importPreview.w }}×{{ importPreview.h }} 格 · {{ importPreview.colors }} 种颜色 · 共 {{ importPreview.beads }} 颗豆
      </div>
      <div v-if="importErr && !importPreview" class="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{{ importErr }}</div>
      <div v-if="importMsg" class="rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700">{{ importMsg }}</div>
      <button class="btn btn-primary w-fit !py-1.5 text-sm" :disabled="!importOk" @click="doImport">📥 导入到我的图纸</button>
    </div>

    <!-- 批量操作栏 -->
    <div v-if="batchMode && list.length" class="card flex flex-wrap items-center gap-3 p-3">
      <button class="btn btn-secondary !py-1.5" @click="toggleSelectAll">
        {{ allSelected() ? '取消全选' : '全选' }}
      </button>
      <span class="text-sm text-stone-500">已选 <b class="text-brand-500">{{ selected.length }}</b> 项</span>
      <div class="ml-auto flex flex-wrap gap-2">
        <select v-model="batchGroupId" class="input !w-40 !py-1.5 text-xs">
          <option value="">移出所有分组</option>
          <option v-for="g in store.state.groups" :key="g.id" :value="g.id">移动到「{{ g.name }}」</option>
        </select>
        <button class="btn btn-secondary !py-1.5" @click="applyBatchGroup">📁 移动分组</button>
        <button v-if="tab === 'saved'" class="btn btn-secondary !py-1.5" @click="batchFav(true)">♡ 批量收藏</button>
        <button v-else class="btn btn-secondary !py-1.5" @click="batchFav(false)">♡ 取消收藏</button>
        <button class="btn btn-danger !py-1.5" @click="batchDelete">🗑 批量删除</button>
      </div>
    </div>

    <!-- 收藏 -->
    <template v-if="tab === 'favorites'">
      <div v-if="shownList.length" class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <div v-for="p in shownList" :key="p.id" class="relative">
          <PatternCard :pattern="p" :palette="getPalette(p.paletteId)!" />
          <label
            v-if="batchMode"
            class="absolute left-2 top-2 z-10 grid h-6 w-6 cursor-pointer place-items-center rounded-md bg-white text-xs shadow ring-1 ring-stone-300"
            :class="isSelected(p.id) ? '!bg-brand-500 !ring-brand-500 text-white' : 'text-transparent'"
            @click.prevent.stop="toggleSelect(p.id)"
          >
            <input type="checkbox" class="sr-only" :checked="isSelected(p.id)" />
            ✓
          </label>
          <button
            v-if="!batchMode"
            class="absolute right-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-md bg-white/90 text-xs shadow ring-1 ring-stone-200 hover:bg-white"
            title="加入分组"
            @click.stop="toggleGroupMenu(p.id)"
          >
            📁
          </button>
          <div
            v-if="groupMenuId === p.id"
            class="absolute right-2 top-9 z-20 w-44 rounded-xl bg-white p-2 shadow-lg ring-1 ring-stone-200"
            @click.stop
          >
            <div class="max-h-40 space-y-0.5 overflow-auto">
              <label
                v-for="g in store.state.groups"
                :key="g.id"
                class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-stone-50"
              >
                <input
                  type="checkbox"
                  class="h-3.5 w-3.5 accent-brand-500"
                  :checked="inGroup(g.id, p.id)"
                  @change="togglePatternInGroup(g, p)"
                />
                {{ g.name }}
              </label>
              <p v-if="!store.state.groups.length" class="px-2 py-1 text-[11px] text-stone-400">还没有分组，先在顶部新建一个</p>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="card p-10 text-center text-sm text-stone-400">
        <template v-if="activeGroup === 'all'">还没有收藏任何图纸</template>
        <template v-else>该分组下没有收藏的图纸</template>
        <router-link to="/" class="mt-3 block font-medium text-brand-500 hover:underline">去图纸库逛逛 →</router-link>
      </div>
    </template>

    <!-- 我的图纸 -->
    <template v-else>
      <div v-if="shownList.length" class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <div v-for="p in shownList" :key="p.id" class="relative">
          <PatternCard :pattern="p" :palette="getPalette(p.paletteId)!" />
          <label
            v-if="batchMode"
            class="absolute left-2 top-2 z-10 grid h-6 w-6 cursor-pointer place-items-center rounded-md bg-white text-xs shadow ring-1 ring-stone-300"
            :class="isSelected(p.id) ? '!bg-brand-500 !ring-brand-500 text-white' : 'text-transparent'"
            @click.prevent.stop="toggleSelect(p.id)"
          >
            <input type="checkbox" class="sr-only" :checked="isSelected(p.id)" />
            ✓
          </label>
          <button
            v-if="!batchMode"
            class="absolute right-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-md bg-white/90 text-xs shadow ring-1 ring-stone-200 hover:bg-white"
            title="加入分组"
            @click.stop="toggleGroupMenu(p.id)"
          >
            📁
          </button>
          <div
            v-if="groupMenuId === p.id"
            class="absolute right-2 top-9 z-20 w-44 rounded-xl bg-white p-2 shadow-lg ring-1 ring-stone-200"
            @click.stop
          >
            <div class="max-h-40 space-y-0.5 overflow-auto">
              <label
                v-for="g in store.state.groups"
                :key="g.id"
                class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-stone-50"
              >
                <input
                  type="checkbox"
                  class="h-3.5 w-3.5 accent-brand-500"
                  :checked="inGroup(g.id, p.id)"
                  @change="togglePatternInGroup(g, p)"
                />
                {{ g.name }}
              </label>
              <p v-if="!store.state.groups.length" class="px-2 py-1 text-[11px] text-stone-400">还没有分组，先在顶部新建一个</p>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="card p-10 text-center text-sm text-stone-400">
        <template v-if="activeGroup === 'all'">还没有保存过图纸，试试用图片生成一张</template>
        <template v-else>该分组下没有图纸</template>
        <router-link to="/generator" class="mt-3 block font-medium text-brand-500 hover:underline">去图片转图纸 →</router-link>
      </div>
    </template>
  </div>

  <!-- 新建 / 重命名分组弹窗 -->
  <div v-if="groupModal" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="groupModal = false">
    <div class="w-[320px] rounded-2xl bg-white p-5 shadow-xl">
      <h3 class="text-base font-semibold text-stone-800">{{ groupModalMode === 'create' ? '新建分组' : '重命名分组' }}</h3>
      <p v-if="groupModalMode === 'create'" class="mt-1 text-xs text-stone-400">给一组图纸起个名字，方便按组查看。</p>
      <input
        v-model="groupModalName"
        class="input mt-3 w-full"
        placeholder="分组名称"
        @keydown.enter="submitGroupModal"
      />
      <div class="mt-5 flex justify-end gap-2">
        <button class="btn btn-secondary" @click="groupModal = false">取消</button>
        <button class="btn btn-primary" :disabled="!groupModalName.trim()" @click="submitGroupModal">确定</button>
      </div>
    </div>
  </div>
</template>
