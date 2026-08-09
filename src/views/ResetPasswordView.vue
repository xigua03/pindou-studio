<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../utils/api'

const route = useRoute()
const router = useRouter()

const token = computed(() => String(route.query.token || ''))
const email = computed(() => String(route.query.email || ''))
const hasParams = computed(() => !!token.value && !!email.value)

const password = ref('')
const confirm = ref('')
const msg = ref('')
const err = ref('')
const loading = ref(false)
const done = ref(false)

async function submit() {
  err.value = ''
  msg.value = ''
  if (password.value.length < 6) {
    err.value = '至少 6 位'
    return
  }
  if (password.value !== confirm.value) {
    err.value = '两次输入的密码不一致'
    return
  }
  loading.value = true
  try {
    await api<{ ok: boolean }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: token.value, email: email.value, password: password.value })
    })
    done.value = true
    msg.value = '密码重置成功，请使用新密码登录'
  } catch (e) {
    err.value = e instanceof Error ? e.message : '重置失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-md py-10">
    <div class="card overflow-hidden">
      <div class="bg-gradient-to-br from-brand-50 to-sun-400/30 px-6 py-8 text-center">
        <div class="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-500 text-3xl text-white shadow-md">🔐</div>
        <h1 class="mt-3 text-xl font-bold text-stone-800">重置密码</h1>
        <p class="mt-1 text-sm text-stone-500">设置新密码后可以使用新密码登录</p>
      </div>

      <div class="p-6">
        <template v-if="!hasParams">
          <p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">缺少必要参数，请从邮件中的链接进入。</p>
          <div class="mt-5 flex justify-center">
            <router-link to="/login" class="btn btn-primary">去登录</router-link>
          </div>
        </template>

        <template v-else-if="done">
          <p class="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">{{ msg }}</p>
          <div class="mt-5 flex justify-center">
            <router-link to="/login" class="btn btn-primary">去登录</router-link>
          </div>
        </template>

        <form v-else class="space-y-4" @submit.prevent="submit">
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">新密码</label>
            <input v-model="password" type="password" class="input w-full" placeholder="至少 6 位" autocomplete="new-password" />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">确认新密码</label>
            <input v-model="confirm" type="password" class="input w-full" placeholder="再输入一次新密码" autocomplete="new-password" @keydown.enter="submit" />
          </div>
          <p v-if="err" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ err }}</p>
          <button class="btn btn-primary w-full !py-2.5 text-[15px]" :disabled="loading">
            {{ loading ? '提交中…' : '提交' }}
          </button>
        </form>
      </div>
    </div>
    <p class="mt-4 text-center text-xs leading-5 text-stone-400">拼豆工坊 · 找回密码</p>
  </div>
</template>
