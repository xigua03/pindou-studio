<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth, type AiUsage, type User } from '../composables/useAuth'
import { api } from '../utils/api'

const router = useRouter()
const auth = useAuth()
const { isAdmin } = auth

const tab = ref<'profile' | 'password' | 'sync' | 'shares'>('profile')

// ---------- 资料 ----------
const nickname = ref('')
const bio = ref('')
const avatar = ref('')
const profileMsg = ref('')
const profileErr = ref('')
const saving = ref(false)

// ---------- 改密 ----------
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const pwdMsg = ref('')
const pwdErr = ref('')

// ---------- 注销账号弹窗 ----------
const showDeleteModal = ref(false)
const deletePwd = ref('')
const deleteMsg = ref('')
const deleting = ref(false)

// ---------- 云同步 ----------
const syncing = ref(false)
const syncMsg = ref('')

// ---------- AI 用量 ----------
const usage = ref<AiUsage | null>(null)

// ---------- 我的分享 ----------
interface MyShare {
  id: string
  visits: number
  expiresAt: number | null
  createdAt: number
  name: string
}
const shares = ref<MyShare[]>([])
const sharesMsg = ref('')

function fmtTime(t: number | null): string {
  if (!t) return '-'
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}

function initProfile() {
  const u = auth.state.user
  if (u) {
    nickname.value = u.nickname || u.username
    bio.value = u.bio || ''
    avatar.value = u.avatar || ''
  }
}

onMounted(async () => {
  await auth.fetchMe()
  initProfile()
  try {
    usage.value = await auth.aiUsage()
  } catch {
    /* 忽略 */
  }
  loadShares()
  loadPoints()
})

