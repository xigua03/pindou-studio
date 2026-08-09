<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useConfig } from './composables/useConfig'
import { useStore } from './composables/useStore'
import { useAuth } from './composables/useAuth'
import { loadServerPalettes } from './data/palettes'

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const { isLoggedIn, isAdmin } = auth
const config = useConfig()
const store = useStore()
const menuOpen = ref(false)
const userMenuOpen = ref(false)
const userMenuRef = ref<HTMLElement | null>(null)
const headerRef = ref<HTMLElement | null>(null)
function onDocClick(e: MouseEvent) {
  const t = e.target as Node
  if (userMenuOpen.value && userMenuRef.value && !userMenuRef.value.contains(t)) {
    userMenuOpen.value = false
  }
  if (menuOpen.value && headerRef.value && !headerRef.value.contains(t)) {
    menuOpen.value = false
  }
}
// 深色模式：localStorage 持久化，初始值已在 index.html 中提前设置到 <html data-theme>
const theme = ref<'light' | 'dark'>(
  typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
)
const appVersion = '1.2.0'
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', theme.value)
  try {
    localStorage.setItem('pd_theme', theme.value)
  } catch {
    /* ignore */
  }
}
const isAdminRoute = computed(() => route.path.startsWith('/admin'))
watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false
    userMenuOpen.value = false
  }
)
onMounted(() => {
  auth.fetchMe()
  config.loadConfig()
  store.loadServerPatterns()
  loadServerPalettes()
  document.addEventListener('click', onDocClick)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
})

const navs = [
  { to: '/', label: '图纸库', icon: '🏠', feature: 'gallery' },
  { to: '/generator', label: '图片转图纸', icon: '🖼️', feature: 'generator' },
  { to: '/ai', label: 'AI 生成', icon: '🤖', feature: 'ai' },
  { to: '/palette', label: '色卡', icon: '🎨', feature: 'palette' },
  { to: '/warehouse', label: '豆仓', icon: '📦', feature: 'warehouse' },
  { to: '/mine', label: '我的', icon: '🙋' }
]
const visibleNavs = computed(() => navs.filter((n) => !n.feature || config.featureEnabled(n.feature as 'gallery')))

// 功能被关闭时，把当前路由重定向回首页
watch(
  [() => config.state.loaded, () => route.meta.feature],
  () => {
    const f = route.meta.feature as string | undefined
    if (f && config.state.loaded && !config.featureEnabled(f as 'gallery')) {
      router.replace('/')
    }
  },
  { immediate: true }
)

function logout() {
  auth.logout()
  userMenuOpen.value = false
  if (route.path === '/profile' || route.path === '/admin') {
    window.location.hash = '#/'
  }
}

