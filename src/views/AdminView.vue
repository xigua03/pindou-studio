<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { api } from '../utils/api'

const router = useRouter()
const auth = useAuth()

const tab = ref<'dashboard' | 'users' | 'patterns' | 'shares' | 'ai' | 'feedback' | 'settings' | 'logs'>('dashboard')
const loading = ref(false)
const err = ref('')

// ---------- 仪表盘 ----------
interface Stats {
  users: number
  patterns: number
  userPatterns: number
  shares: number
  shareVisits: number
  aiTotal: number
  aiToday: number
  feedbackOpen: number
  logsToday: number
  trend: { date: string; count: number }[]
}
const stats = ref<Stats | null>(null)

// ---------- 通用分页 ----------
function pageInfo(total: number, size: number, page: number) {
  const pages = Math.max(1, Math.ceil(total / size))
  return { pages, page: Math.min(page, pages) }
}

// ---------- 用户 ----------
interface AdminUser {
  id: number
  username: string
  email: string
  nickname: string
  role: string
  status: string
  createdAt: number
  lastLoginAt: number | null
}
const users = ref<AdminUser[]>([])
const userTotal = ref(0)
const userPage = ref(1)
const userSize = ref(15)
const userSearch = ref('')

// ---------- 图纸 ----------
interface AdminPattern {
  id: string
  name: string
  paletteId: string
  width: number
  height: number
  status: string
  isBuiltin: boolean
  difficulty: string | null
  beadCount: number
  userId: number | null
  createdAt: number
}
const patterns = ref<AdminPattern[]>([])
const patternTotal = ref(0)
const patternPage = ref(1)
const patternSize = ref(15)
const patternSearch = ref('')
const patternStatus = ref('')

// ---------- 分享 ----------
interface AdminShare {
  id: string
  userId: number | null
  visits: number
  expiresAt: number | null
  createdAt: number
  name: string
}
const shares = ref<AdminShare[]>([])
const shareTotal = ref(0)
const sharePage = ref(1)
const shareSize = ref(15)
const shareSearch = ref('')

// ---------- AI 用量 ----------
interface AiRow {
  id: number
  userId: number | null
  prompt: string
  model: string
  status: string
  createdAt: number
}
const aiRows = ref<AiRow[]>([])
const aiTotal = ref(0)
const aiPage = ref(1)
const aiSize = ref(15)

// ---------- 反馈 ----------
interface FeedbackRow {
  id: number
  userId: number | null
  content: string
  contact: string
  status: string
  reply: string
  createdAt: number
}
const feedback = ref<FeedbackRow[]>([])
const feedbackTotal = ref(0)
const feedbackPage = ref(1)
const feedbackSize = ref(15)
const feedbackStatus = ref('')

// ---------- 日志 ----------
interface LogRow {
  id: number
  userId: number | null
  action: string
  detail: string
  ip: string
  createdAt: number
}
const logs = ref<LogRow[]>([])
const logTotal = ref(0)
const logPage = ref(1)
const logSize = ref(15)

// ---------- 设置 ----------
const settings = ref({ siteNotice: '', aiEnabled: true, aiDailyLimit: 50, maintenance: false })
const settingsMsg = ref('')

function fmtTime(t: number | null): string {
  if (!t) return '-'
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}

async function run(fn: () => Promise<void>) {
  loading.value = true
  err.value = ''
  try {
    await fn()
  } catch (e) {
    err.value = e instanceof Error ? e.message : '请求失败'
  } finally {
    loading.value = false
  }
}

function switchTab(t: typeof tab.value) {
  tab.value = t
  err.value = ''
  if (t === 'dashboard') loadStats()
  else if (t === 'users') loadUsers()
  else if (t === 'patterns') loadPatterns()
  else if (t === 'shares') loadShares()
  else if (t === 'ai') loadAi()
  else if (t === 'feedback') loadFeedback()
  else if (t === 'settings') loadSettings()
  else if (t === 'logs') loadLogs()
}

