<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const menuOpen = ref(false)
watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false
  }
)

const navs = [
  { to: '/', label: '图纸库' },
  { to: '/generator', label: '图片转图纸' },
  { to: '/palette', label: '色卡' },
  { to: '/warehouse', label: '豆仓' },
  { to: '/mine', label: '我的' }
]
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="no-print sticky top-0 z-40 border-b border-stone-200/70 bg-white/85 backdrop-blur">
      <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <router-link to="/" class="flex items-center gap-2">
          <span class="grid h-8 w-8 place-items-center rounded-xl bg-brand-500 text-lg text-white shadow-sm">🧩</span>
          <span class="text-lg font-bold tracking-wide text-stone-800">
            拼豆<span class="text-brand-500">工坊</span>
          </span>
        </router-link>

        <nav class="hidden items-center gap-1 md:flex">
          <router-link
            v-for="n in navs"
            :key="n.to"
            :to="n.to"
            class="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 transition hover:bg-brand-50 hover:text-brand-600"
            active-class="!text-brand-600 !bg-brand-50 font-semibold"
          >
            {{ n.label }}
          </router-link>
        </nav>

        <button class="btn btn-ghost md:hidden" aria-label="菜单" @click="menuOpen = !menuOpen">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      <div v-if="menuOpen" class="border-t border-stone-100 bg-white px-4 py-2 md:hidden">
        <router-link
          v-for="n in navs"
          :key="n.to"
          :to="n.to"
          class="block rounded-lg px-3 py-2 text-sm font-medium text-stone-700 hover:bg-brand-50 hover:text-brand-600"
        >
          {{ n.label }}
        </router-link>
      </div>
    </header>

    <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <router-view />
    </main>

    <footer class="no-print border-t border-stone-200 bg-white">
      <div class="mx-auto max-w-6xl px-4 py-8 text-center text-xs leading-6 text-stone-400">
        <p class="font-medium text-stone-500">拼豆工坊 · 免费在线拼豆图纸工具，无需登录，数据仅保存在本地浏览器</p>
        <p>
          功能参考 dg.idouge.com「豆格」 · 色卡数据来自
          <a class="text-brand-500 hover:underline" href="https://github.com/HansBug/pindou-color-data" target="_blank" rel="noopener">HansBug/pindou-color-data</a>
          · 基于 Vue 3 + Vite + Tailwind CSS 构建
        </p>
      </div>
    </footer>
  </div>
</template>