</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header ref="headerRef" class="no-print sticky top-0 z-40 border-b border-stone-200/70 bg-white/85 backdrop-blur">
      <div class="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
        <router-link to="/" class="flex shrink-0 items-center gap-2.5">
          <span class="grid h-9 w-9 place-items-center rounded-xl bg-brand-500 text-xl text-white shadow-sm">🧩</span>
          <span class="text-xl font-bold tracking-wide text-stone-800">
            拼豆<span class="text-brand-500">工坊</span>
          </span>
        </router-link>

        <nav class="hidden items-center gap-1 md:flex">
          <router-link
            v-for="n in visibleNavs"
            :key="n.to"
            :to="n.to"
            class="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[15px] font-medium text-stone-600 transition hover:bg-brand-50 hover:text-brand-600"
            active-class="!text-brand-600 !bg-brand-50 font-semibold"
          >
            <span class="text-base leading-none">{{ n.icon }}</span>
            {{ n.label }}
          </router-link>
        </nav>

        <!-- 深色模式切换 -->
        <button
          class="btn btn-ghost !px-2.5 !py-2 text-lg"
          :title="theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'"
          @click="toggleTheme"
        >
          {{ theme === 'dark' ? '☀️' : '🌙' }}
        </button>

        <!-- 用户区 -->
        <div ref="userMenuRef" class="relative shrink-0">
          <template v-if="isLoggedIn">
            <button
              class="flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm transition hover:bg-stone-100"
              @click="userMenuOpen = !userMenuOpen"
            >
              <span class="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600">
                {{ (auth.state.user?.nickname || '我').slice(0, 1) }}
              </span>
              <span class="hidden max-w-[90px] truncate font-medium text-stone-700 sm:block">{{ auth.state.user?.nickname }}</span>
              <svg class="h-4 w-4 text-stone-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div
              v-if="userMenuOpen"
              class="absolute right-0 top-11 z-50 w-60 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-stone-200"
              @click.stop
            >
              <div class="flex items-center gap-2.5 rounded-lg px-3 py-2.5">
                <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600">
                  {{ (auth.state.user?.nickname || '我').slice(0, 1) }}
                </span>
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold text-stone-800">{{ auth.state.user?.nickname }}</p>
                  <p class="truncate text-xs text-stone-400">@{{ auth.state.user?.username }}</p>
                </div>
              </div>
              <div class="my-1 border-t border-stone-100"></div>
              <router-link to="/profile" class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-brand-50 hover:text-brand-600">
                <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg" :class="route.path === '/profile' ? 'bg-brand-50 text-brand-600' : 'bg-stone-100 text-stone-500'">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                </span>
                个人中心
              </router-link>
              <router-link
                v-if="isAdmin"
                to="/admin"
                class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-brand-50 hover:text-brand-600"
              >
                <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg" :class="route.path.startsWith('/admin') ? 'bg-brand-50 text-brand-600' : 'bg-stone-100 text-stone-500'">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </span>
                后台管理
              </router-link>
              <div class="my-1 border-t border-stone-100"></div>
              <button
                class="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-stone-700 hover:bg-red-50 hover:text-red-600"
                @click="logout"
              >
                <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-red-50 text-red-500">
                  <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                </span>
                退出登录
              </button>
            </div>
          </template>
          <template v-else>
            <router-link to="/login" class="btn btn-primary !px-4 !py-1.5">登录</router-link>
          </template>
        </div>

        <button class="btn btn-ghost md:hidden" aria-label="菜单" @click="menuOpen = !menuOpen">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      <div v-if="menuOpen" class="border-t border-stone-100 bg-white px-4 py-2 md:hidden">
        <router-link
          v-for="n in visibleNavs"
          :key="n.to"
          :to="n.to"
          class="flex items-center gap-2 rounded-lg px-3 py-2.5 text-[15px] font-medium text-stone-700 hover:bg-brand-50 hover:text-brand-600"
        >
          <span class="text-base leading-none">{{ n.icon }}</span>
          {{ n.label }}
        </router-link>
        <router-link
          :to="isLoggedIn ? '/profile' : '/login'"
          class="mt-1 flex items-center gap-2 rounded-lg border-t border-stone-100 px-3 py-2.5 text-[15px] font-medium text-stone-700 hover:bg-brand-50 hover:text-brand-600"
        >
          <span class="text-base leading-none">👤</span>
          {{ auth.isLoggedIn ? '个人中心' : '登录 / 注册' }}
        </router-link>
      </div>
    </header>

    <div v-if="config.state.maintenance" class="no-print bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
      ⚠️ 站点维护中，部分功能可能暂时不可用
    </div>
    <div v-if="config.state.siteNotice && !isAdminRoute" class="no-print border-b border-brand-100 bg-brand-50 px-4 py-2 text-center text-sm text-brand-700">
      {{ config.state.siteNotice }}
    </div>

    <main class="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
      <router-view />
    </main>

    <footer class="no-print border-t border-stone-200 bg-white">
      <div class="mx-auto max-w-7xl px-4 py-6 text-center text-xs text-stone-400">
        <p>🧩 拼豆工坊 <span class="ml-1 text-stone-300">v{{ appVersion }}</span></p>
      </div>
    </footer>
  </div>
</template>