async function saveProfile() {
  profileErr.value = ''
  profileMsg.value = ''
  saving.value = true
  try {
    await auth.updateProfile({
      nickname: nickname.value.trim() || auth.state.user?.username,
      bio: bio.value.trim(),
      avatar: avatar.value.trim()
    })
    profileMsg.value = '资料已保存'
    initProfile()
  } catch (e) {
    profileErr.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function changePassword() {
  pwdErr.value = ''
  pwdMsg.value = ''
  if (!oldPassword.value || newPassword.value.length < 6) {
    pwdErr.value = '请输入原密码，新密码至少 6 位'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    pwdErr.value = '两次输入的新密码不一致'
    return
  }
  try {
    await auth.changePassword(oldPassword.value, newPassword.value)
    pwdMsg.value = '密码修改成功'
    oldPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (e) {
    pwdErr.value = e instanceof Error ? e.message : '修改失败'
  }
}

async function doSync() {
  syncing.value = true
  syncMsg.value = ''
  try {
    const r = await auth.syncNow()
    syncMsg.value = `同步完成：已合并 ${r.pushed} 条数据到云端，并拉回 ${r.pulled} 张云端图纸`
  } catch (e) {
    syncMsg.value = '同步失败：' + (e instanceof Error ? e.message : '网络异常，请稍后再试')
  } finally {
    syncing.value = false
  }
}

async function loadShares() {
  try {
    const data = await api<{ shares: MyShare[] }>('/shares/mine')
    shares.value = data.shares || []
  } catch {
    shares.value = []
  }
}

async function deleteShare(id: string) {
  if (!confirm(`确定删除分享链接 ${id} 吗？删除后该链接将失效。`)) return
  try {
    await api(`/share/${encodeURIComponent(id)}`, { method: 'DELETE' })
    shares.value = shares.value.filter((s) => s.id !== id)
    sharesMsg.value = `已删除分享 ${id}`
  } catch (e) {
    sharesMsg.value = '删除失败：' + (e instanceof Error ? e.message : '未知错误')
  }
}

function openDeleteModal() {
  deletePwd.value = ''
  deleteMsg.value = ''
  showDeleteModal.value = true
}

async function confirmDeleteAccount() {
  deleteMsg.value = ''
  if (!deletePwd.value) {
    deleteMsg.value = '请输入密码确认'
    return
  }
  deleting.value = true
  try {
    await auth.deleteAccount(deletePwd.value)
    showDeleteModal.value = false
    router.replace('/')
  } catch (e) {
    deleteMsg.value = e instanceof Error ? e.message : '未知错误'
  } finally {
    deleting.value = false
  }
}

// ---------- 签到 / 积分 ----------
interface PointsInfo {
  points: number
  streak: number
  lastCheckin: string | null
  canCheckin: boolean
  aiExtraToday: number
  checkinPoints: number
  checkinStreakBonus: number
  exchangeCost: number
  exchangeQuota: number
  aiDailyLimit: number
}
const pointsInfo = ref<PointsInfo | null>(null)
const pointsMsg = ref('')
const pointsErr = ref('')

async function loadPoints() {
  try {
    pointsInfo.value = await api<PointsInfo>('/points')
  } catch {
    /* 后端不可用 */
  }
}
async function doCheckin() {
  pointsErr.value = ''
  pointsMsg.value = ''
  try {
    const d = await api<{ gained: number; points: number; streak: number; bonus: number }>('/checkin', { method: 'POST' })
    pointsMsg.value = `签到成功！连续 ${d.streak} 天，+${d.gained} 积分${d.bonus ? `（连签奖励 +${d.bonus}）` : ''}`
    loadPoints()
    try { usage.value = await auth.aiUsage() } catch { /* ignore */ }
  } catch (e) {
    pointsErr.value = e instanceof Error ? e.message : '签到失败'
  }
}
async function doExchange() {
  pointsErr.value = ''
  pointsMsg.value = ''
  try {
    const d = await api<{ points: number; extraToday: number }>('/ai/exchange', { method: 'POST' })
    pointsMsg.value = `兑换成功！今日 AI 额度 +${d.extraToday} 次，剩余 ${d.points} 积分`
    loadPoints()
    try { usage.value = await auth.aiUsage() } catch { /* ignore */ }
  } catch (e) {
    pointsErr.value = e instanceof Error ? e.message : '兑换失败'
  }
}

function logout() {
  auth.logout()
  router.replace('/')
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-stone-800 sm:text-2xl">👤 个人中心</h1>
        <p class="mt-1 text-sm text-stone-500">管理账号资料、密码、AI 用量与跨设备同步</p>
      </div>
      <div class="flex items-center gap-2">
        <router-link v-if="isAdmin" to="/admin" class="btn btn-secondary">🛠 后台管理</router-link>
        <button class="btn btn-danger" @click="logout">🚪 退出登录</button>
      </div>
    </div>

    <!-- 用户卡片 -->
    <div class="card flex flex-wrap items-center gap-4 p-5">
      <div class="grid h-16 w-16 place-items-center rounded-2xl bg-brand-100 text-2xl font-bold text-brand-600">
        {{ (auth.state.user?.nickname || '我').slice(0, 1) }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-lg font-bold text-stone-800">{{ auth.state.user?.nickname }}</span>
          <span class="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-600 ring-1 ring-brand-100">
            {{ auth.state.user?.role === 'admin' ? '管理员' : '普通用户' }}
          </span>
        </div>
        <p class="mt-1 truncate text-sm text-stone-500">
          @{{ auth.state.user?.username }} · {{ auth.state.user?.email }}
        </p>
        <p class="mt-0.5 text-xs text-stone-400">
          注册于 {{ fmtTime(auth.state.user?.createdAt ?? null) }}
          <template v-if="auth.state.user?.lastLoginAt"> · 上次登录 {{ fmtTime(auth.state.user.lastLoginAt) }}</template>
        </p>
      </div>
      <div class="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-700">
        🤖 AI 今日已用 <b>{{ usage?.today ?? '-' }}</b> / {{ usage?.effectiveLimit ?? usage?.limit ?? '-' }} 次
        <p class="text-[11px] text-amber-500">累计 {{ usage?.total ?? 0 }} 次</p>
      </div>
    </div>

    <!-- 签到 / 积分 -->
    <div class="card p-5">
      <div class="flex flex-wrap items-center gap-4">
        <div class="shrink-0">
          <p class="text-xs text-stone-400">我的积分</p>
          <p class="text-3xl font-bold text-amber-600">{{ pointsInfo?.points ?? '-' }}</p>
          <p class="mt-0.5 text-[11px] text-stone-400">
            <template v-if="pointsInfo">连续签到 {{ pointsInfo.streak }} 天 · 今日 AI 额外 +{{ pointsInfo.aiExtraToday }} 次</template>
          </p>
        </div>
        <div class="min-w-0 flex-1 text-sm leading-6 text-stone-600">
          <p>🎁 每日签到 +{{ pointsInfo?.checkinPoints ?? 10 }} 积分（连续 7 天再 +{{ pointsInfo?.checkinStreakBonus ?? 5 }}）。</p>
          <p>⚡ {{ pointsInfo?.exchangeCost ?? 20 }} 积分兑换 {{ pointsInfo?.exchangeQuota ?? 5 }} 次当日 AI 生成额度。</p>
        </div>
        <div class="flex shrink-0 flex-col gap-2">
          <button class="btn btn-primary" :disabled="!pointsInfo?.canCheckin" @click="doCheckin">
            {{ pointsInfo?.canCheckin ? '🎁 每日签到' : '✅ 今日已签到' }}
          </button>
          <button class="btn btn-secondary" @click="doExchange">⚡ 积分兑换 AI 额度</button>
        </div>
      </div>
      <p v-if="pointsMsg" class="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600">{{ pointsMsg }}</p>
      <p v-if="pointsErr" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ pointsErr }}</p>
    </div>

    <!-- Tab -->
    <div class="flex flex-wrap gap-1 border-b border-stone-200">
      <button
        v-for="t in ([
          { id: 'profile', label: '📝 个人资料' },
          { id: 'password', label: '🔑 修改密码' },
          { id: 'sync', label: '☁️ 云同步' },
          { id: 'shares', label: '🔗 我的分享' }
        ] as const)"
        :key="t.id"
        class="rounded-t-lg px-4 py-2.5 text-sm font-medium transition"
        :class="tab === t.id ? 'border-b-2 border-brand-500 text-brand-600' : 'text-stone-400 hover:text-stone-600'"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- 资料 -->
    <section v-if="tab === 'profile'" class="card max-w-2xl space-y-4 p-5">
      <div>
        <label class="mb-1.5 block text-xs font-medium text-stone-500">昵称</label>
        <input v-model="nickname" class="input" maxlength="24" placeholder="展示给其他人的名字" />
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-medium text-stone-500">头像地址（可选）</label>
        <input v-model="avatar" class="input" placeholder="https://… 图片链接" />
        <p class="mt-1 text-[11px] text-stone-400">留空则使用昵称首字作为头像。</p>
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-medium text-stone-500">简介</label>
        <textarea v-model="bio" rows="3" class="input w-full resize-y" maxlength="200" placeholder="介绍一下自己"></textarea>
      </div>
      <p v-if="profileMsg" class="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600">{{ profileMsg }}</p>
      <p v-if="profileErr" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ profileErr }}</p>
      <div class="flex justify-end">
        <button class="btn btn-primary" :disabled="saving" @click="saveProfile">{{ saving ? '保存中…' : '保存资料' }}</button>
      </div>
    </section>

    <!-- 改密 -->
    <section v-if="tab === 'password'" class="card max-w-2xl space-y-4 p-5">
      <div>
        <label class="mb-1.5 block text-xs font-medium text-stone-500">原密码</label>
        <input v-model="oldPassword" type="password" class="input" autocomplete="current-password" />
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-medium text-stone-500">新密码</label>
        <input v-model="newPassword" type="password" class="input" autocomplete="new-password" placeholder="至少 6 位" />
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-medium text-stone-500">确认新密码</label>
        <input v-model="confirmPassword" type="password" class="input" autocomplete="new-password" />
      </div>
      <p v-if="pwdMsg" class="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600">{{ pwdMsg }}</p>
      <p v-if="pwdErr" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ pwdErr }}</p>
      <div class="flex justify-end">
        <button class="btn btn-primary" @click="changePassword">确认修改</button>
      </div>
    </section>

    <!-- 云同步 -->
    <section v-if="tab === 'sync'" class="card max-w-2xl space-y-4 p-5">
      <div class="rounded-xl bg-brand-50/60 p-4 text-sm leading-6 text-stone-600">
        <p class="font-semibold text-stone-800">☁️ 跨设备云同步</p>
        <p class="mt-1">
          把你本机的 <b>我的图纸 / 收藏 / 分组 / 豆仓库存</b> 同步到服务器，
          换台设备登录同一账号即可拉回来继续使用。合并规则：收藏取并集、图纸与分组按 id 合并（本地优先）、库存取最大数量。
        </p>
      </div>
      <p v-if="syncMsg" class="rounded-lg px-3 py-2 text-xs" :class="syncMsg.startsWith('同步失败') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'">
        {{ syncMsg }}
      </p>
      <div class="flex gap-2">
        <button class="btn btn-primary" :disabled="syncing" @click="doSync">
          {{ syncing ? '⏳ 同步中…' : '🔄 立即同步' }}
        </button>
      </div>
    </section>

    <!-- 我的分享 -->
    <section v-if="tab === 'shares'" class="card max-w-3xl space-y-3 p-5">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-stone-700">🔗 我生成的分享链接</h2>
        <button class="btn btn-secondary !py-1 text-xs" @click="loadShares">刷新</button>
      </div>
      <p v-if="sharesMsg" class="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600">{{ sharesMsg }}</p>
      <div v-if="shares.length" class="space-y-2">
        <div v-for="s in shares" :key="s.id" class="flex flex-wrap items-center gap-3 rounded-xl bg-stone-50 px-4 py-3 ring-1 ring-stone-200/60">
          <div class="min-w-0 flex-1">
            <router-link :to="'/share/' + s.id" class="font-mono text-sm font-semibold text-brand-600 hover:underline">#{{ s.id }}</router-link>
            <p class="mt-0.5 truncate text-xs text-stone-500">{{ s.name }}</p>
          </div>
          <div class="text-xs text-stone-400">
            <span class="mr-3">👁 {{ s.visits }}</span>
            <span class="mr-3" :class="s.expiresAt && s.expiresAt < Date.now() ? 'text-red-500' : ''">
              {{ s.expiresAt ? '到期 ' + fmtTime(s.expiresAt) : '永久有效' }}
            </span>
            <span>{{ fmtTime(s.createdAt) }}</span>
          </div>
          <button class="btn btn-danger !px-3 !py-1 text-xs" @click="deleteShare(s.id)">删除</button>
        </div>
      </div>
      <p v-else class="py-6 text-center text-sm text-stone-400">还没有生成过分享链接，去图纸详情页点「分享」试试。</p>
    </section>

    <!-- 危险区 -->
    <section class="card max-w-2xl border-red-100 p-5">
      <h2 class="text-sm font-semibold text-red-600">⚠️ 危险操作</h2>
      <p class="mt-1 text-xs text-stone-500">注销账号将永久删除云端数据（本机保存的数据不受影响）。</p>
      <div class="mt-3">
        <button class="btn btn-danger" @click="openDeleteModal">注销账号</button>
      </div>
    </section>

    <!-- 注销账号确认弹窗 -->
    <div v-if="showDeleteModal" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="showDeleteModal = false">
      <div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <div class="flex items-start gap-3">
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 text-xl">⚠️</div>
          <div class="min-w-0 flex-1">
            <h3 class="text-base font-semibold text-stone-800">确定要注销账号吗？</h3>
            <p class="mt-1 text-xs leading-5 text-stone-500">此操作会<strong class="text-red-600">永久删除账号及云端数据</strong>（本机保存的数据不受影响），且无法恢复。</p>
          </div>
        </div>
        <div class="mt-4">
          <label class="mb-1 block text-xs font-medium text-stone-500">请输入登录密码确认</label>
          <input v-model="deletePwd" type="password" class="input" placeholder="登录密码" @keydown.enter="confirmDeleteAccount" />
        </div>
        <p v-if="deleteMsg" class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ deleteMsg }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn btn-secondary" :disabled="deleting" @click="showDeleteModal = false">取消</button>
          <button class="btn btn-danger" :disabled="deleting" @click="confirmDeleteAccount">
            {{ deleting ? '注销中…' : '确认注销' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
