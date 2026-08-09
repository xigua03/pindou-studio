<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useConfig } from '../composables/useConfig'

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const config = useConfig()
onMounted(() => {
  config.loadConfig()
})

const mode = ref<'login' | 'register'>('login')
const account = ref('')
const password = ref('')
const username = ref('')
const email = ref('')
const confirm = ref('')
const loading = ref(false)
const error = ref('')

function switchMode(m: 'login' | 'register') {
  mode.value = m
  error.value = ''
}

async function submit() {
  error.value = ''
  if (mode.value === 'login') {
    if (!account.value.trim() || !password.value) {
      error.value = '请输入账号和密码'
      return
    }
  } else {
    if (!config.state.registerOpen) {
      error.value = '当前未开放注册，请联系管理员'
      return
    }
    const uname = username.value.trim()
    const em = email.value.trim()
    if (uname.length < 2 || uname.length > 24) {
      error.value = '用户名需为 2~24 个字符'
      return
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
      error.value = '邮箱格式不正确'
      return
    }
    if (password.value.length < 6) {
      error.value = '密码至少 6 位'
      return
    }
    if (password.value !== confirm.value) {
      error.value = '两次输入的密码不一致'
      return
    }
  }

  loading.value = true
  try {
    if (mode.value === 'login') {
      await auth.login(account.value.trim(), password.value)
    } else {
      await auth.register(username.value.trim(), email.value.trim(), password.value)
    }
    // 登录后把本地数据同步到云端（尽力而为，失败不阻塞）
    try {
      await auth.syncNow()
    } catch {
      /* 忽略同步失败 */
    }
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/profile'
    router.replace(redirect)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-md py-6">
    <div class="card overflow-hidden">
      <!-- 顶部 -->
      <div class="bg-gradient-to-br from-brand-50 to-sun-400/30 px-6 py-8 text-center">
        <div class="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-500 text-3xl text-white shadow-md">🧩</div>
        <h1 class="mt-3 text-xl font-bold text-stone-800">拼豆工坊</h1>
        <p class="mt-1 text-sm text-stone-500">登录后可跨设备同步图纸、收藏与豆仓库存</p>
      </div>

      <!-- Tab -->
      <div class="grid grid-cols-2 border-b border-stone-100">
        <button
          class="py-3 text-sm font-semibold transition"
          :class="mode === 'login' ? 'text-brand-600 border-b-2 border-brand-500' : 'text-stone-400 hover:text-stone-600'"
          @click="switchMode('login')"
        >
          登录
        </button>
        <button
          class="py-3 text-sm font-semibold transition"
          :class="mode === 'register' ? 'text-brand-600 border-b-2 border-brand-500' : 'text-stone-400 hover:text-stone-600'"
          @click="switchMode('register')"
        >
          注册
        </button>
      </div>

      <form class="space-y-4 p-6" @submit.prevent="submit">
        <div
          v-if="mode === 'register' && !config.state.registerOpen"
          class="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700"
        >
          ⚠️ 当前未开放注册，只能登录已有账号。
        </div>
        <!-- 注册 -->
        <template v-if="mode === 'register'">
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">用户名</label>
            <input v-model="username" class="input" placeholder="2~24 位，可含中文/字母/数字/下划线" autocomplete="username" />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">邮箱</label>
            <input v-model="email" type="email" class="input" placeholder="you@example.com" autocomplete="email" />
          </div>
        </template>

        <!-- 登录 -->
        <template v-else>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">账号</label>
            <input v-model="account" class="input" placeholder="用户名或邮箱" autocomplete="username" />
          </div>
        </template>

        <div>
          <label class="mb-1.5 block text-xs font-medium text-stone-500">密码</label>
          <input
            v-model="password"
            type="password"
            class="input"
            :placeholder="mode === 'register' ? '至少 6 位' : '请输入密码'"
            autocomplete="current-password"
          />
        </div>
        <div v-if="mode === 'register'">
          <label class="mb-1.5 block text-xs font-medium text-stone-500">确认密码</label>
          <input
            v-model="confirm"
            type="password"
            class="input"
            placeholder="再输入一次密码"
            autocomplete="new-password"
          />
        </div>

        <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ error }}</p>

        <button class="btn btn-primary w-full !py-2.5 text-[15px]" :disabled="loading">
          {{ loading ? '请稍候…' : mode === 'login' ? '登 录' : '注 册' }}
        </button>

        <p class="text-center text-xs text-stone-400">
          <template v-if="mode === 'login'">
            还没有账号？
            <a class="cursor-pointer font-medium text-brand-500 hover:underline" @click="switchMode('register')">立即注册</a>
          </template>
          <template v-else>
            已有账号？
            <a class="cursor-pointer font-medium text-brand-500 hover:underline" @click="switchMode('login')">去登录</a>
          </template>
        </p>
      </form>
    </div>

    <p class="mt-4 text-center text-xs leading-5 text-stone-400">登录后即可开启跨设备云同步。</p>
  </div>
</template>