async function loadStats() {
  await run(async () => {
    stats.value = await api<Stats>('/admin/stats')
  })
}

async function loadUsers() {
  await run(async () => {
    const q = new URLSearchParams({ search: userSearch.value, page: String(userPage.value), size: String(userSize.value) })
    const data = await api<{ total: number; users: AdminUser[] }>('/admin/users?' + q.toString())
    userTotal.value = data.total
    users.value = data.users
  })
}

async function toggleUser(u: AdminUser, field: 'role' | 'status') {
  const next = field === 'role' ? (u.role === 'admin' ? 'user' : 'admin') : u.status === 'active' ? 'banned' : 'active'
  const label = field === 'role' ? (next === 'admin' ? '设为管理员' : '取消管理员') : next === 'banned' ? '封禁' : '解封'
  if (!confirm(`确定对 ${u.username} 执行「${label}」吗？`)) return
  try {
    await api(`/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ [field]: next }) })
    loadUsers()
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作失败')
  }
}

async function resetPassword(u: AdminUser) {
  const pwd = prompt(`为 ${u.username} 设置新密码（至少 6 位）：`, '123456')
  if (!pwd) return
  try {
    await api(`/admin/users/${u.id}/reset-password`, { method: 'POST', body: JSON.stringify({ password: pwd }) })
    alert('密码已重置')
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作失败')
  }
}

async function loadPatterns() {
  await run(async () => {
    const q = new URLSearchParams({ search: patternSearch.value, page: String(patternPage.value), size: String(patternSize.value) })
    if (patternStatus.value) q.set('status', patternStatus.value)
    const data = await api<{ total: number; patterns: AdminPattern[] }>('/admin/patterns?' + q.toString())
    patternTotal.value = data.total
    patterns.value = data.patterns
  })
}

async function togglePatternStatus(p: AdminPattern) {
  const next = p.status === 'published' ? 'hidden' : 'published'
  try {
    await api(`/admin/patterns/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: JSON.stringify({ status: next }) })
    loadPatterns()
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作失败')
  }
}

async function editPattern(p: AdminPattern) {
  const name = prompt('图纸名称：', p.name)
  if (name === null) return
  const diff = prompt('难度（简单/中等/复杂，留空不修改）：', p.difficulty || '')
  try {
    await api(`/admin/patterns/${encodeURIComponent(p.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: name.trim() || p.name, difficulty: diff && diff.trim() ? diff.trim() : p.difficulty })
    })
    loadPatterns()
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作失败')
  }
}

async function deletePattern(p: AdminPattern) {
  if (p.isBuiltin) {
    alert('内置图纸不能删除，可改为下架')
    return
  }
  if (!confirm(`确定删除图纸「${p.name}」（${p.id}）吗？`)) return
  try {
    await api(`/admin/patterns/${encodeURIComponent(p.id)}`, { method: 'DELETE' })
    loadPatterns()
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作失败')
  }
}

async function loadShares() {
  await run(async () => {
    const q = new URLSearchParams({ search: shareSearch.value, page: String(sharePage.value), size: String(shareSize.value) })
    const data = await api<{ total: number; shares: AdminShare[] }>('/admin/shares?' + q.toString())
    shareTotal.value = data.total
    shares.value = data.shares
  })
}

async function deleteShare(s: AdminShare) {
  if (!confirm(`确定删除分享链接 ${s.id} 吗？`)) return
  try {
    await api(`/admin/shares/${encodeURIComponent(s.id)}`, { method: 'DELETE' })
    loadShares()
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作失败')
  }
}

async function loadAi() {
  await run(async () => {
    const q = new URLSearchParams({ page: String(aiPage.value), size: String(aiSize.value) })
    const data = await api<{ total: number; usage: AiRow[] }>('/admin/ai-usage?' + q.toString())
    aiTotal.value = data.total
    aiRows.value = data.usage
  })
}

async function loadFeedback() {
  await run(async () => {
    const q = new URLSearchParams({ page: String(feedbackPage.value), size: String(feedbackSize.value) })
    if (feedbackStatus.value) q.set('status', feedbackStatus.value)
    const data = await api<{ total: number; feedback: FeedbackRow[] }>('/admin/feedback?' + q.toString())
    feedbackTotal.value = data.total
    feedback.value = data.feedback
  })
}

async function updateFeedback(f: FeedbackRow) {
  const reply = prompt('回复内容（可留空）：', f.reply || '')
  if (reply === null) return
  try {
    await api(`/admin/feedback/${f.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ reply, status: reply ? 'closed' : f.status })
    })
    loadFeedback()
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作失败')
  }
}

