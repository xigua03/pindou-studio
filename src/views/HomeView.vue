<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { patternBeadCount, patternDifficulty } from '../data/patterns'
import { PALETTES, getPalette } from '../data/palettes'
import { useStore } from '../composables/useStore'
import { useConfig } from '../composables/useConfig'
import PatternCard from '../components/PatternCard.vue'

const store = useStore()
const config = useConfig()

// 每次进入图纸库都刷新服务端图纸（采集到的新图纸无需整页刷新即可出现）
onMounted(() => {
  store.loadServerPatterns()
})
const galleryOff = computed(() => config.state.loaded && !config.featureEnabled('gallery'))
const keyword = ref('')
const activeGroup = ref('全部')
const groupsCollapsed = ref(true)
const MAX_GROUPS = 6

// 一级分类：把零散标签归组，避免标签太多，可展开/收缩
const GROUP_KEYWORDS: { name: string; kw: string[] }[] = [
  { name: '动物', kw: ['动物', '猫', '熊猫', '狐狸', '恐龙', '昆虫', 'animal', 'animals', 'cat', 'budgie', 'pokemon', 'eevee', 'eeveelution', 'bird', 'dog', 'rabbit', 'bear', 'horse', 'fish', 'turtle'] },
  { name: '卡通动漫', kw: ['卡通', '动漫', '三丽鸥', '可爱', '童话', 'cartoon', 'anime', 'kawaii', 'cute', 'character', 'hello kitty', 'sanrio', 'kitty'] },
  { name: '游戏', kw: ['游戏', '马里奥', '宝可梦', '世界杯', '足球', 'game', 'video game', 'videogame', 'sprites', 'minecraft', 'mario', 'nintendo'] },
  { name: '食物', kw: ['食物', '水果', '蔬菜', '甜点', 'food', 'fruit', 'cake', 'dessert', 'strawberry', 'drink', 'ice cream'] },
  { name: '节日', kw: ['节日', '圣诞', '万圣节', '新年', '马年', '骏马', 'holiday', 'christmas', 'halloween', 'new year', 'valentine', 'easter'] },
  { name: '植物自然', kw: ['植物', '花', '蘑菇', '森林', 'flower', 'plant', 'nature', 'mushroom', 'tree', 'leaf', 'garden'] },
  { name: '风景天空', kw: ['风景', '天空', '星球', '太空', '彩虹', '太阳', '星星', 'sky', 'space', 'star', 'sun', 'rainbow', 'universe'] }
]

function groupsOf(p: { tags?: string[] }): string[] {
  const tags = (p.tags ?? []).map((t) => String(t).toLowerCase())
  const out: string[] = []
  for (const g of GROUP_KEYWORDS) {
    if (tags.some((t) => g.kw.some((k) => t === k || t.includes(k)))) out.push(g.name)
  }
  return out
}
// D19：难度 / 豆数筛选
const activeDiff = ref('全部')
const diffOptions = ['全部', '简单', '中等', '复杂']
const beadRange = ref('全部')
const beadRanges = ['全部', '500颗以下', '500~2000颗', '2000颗以上']

const groups = computed(() => {
  const map = new Map<string, number>()
  for (const p of store.galleryPatterns()) {
    for (const g of groupsOf(p)) map.set(g, (map.get(g) || 0) + 1)
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
})
const visibleGroups = computed(() => (groupsCollapsed.value ? groups.value.slice(0, MAX_GROUPS) : groups.value))
const hiddenGroupCount = computed(() => Math.max(0, groups.value.length - MAX_GROUPS))

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return store.galleryPatterns().filter((p) => {
    const matchGroup = activeGroup.value === '全部' || groupsOf(p).includes(activeGroup.value)
    if (!matchGroup) return false
    const diff = activeDiff.value
    if (diff !== '全部' && patternDifficulty(p) !== diff) return false
    const n = patternBeadCount(p)
    const br = beadRange.value
    if (br === '500颗以下' && n >= 500) return false
    if (br === '500~2000颗' && (n < 500 || n > 2000)) return false
    if (br === '2000颗以上' && n <= 2000) return false
    if (!kw) return true
    return (
      p.name.toLowerCase().includes(kw) ||
      p.tags.some((t) => t.toLowerCase().includes(kw)) ||
      (p.description ?? '').toLowerCase().includes(kw)
    )
  })
})

// 分页：默认每页 16 张，可切换每页数量；筛选变化时回到第 1 页
const pageSizeOptions = [16, 24, 32, 48]
const pageSize = ref(16)
const page = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))
const pagedList = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const pageNumbers = computed(() => {
  const n = totalPages.value
  const cur = page.value
  const start = Math.max(1, Math.min(cur - 2, n - 4))
  const end = Math.min(n, start + 4)
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
})
function goPage(p: number) {
  page.value = Math.max(1, Math.min(p, totalPages.value))
}
watch([keyword, activeGroup, activeDiff, beadRange, pageSize], () => {
  page.value = 1
})

const totalColors = computed(() => PALETTES.reduce((s, p) => s + p.count, 0))
const favCount = computed(() => store.state.favorites.length)
</script>

