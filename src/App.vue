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
  { to: '/', label: '图纸库', icon: '🏠' },
  { to: '/generator', label: '图片转图纸', icon: '🖼️' },
  { to: '/palette', label: '色卡', icon: '🎨' },
  { to: '/warehouse', label: '豆仓', icon: '📦' },
  { to: '/mine', label: '我的', icon: '🙋' }
]
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="no-print sticky top-0 z-40 border-b border-stone-200/70 bg-white/85 backdrop-blur">
      <div class="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
        <router-link to="/" class="flex shrink-0 items-center gap-2.5">
          <span class="grid h-9 w-9 place-items-center rounded-xl bg-brand-500 text-xl text-white shadow-sm">🧩</span>
          <span class="text-xl font-bold tracking-wide text-stone-800">
            拼豆<span class="text-brand-500">工坊</span>
          </span>
        </router-link>

        <nav class="hidden items-center gap-1 md:flex">
          <router-link
            v-for="n in navs"
            :key="n.to"
            :to="n.to"
            class="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[15px] font-medium text-stone-600 transition hover:bg-brand-50 hover:text-brand-600"
            active-class="!text-brand-600 !bg-brand-50 font-semibold"
          >
            <span class="text-base leading-none">{{ n.icon }}</span>
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
          class="flex items-center gap-2 rounded-lg px-3 py-2.5 text-[15px] font-medium text-stone-700 hover:bg-brand-50 hover:text-brand-600"
        >
          <span class="text-base leading-none">{{ n.icon }}</span>
          {{ n.label }}
        </router-link>
      </div>
    </header>

    <main class="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
      <router-view />
    </main>

    <footer class="no-print border-t border-stone-200 bg-white">
      <div class="mx-auto max-w-7xl px-4 py-6 text-center text-xs text-stone-400">
        <p>🧩 拼豆工坊</p>
      </div>
    </footer>
  </div>
</template>