async function loadLogs() {
  await run(async () => {
    const q = new URLSearchParams({ page: String(logPage.value), size: String(logSize.value) })
    const data = await api<{ total: number; logs: LogRow[] }>('/admin/logs?' + q.toString())
    logTotal.value = data.total
    logs.value = data.logs
  })
}

async function loadSettings() {
  await run(async () => {
    settings.value = await api<typeof settings.value>('/admin/settings')
  })
}

async function saveSettings() {
  try {
    await api('/admin/settings', { method: 'PUT', body: JSON.stringify(settings.value) })
    settingsMsg.value = '设置已保存'
    setTimeout(() => (settingsMsg.value = ''), 3000)
  } catch (e) {
    alert(e instanceof Error ? e.message : '保存失败')
  }
}

function exportData() {
  const token = localStorage.getItem('pd_token') || ''
  fetch('/api/admin/export', { headers: { Authorization: 'Bearer ' + token } })
    .then((r) => {
      if (!r.ok) throw new Error('导出失败')
      return r.blob()
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'pindou-backup-' + new Date().toISOString().slice(0, 10) + '.json'
      a.click()
      URL.revokeObjectURL(url)
    })
    .catch((e) => alert(e.message || '导出失败'))
}

onMounted(async () => {
  await auth.fetchMe()
  if (!auth.state.user || auth.state.user.role !== 'admin') {
    router.replace('/')
    return
  }
  loadStats()
})

const tabs = [
  { id: 'dashboard', label: '📊 仪表盘' },
  { id: 'users', label: '👥 用户管理' },
  { id: 'patterns', label: '🧩 图纸管理' },
  { id: 'shares', label: '🔗 分享管理' },
  { id: 'ai', label: '🤖 AI 用量' },
  { id: 'feedback', label: '💬 反馈管理' },
  { id: 'settings', label: '⚙️ 系统设置' },
  { id: 'logs', label: '📜 操作日志' }
] as const