<template>
  <div class="space-y-6">
    <div v-if="galleryOff" class="card p-16 text-center">
      <p class="text-4xl">🚧</p>
      <h2 class="mt-3 text-lg font-bold text-stone-700">图纸库功能已关闭</h2>
      <p class="mt-1 text-sm text-stone-400">管理员已关闭图纸库，请稍后再来，或使用顶部其他功能。</p>
    </div>

    <template v-else>
    <!-- Hero -->
    <section class="card relative overflow-hidden bg-gradient-to-br from-brand-500 via-brand-400 to-sun-400 p-6 text-white sm:p-10">
      <div class="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/10"></div>
      <div class="pointer-events-none absolute right-16 bottom-[-24px] h-32 w-32 rounded-full bg-white/10"></div>
      <h1 class="text-2xl font-bold sm:text-3xl">把喜欢的图片，变成一颗一颗的拼豆</h1>
      <p class="mt-2 max-w-xl text-sm text-white/90 sm:text-base">
        自带 6 大品牌色卡，图纸库持续更新（当前 {{ store.galleryPatterns().length }} 张）；图片一键转图纸、豆仓库存、色号查询全部免费。
      </p>

      <div class="mt-5 flex max-w-md items-center gap-2 rounded-2xl bg-white p-1.5 shadow-sm">
        <svg class="ml-2 h-5 w-5 shrink-0 text-stone-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
        </svg>
        <input
          v-model="keyword"
          type="search"
          placeholder="搜索图纸，如：动物、草莓、节日…"
          class="w-full bg-transparent py-1.5 text-sm text-stone-800 outline-none placeholder:text-stone-400"
        />
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        <router-link to="/generator" class="btn bg-white !text-brand-600 shadow-sm hover:bg-brand-50">🖼️ 图片转图纸</router-link>
        <router-link to="/palette" class="btn bg-white/20 text-white ring-1 ring-white/40 hover:bg-white/30">🎨 查看色卡</router-link>
        <router-link to="/warehouse" class="btn bg-white/20 text-white ring-1 ring-white/40 hover:bg-white/30">📦 管理豆仓</router-link>
      </div>
    </section>

    <!-- Stats -->
    <section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="card p-4 text-center">
        <p class="text-2xl font-bold text-brand-500">{{ store.galleryPatterns().length }}</p>
        <p class="mt-1 text-xs text-stone-400">图纸总数</p>
      </div>
      <div class="card p-4 text-center">
        <p class="text-2xl font-bold text-brand-500">{{ PALETTES.length }}</p>
        <p class="mt-1 text-xs text-stone-400">品牌色卡</p>
      </div>
      <div class="card p-4 text-center">
        <p class="text-2xl font-bold text-brand-500">{{ totalColors }}</p>
        <p class="mt-1 text-xs text-stone-400">色号总数</p>
      </div>
      <div class="card p-4 text-center">
        <p class="text-2xl font-bold text-brand-500">{{ favCount }}</p>
        <p class="mt-1 text-xs text-stone-400">我的收藏</p>
      </div>
    </section>

    <!-- Gallery -->
    <section>
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <span class="mr-1 text-xs font-medium text-stone-400">分类</span>
        <button
          class="chip"
          :class="activeGroup === '全部' ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200 hover:bg-stone-50'"
          @click="activeGroup = '全部'"
        >
          全部
        </button>
        <button
          v-for="g in visibleGroups"
          :key="g.name"
          class="chip"
          :class="activeGroup === g.name ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200 hover:bg-stone-50'"
          @click="activeGroup = g.name"
        >
          {{ g.name }}<span class="ml-1 text-[10px] opacity-70">{{ g.count }}</span>
        </button>
        <button
          v-if="hiddenGroupCount > 0"
          class="chip bg-stone-100 text-stone-500 ring-stone-200"
          @click="groupsCollapsed = !groupsCollapsed"
        >
          {{ groupsCollapsed ? '更多分类 ▾' : '收起分类 ▴' }}
        </button>
      </div>

      <div class="mb-3 flex flex-wrap items-center gap-2">
        <span class="mr-1 text-xs font-medium text-stone-400">难度</span>
        <button
          v-for="d in diffOptions"
          :key="d"
          class="chip"
          :class="activeDiff === d ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200 hover:bg-stone-50'"
          @click="activeDiff = d"
        >
          {{ d }}
        </button>
        <span class="mx-1 text-stone-200">|</span>
        <span class="mr-1 text-xs font-medium text-stone-400">豆数</span>
        <select v-model="beadRange" class="input !w-32 !py-1 text-xs">
          <option v-for="r in beadRanges" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>

      <div v-if="pagedList.length" class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <PatternCard
          v-for="p in pagedList"
          :key="p.id"
          :pattern="p"
          :palette="getPalette(p.paletteId)!"
        />
      </div>
      <div v-else class="card p-10 text-center text-sm text-stone-400">
        没有找到匹配的图纸，换个关键词或标签试试～
      </div>

      <div v-if="totalPages > 1" class="mt-6 flex flex-wrap items-center justify-center gap-1.5">
        <span class="mr-2 text-xs text-stone-400">共 {{ filtered.length }} 张 · 第 {{ page }}/{{ totalPages }} 页</span>
        <label class="flex items-center gap-1.5 text-xs text-stone-400">
          每页
          <select v-model.number="pageSize" class="input !w-16 !px-1.5 !py-1 text-xs">
            <option v-for="n in pageSizeOptions" :key="n" :value="n">{{ n }}</option>
          </select>
          张
        </label>
        <button class="chip !px-3" :disabled="page <= 1" @click="goPage(page - 1)">‹ 上一页</button>
        <button
          v-for="n in pageNumbers"
          :key="n"
          class="chip !px-3"
          :class="page === n ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-stone-500 ring-stone-200 hover:bg-stone-50'"
          @click="goPage(n)"
        >
          {{ n }}
        </button>
        <button class="chip !px-3" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页 ›</button>
      </div>
    </section>
    </template>
  </div>
</template>