function pager(total: number, page: number, size: number) {
  const pages = Math.max(1, Math.ceil(total / size))
  return {
    total,
    page,
    size,
    pages,
    canPrev: page > 1,
    canNext: page < pages
  }
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-stone-800 sm:text-2xl">🛠 后台管理</h1>
        <p class="mt-1 text-sm text-stone-500">站点数据总览、用户 / 图纸 / 分享 / AI 用量 / 反馈 / 设置管理</p>
      </div>
      <button class="btn btn-secondary" @click="exportData">⬇ 数据导出</button>
    </div>

    <p v-if="err" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ err }}</p>

    <!-- Tab -->
    <div class="no-scrollbar flex gap-1 overflow-x-auto border-b border-stone-200 pb-px">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="shrink-0 rounded-t-lg px-3.5 py-2.5 text-sm font-medium transition"
        :class="tab === t.id ? 'border-b-2 border-brand-500 text-brand-600' : 'text-stone-400 hover:text-stone-600'"
        @click="switchTab(t.id)"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- 仪表盘 -->
    <section v-if="tab === 'dashboard'">
      <div v-if="stats" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div class="card p-4">
          <p class="text-xs text-stone-400">用户总数</p>
          <p class="mt-1 text-2xl font-bold text-stone-800">{{ stats.users }}</p>
        </div>
        <div class="card p-4">
          <p class="text-xs text-stone-400">图纸总数</p>
          <p class="mt-1 text-2xl font-bold text-stone-800">{{ stats.patterns }}</p>
          <p class="text-[11px] text-stone-400">其中用户图纸 {{ stats.userPatterns }}</p>
        </div>
        <div class="card p-4">
          <p class="text-xs text-stone-400">分享链接</p>
          <p class="mt-1 text-2xl font-bold text-stone-800">{{ stats.shares }}</p>
          <p class="text-[11px] text-stone-400">累计访问 {{ stats.shareVisits }}</p>
        </div>
        <div class="card p-4">
          <p class="text-xs text-stone-400">AI 生成</p>
          <p class="mt-1 text-2xl font-bold text-stone-800">{{ stats.aiTotal }}</p>
          <p class="text-[11px] text-stone-400">今日 {{ stats.aiToday }}</p>
        </div>
        <div class="card p-4">
          <p class="text-xs text-stone-400">待处理反馈</p>
          <p class="mt-1 text-2xl font-bold text-stone-800">{{ stats.feedbackOpen }}</p>
        </div>
        <div class="card p-4">
          <p class="text-xs text-stone-400">今日操作日志</p>
          <p class="mt-1 text-2xl font-bold text-stone-800">{{ stats.logsToday }}</p>
        </div>
      </div>

      <div v-if="stats" class="card mt-4 p-5">
        <h2 class="text-sm font-semibold text-stone-700">近 7 天注册趋势</h2>
        <div class="mt-4 flex h-32 items-end gap-2">
          <div v-for="t in stats.trend" :key="t.date" class="flex flex-1 flex-col items-center gap-1">
            <span class="text-xs font-semibold text-stone-600">{{ t.count }}</span>
            <div
              class="w-full rounded-t-md bg-brand-400 transition-all"
              :style="{ height: Math.max(4, Math.min(80, (t.count / Math.max(1, ...stats.trend.map((x) => x.count))) * 80)) + 'px' }"
            ></div>
            <span class="text-[10px] text-stone-400">{{ t.date }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 用户管理 -->
    <section v-if="tab === 'users'" class="card overflow-hidden">
      <div class="flex flex-wrap items-center gap-2 p-4">
        <input v-model="userSearch" class="input !w-56" placeholder="搜索用户名 / 邮箱 / 昵称" @keydown.enter="userPage = 1; loadUsers()" />
        <button class="btn btn-secondary" @click="userPage = 1; loadUsers()">搜索</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[760px] text-left text-sm">
          <thead class="bg-stone-50 text-xs text-stone-400">
            <tr>
              <th class="px-4 py-2.5">ID</th>
              <th class="px-4 py-2.5">用户名</th>
              <th class="px-4 py-2.5">邮箱</th>
              <th class="px-4 py-2.5">角色</th>
              <th class="px-4 py-2.5">状态</th>
              <th class="px-4 py-2.5">注册时间</th>
              <th class="px-4 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-100">
            <tr v-for="u in users" :key="u.id">
              <td class="px-4 py-2.5 text-stone-400">{{ u.id }}</td>
              <td class="px-4 py-2.5 font-medium text-stone-800">{{ u.nickname }} <span class="text-xs text-stone-400">@{{ u.username }}</span></td>
              <td class="px-4 py-2.5 text-stone-600">{{ u.email || '-' }}</td>
              <td class="px-4 py-2.5">
                <button class="chip !text-[11px]" :class="u.role === 'admin' ? '!bg-brand-50 !text-brand-600 !ring-brand-100' : ''" @click="toggleUser(u, 'role')">
                  {{ u.role === 'admin' ? '管理员' : '用户' }}
                </button>
              </td>
              <td class="px-4 py-2.5">
                <button class="chip !text-[11px]" :class="u.status === 'active' ? '!bg-green-50 !text-green-600 !ring-green-100' : '!bg-red-50 !text-red-600 !ring-red-100'" @click="toggleUser(u, 'status')">
                  {{ u.status === 'active' ? '正常' : '已封禁' }}
                </button>
              </td>
              <td class="px-4 py-2.5 text-xs text-stone-400">{{ fmtTime(u.createdAt) }}</td>
              <td class="px-4 py-2.5 text-right">
                <button class="btn btn-secondary !px-2.5 !py-1 text-xs" @click="resetPassword(u)">重置密码</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between border-t border-stone-100 px-4 py-3 text-xs text-stone-500">
        <span>共 {{ userTotal }} 人</span>
        <div class="flex items-center gap-2">
          <button class="btn btn-secondary !px-3 !py-1" :disabled="userPage <= 1" @click="userPage--; loadUsers()">上一页</button>
          <span>第 {{ userPage }} / {{ pager(userTotal, userPage, userSize).pages }} 页</span>
          <button class="btn btn-secondary !px-3 !py-1" :disabled="userPage >= pager(userTotal, userPage, userSize).pages" @click="userPage++; loadUsers()">下一页</button>
        </div>
      </div>
    </section>

    <!-- 图纸管理 -->
    <section v-if="tab === 'patterns'" class="card overflow-hidden">
      <div class="flex flex-wrap items-center gap-2 p-4">
        <input v-model="patternSearch" class="input !w-56" placeholder="搜索名称 / ID" @keydown.enter="patternPage = 1; loadPatterns()" />
        <select v-model="patternStatus" class="input !w-36 !py-1.5" @change="patternPage = 1; loadPatterns()">
          <option value="">全部状态</option>
          <option value="published">已上架</option>
          <option value="hidden">已下架</option>
        </select>
        <button class="btn btn-secondary" @click="patternPage = 1; loadPatterns()">搜索</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[820px] text-left text-sm">
          <thead class="bg-stone-50 text-xs text-stone-400">
            <tr>
              <th class="px-4 py-2.5">名称</th>
              <th class="px-4 py-2.5">尺寸</th>
              <th class="px-4 py-2.5">难度</th>
              <th class="px-4 py-2.5">豆数</th>
              <th class="px-4 py-2.5">来源</th>
              <th class="px-4 py-2.5">状态</th>
              <th class="px-4 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-100">
            <tr v-for="p in patterns" :key="p.id">
              <td class="px-4 py-2.5">
                <router-link :to="'/pattern/' + p.id" class="font-medium text-stone-800 hover:text-brand-600">{{ p.name }}</router-link>
                <p class="text-[11px] font-mono text-stone-400">{{ p.id }}</p>
              </td>
              <td class="px-4 py-2.5 text-stone-600">{{ p.width }} × {{ p.height }}</td>
              <td class="px-4 py-2.5 text-stone-600">{{ p.difficulty || '-' }}</td>
              <td class="px-4 py-2.5 text-stone-600">{{ p.beadCount }}</td>
              <td class="px-4 py-2.5 text-xs text-stone-500">
                <span v-if="p.isBuiltin" class="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-600">内置</span>
                <span v-else class="text-stone-400">用户</span>
              </td>
              <td class="px-4 py-2.5">
                <button class="chip !text-[11px]" :class="p.status === 'published' ? '!bg-green-50 !text-green-600 !ring-green-100' : '!bg-stone-100 !text-stone-500'" @click="togglePatternStatus(p)">
                  {{ p.status === 'published' ? '已上架' : '已下架' }}
                </button>
              </td>
              <td class="px-4 py-2.5 text-right whitespace-nowrap">
                <button class="btn btn-secondary !px-2.5 !py-1 text-xs" @click="editPattern(p)">编辑</button>
                <button class="btn btn-danger !px-2.5 !py-1 text-xs" :disabled="p.isBuiltin" @click="deletePattern(p)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between border-t border-stone-100 px-4 py-3 text-xs text-stone-500">
        <span>共 {{ patternTotal }} 张</span>
        <div class="flex items-center gap-2">
          <button class="btn btn-secondary !px-3 !py-1" :disabled="patternPage <= 1" @click="patternPage--; loadPatterns()">上一页</button>
          <span>第 {{ patternPage }} / {{ pager(patternTotal, patternPage, patternSize).pages }} 页</span>
          <button class="btn btn-secondary !px-3 !py-1" :disabled="patternPage >= pager(patternTotal, patternPage, patternSize).pages" @click="patternPage++; loadPatterns()">下一页</button>
        </div>
      </div>
    </section>

    <!-- 分享管理 -->
    <section v-if="tab === 'shares'" class="card overflow-hidden">
      <div class="flex flex-wrap items-center gap-2 p-4">
        <input v-model="shareSearch" class="input !w-56" placeholder="搜索分享编号" @keydown.enter="sharePage = 1; loadShares()" />
        <button class="btn btn-secondary" @click="sharePage = 1; loadShares()">搜索</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[680px] text-left text-sm">
          <thead class="bg-stone-50 text-xs text-stone-400">
            <tr>
              <th class="px-4 py-2.5">编号</th>
              <th class="px-4 py-2.5">名称</th>
              <th class="px-4 py-2.5">用户</th>
              <th class="px-4 py-2.5">访问</th>
              <th class="px-4 py-2.5">有效期</th>
              <th class="px-4 py-2.5">创建时间</th>
              <th class="px-4 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-100">
            <tr v-for="s in shares" :key="s.id">
              <td class="px-4 py-2.5 font-mono font-semibold text-brand-600">{{ s.id }}</td>
              <td class="px-4 py-2.5 text-stone-700">{{ s.name }}</td>
              <td class="px-4 py-2.5 text-stone-400">{{ s.userId ?? '游客' }}</td>
              <td class="px-4 py-2.5 text-stone-600">{{ s.visits }}</td>
              <td class="px-4 py-2.5 text-xs text-stone-400">{{ s.expiresAt ? fmtTime(s.expiresAt) : '永久' }}</td>
              <td class="px-4 py-2.5 text-xs text-stone-400">{{ fmtTime(s.createdAt) }}</td>
              <td class="px-4 py-2.5 text-right">
                <button class="btn btn-danger !px-2.5 !py-1 text-xs" @click="deleteShare(s)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between border-t border-stone-100 px-4 py-3 text-xs text-stone-500">
        <span>共 {{ shareTotal }} 条</span>
        <div class="flex items-center gap-2">
          <button class="btn btn-secondary !px-3 !py-1" :disabled="sharePage <= 1" @click="sharePage--; loadShares()">上一页</button>
          <span>第 {{ sharePage }} / {{ pager(shareTotal, sharePage, shareSize).pages }} 页</span>
          <button class="btn btn-secondary !px-3 !py-1" :disabled="sharePage >= pager(shareTotal, sharePage, shareSize).pages" @click="sharePage++; loadShares()">下一页</button>
        </div>
      </div>
    </section>

    <!-- AI 用量 -->
    <section v-if="tab === 'ai'" class="card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[680px] text-left text-sm">
          <thead class="bg-stone-50 text-xs text-stone-400">
            <tr>
              <th class="px-4 py-2.5">ID</th>
              <th class="px-4 py-2.5">用户</th>
              <th class="px-4 py-2.5">描述</th>
              <th class="px-4 py-2.5">模型</th>
              <th class="px-4 py-2.5">状态</th>
              <th class="px-4 py-2.5">时间</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-100">
            <tr v-for="r in aiRows" :key="r.id">
              <td class="px-4 py-2.5 text-stone-400">{{ r.id }}</td>
              <td class="px-4 py-2.5 text-stone-600">{{ r.userId ?? '游客' }}</td>
              <td class="max-w-[280px] truncate px-4 py-2.5 text-stone-600">{{ r.prompt }}</td>
              <td class="px-4 py-2.5 text-xs text-stone-400">{{ r.model }}</td>
              <td class="px-4 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-[11px]" :class="r.status === 'ok' ? 'bg-green-50 text-green-600' : r.status === 'blocked' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'">
                  {{ r.status === 'ok' ? '成功' : r.status === 'blocked' ? '被拦截' : '失败' }}
                </span>
              </td>
              <td class="px-4 py-2.5 text-xs text-stone-400">{{ fmtTime(r.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between border-t border-stone-100 px-4 py-3 text-xs text-stone-500">
        <span>共 {{ aiTotal }} 条</span>
        <div class="flex items-center gap-2">
          <button class="btn btn-secondary !px-3 !py-1" :disabled="aiPage <= 1" @click="aiPage--; loadAi()">上一页</button>
          <span>第 {{ aiPage }} / {{ pager(aiTotal, aiPage, aiSize).pages }} 页</span>
          <button class="btn btn-secondary !px-3 !py-1" :disabled="aiPage >= pager(aiTotal, aiPage, aiSize).pages" @click="aiPage++; loadAi()">下一页</button>
        </div>
      </div>
    </section>

    <!-- 反馈管理 -->
    <section v-if="tab === 'feedback'" class="card overflow-hidden">
      <div class="flex flex-wrap items-center gap-2 p-4">
        <select v-model="feedbackStatus" class="input !w-40 !py-1.5" @change="feedbackPage = 1; loadFeedback()">
          <option value="">全部状态</option>
          <option value="open">待处理</option>
          <option value="closed">已处理</option>
        </select>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[720px] text-left text-sm">
          <thead class="bg-stone-50 text-xs text-stone-400">
            <tr>
              <th class="px-4 py-2.5">ID</th>
              <th class="px-4 py-2.5">用户</th>
              <th class="px-4 py-2.5">反馈内容</th>
              <th class="px-4 py-2.5">联系方式</th>
              <th class="px-4 py-2.5">状态</th>
              <th class="px-4 py-2.5">时间</th>
              <th class="px-4 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-100">
            <tr v-for="f in feedback" :key="f.id">
              <td class="px-4 py-2.5 text-stone-400">{{ f.id }}</td>
              <td class="px-4 py-2.5 text-stone-600">{{ f.userId ?? '游客' }}</td>
              <td class="max-w-[300px] px-4 py-2.5">
                <p class="truncate text-stone-700">{{ f.content }}</p>
                <p v-if="f.reply" class="mt-0.5 truncate text-xs text-green-600">回复：{{ f.reply }}</p>
              </td>
              <td class="px-4 py-2.5 text-xs text-stone-400">{{ f.contact || '-' }}</td>
              <td class="px-4 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-[11px]" :class="f.status === 'open' ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'">
                  {{ f.status === 'open' ? '待处理' : '已处理' }}
                </span>
              </td>
              <td class="px-4 py-2.5 text-xs text-stone-400">{{ fmtTime(f.createdAt) }}</td>
              <td class="px-4 py-2.5 text-right">
                <button class="btn btn-secondary !px-2.5 !py-1 text-xs" @click="updateFeedback(f)">回复 / 处理</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between border-t border-stone-100 px-4 py-3 text-xs text-stone-500">
        <span>共 {{ feedbackTotal }} 条</span>
        <div class="flex items-center gap-2">
          <button class="btn btn-secondary !px-3 !py-1" :disabled="feedbackPage <= 1" @click="feedbackPage--; loadFeedback()">上一页</button>
          <span>第 {{ feedbackPage }} / {{ pager(feedbackTotal, feedbackPage, feedbackSize).pages }} 页</span>
          <button class="btn btn-secondary !px-3 !py-1" :disabled="feedbackPage >= pager(feedbackTotal, feedbackPage, feedbackSize).pages" @click="feedbackPage++; loadFeedback()">下一页</button>
        </div>
      </div>
    </section>

    <!-- 系统设置 -->
    <section v-if="tab === 'settings'" class="card max-w-2xl space-y-4 p-5">
      <div>
        <label class="mb-1.5 block text-xs font-medium text-stone-500">站点公告</label>
        <textarea v-model="settings.siteNotice" rows="3" class="input w-full resize-y" placeholder="显示在图纸库顶部的公告"></textarea>
      </div>
      <div class="flex items-center justify-between rounded-xl bg-stone-50 px-4 py-3">
        <div>
          <p class="text-sm font-medium text-stone-700">AI 生成开关</p>
          <p class="text-xs text-stone-400">关闭后 AI 生成接口返回不可用</p>
        </div>
        <input v-model="settings.aiEnabled" type="checkbox" class="h-5 w-5 accent-brand-500" />
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-medium text-stone-500">登录用户每日 AI 次数上限</label>
        <input v-model.number="settings.aiDailyLimit" type="number" min="1" max="10000" class="input !w-40" />
      </div>
      <div class="flex items-center justify-between rounded-xl bg-stone-50 px-4 py-3">
        <div>
          <p class="text-sm font-medium text-stone-700">维护模式</p>
          <p class="text-xs text-stone-400">开启后前端显示维护提示（接口仍可用）</p>
        </div>
        <input v-model="settings.maintenance" type="checkbox" class="h-5 w-5 accent-brand-500" />
      </div>
      <p v-if="settingsMsg" class="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600">{{ settingsMsg }}</p>
      <div class="flex justify-end">
        <button class="btn btn-primary" @click="saveSettings">保存设置</button>
      </div>
    </section>

    <!-- 操作日志 -->
    <section v-if="tab === 'logs'" class="card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[680px] text-left text-sm">
          <thead class="bg-stone-50 text-xs text-stone-400">
            <tr>
              <th class="px-4 py-2.5">ID</th>
              <th class="px-4 py-2.5">用户</th>
              <th class="px-4 py-2.5">操作</th>
              <th class="px-4 py-2.5">详情</th>
              <th class="px-4 py-2.5">IP</th>
              <th class="px-4 py-2.5">时间</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-100">
            <tr v-for="l in logs" :key="l.id">
              <td class="px-4 py-2.5 text-stone-400">{{ l.id }}</td>
              <td class="px-4 py-2.5 text-stone-600">{{ l.userId ?? '-' }}</td>
              <td class="px-4 py-2.5 font-medium text-stone-700">{{ l.action }}</td>
              <td class="max-w-[260px] truncate px-4 py-2.5 text-stone-500">{{ l.detail || '-' }}</td>
              <td class="px-4 py-2.5 text-xs text-stone-400">{{ l.ip || '-' }}</td>
              <td class="px-4 py-2.5 text-xs text-stone-400">{{ fmtTime(l.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between border-t border-stone-100 px-4 py-3 text-xs text-stone-500">
        <span>共 {{ logTotal }} 条</span>
        <div class="flex items-center gap-2">
          <button class="btn btn-secondary !px-3 !py-1" :disabled="logPage <= 1" @click="logPage--; loadLogs()">上一页</button>
          <span>第 {{ logPage }} / {{ pager(logTotal, logPage, logSize).pages }} 页</span>
          <button class="btn btn-secondary !px-3 !py-1" :disabled="logPage >= pager(logTotal, logPage, logSize).pages" @click="logPage++; loadLogs()">下一页</button>
        </div>
      </div>
    </section>
  </div>
</template>
