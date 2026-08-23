<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { api } from '../utils/api'
import { PALETTES, getPalette } from '../data/palettes'

const router = useRouter()
const route = useRoute()
const auth = useAuth()

const ADMIN_TABS = ['dashboard', 'users', 'patterns', 'collect', 'palettes', 'shares', 'ai', 'feedback', 'settings', 'logs', 'update'] as const
const tab = ref<(typeof ADMIN_TABS)[number]>('dashboard')

function validAdminTab(v: unknown): typeof tab.value {
  return (ADMIN_TABS as readonly string[]).includes(String(v)) ? (v as typeof tab.value) : 'dashboard'
}
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
  tags: string[]
  sourceLabel: string
  featured: boolean
  createdAt: number
}
const patterns = ref<AdminPattern[]>([])
const patternTotal = ref(0)
const patternPage = ref(1)
const patternSize = ref(15)
const patternSearch = ref('')
const patternStatus = ref('')
const patternType = ref('')

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
const settings = ref({
  siteNotice: '',
  maintenance: false,
  registerOpen: true,
  features: { gallery: true, generator: true, ai: true, palette: true, warehouse: true, share: true },
  aiEnabled: true,
  aiDailyLimit: 50,
  aiGuestLimit: 10,
  aiApiBase: 'https://dashscope.aliyuncs.com/api/v1',
  aiApiKeyConfigured: false,
  aiApiKeyMasked: '',
  aiModel: 'wanx2.1-t2i-turbo',
  aiEditModel: 'wanx2.1-imageedit',
  aiApiKey: '',
  aiApiKeyClear: false,
  collectEnabled: false,
  collectIntervalMin: 60,
  collectLimit: 10,
  collectSources: ['perler', 'beadpattern', 'beadcanvas', 'makebead'],
  collectExcludeTags: '',
  collectMaxWidth: 0,
  collectMaxBeads: 0,
  checkinPoints: 10,
  checkinStreakBonus: 5,
  exchangeCost: 20,
  exchangeQuota: 5,
  smtpHost: '',
  smtpPort: 465,
  smtpUser: '',
  smtpPass: '',
  smtpPassConfigured: false,
  smtpPassClear: false,
  smtpFrom: '',
  updatePm2Name: 'pindou'
})
const featureItems = [
  { key: 'gallery', label: '图纸库', icon: '🏠', desc: '首页图纸库浏览与详情' },
  { key: 'generator', label: '图片转图纸', icon: '🖼️', desc: '上传图片生成图纸' },
  { key: 'ai', label: 'AI 生成', icon: '🤖', desc: '文字描述生成图纸' },
  { key: 'palette', label: '色卡', icon: '🎨', desc: '品牌色卡与颜色查询' },
  { key: 'warehouse', label: '豆仓', icon: '📦', desc: '豆子库存管理' },
  { key: 'share', label: '分享', icon: '🔗', desc: '短链接分享图纸' }
] as const
const settingsMsg = ref('')

// ---------- 色卡管理 ----------
interface AdminPalette {
  id: string
  title: string
  brand: string
  description: string
  count: number
  colors: { code: string; hex: string; rgb: number[]; group: string }[]
}
const palettes = ref<AdminPalette[]>([])
const palMsg = ref('')
const palErr = ref('')
const showNewPalette = ref(false)
const newPal = ref({ id: '', title: '', brand: '国内', description: '', colors: '' })
const newPalMsg = ref('')
const showPaletteColors = ref(false)
const paletteColorsId = ref('')
const paletteColorsTitle = ref('')
const paletteColorsText = ref('')
const paletteColorsMsg = ref('')

function parseColorsText(text: string): { code: string; hex: string }[] {
  const out: { code: string; hex: string }[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    const m = t.match(/^([^\s#]+)[\s,]+(#[0-9a-fA-F]{6})$/i)
    if (m) out.push({ code: m[1].trim(), hex: m[2].toUpperCase() })
  }
  return out
}

async function loadPalettesAdmin() {
  await run(async () => {
    const data = await api<{ palettes: AdminPalette[] }>('/palettes')
    palettes.value = data.palettes || []
  })
}

function openNewPalette() {
  newPal.value = { id: '', title: '', brand: '国内', description: '', colors: '' }
  newPalMsg.value = ''
  showNewPalette.value = true
}

async function createPalette() {
  newPalMsg.value = ''
  const id = newPal.value.id.trim()
  const title = newPal.value.title.trim()
  if (!id || !title) {
    newPalMsg.value = '请填写 ID 和名称'
    return
  }
  const colors = parseColorsText(newPal.value.colors)
  if (!colors.length) {
    newPalMsg.value = '颜色格式不正确：每行一个「色号 #RRGGBB」，至少一行'
    return
  }
  try {
    await api('/admin/palettes', {
      method: 'POST',
      body: JSON.stringify({ id, title, brand: newPal.value.brand, description: newPal.value.description.trim(), colors })
    })
    showNewPalette.value = false
    palMsg.value = `已创建色卡 ${id}`
    loadPalettesAdmin()
  } catch (e) {
    newPalMsg.value = e instanceof Error ? e.message : '创建失败'
  }
}

async function editPaletteMeta(p: AdminPalette) {
  const title = prompt('色卡名称：', p.title)
  if (title === null) return
  const brand = prompt('品牌（国内/进口）：', p.brand)
  if (brand === null) return
  const desc = prompt('简介（可留空）：', p.description || '')
  if (desc === null) return
  try {
    await api(`/admin/palettes/${encodeURIComponent(p.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: title.trim() || p.title, brand: brand.trim(), description: desc.trim() })
    })
    palMsg.value = '色卡信息已更新'
    loadPalettesAdmin()
  } catch (e) {
    palErr.value = e instanceof Error ? e.message : '更新失败'
  }
}

function openPaletteColors(p: AdminPalette) {
  paletteColorsId.value = p.id
  paletteColorsTitle.value = p.title
  paletteColorsText.value = p.colors.map((c) => `${c.code} ${c.hex}`).join('\n')
  paletteColorsMsg.value = ''
  showPaletteColors.value = true
}

async function savePaletteColors() {
  const colors = parseColorsText(paletteColorsText.value)
  if (!colors.length) {
    paletteColorsMsg.value = '至少需要一个格式正确的颜色（每行：色号 #RRGGBB）'
    return
  }
  try {
    await api(`/admin/palettes/${encodeURIComponent(paletteColorsId.value)}/colors`, {
      method: 'PUT',
      body: JSON.stringify({ colors })
    })
    showPaletteColors.value = false
    palMsg.value = `已保存 ${colors.length} 个颜色`
    loadPalettesAdmin()
  } catch (e) {
    paletteColorsMsg.value = e instanceof Error ? e.message : '保存失败'
  }
}

async function deletePaletteAdmin(p: AdminPalette) {
  if (!confirm(`确定删除色卡「${p.title}」（${p.id}）吗？使用该色卡的图纸将无法显示颜色，且无法恢复。`)) return
  try {
    await api(`/admin/palettes/${encodeURIComponent(p.id)}`, { method: 'DELETE' })
    palMsg.value = `已删除色卡 ${p.id}`
    loadPalettesAdmin()
  } catch (e) {
    palErr.value = e instanceof Error ? e.message : '删除失败'
  }
}

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

function loadForTab(t: typeof tab.value) {
  err.value = ''
  if (t === 'dashboard') loadStats()
  else if (t === 'users') loadUsers()
  else if (t === 'patterns') loadPatterns()
  else if (t === 'collect') loadCollectStatus()
  else if (t === 'palettes') loadPalettesAdmin()
  else if (t === 'shares') loadShares()
  else if (t === 'ai') loadAi()
  else if (t === 'feedback') loadFeedback()
  else if (t === 'settings') loadSettings()
  else if (t === 'logs') loadLogs()
  else if (t === 'update') loadUpdate()
}

function switchTab(t: typeof tab.value) {
  // 点击当前已选中的菜单时仍重新加载（相当于刷新）
  if (tab.value === t && validAdminTab(route.params.tab) === t) {
    loadForTab(t)
    return
  }
  router.push('/admin/' + t)
}

watch(
  () => route.params.tab,
  (v) => {
    const t = validAdminTab(v)
    if (t !== tab.value) {
      tab.value = t
      loadForTab(t)
    }
  }
)

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


// ---------- 采集预览后再入库（C2） ----------
const userSelected = ref<Record<string, boolean>>({})
const userSelectedCount = computed(() => Object.values(userSelected.value).filter(Boolean).length)
function toggleUserSelect(id: number) {
  userSelected.value[id] = !userSelected.value[id]
}
function toggleUserSelectAll(checked: boolean) {
  const next: Record<string, boolean> = {}
  for (const u of users.value) next[u.id] = checked
  userSelected.value = next
}
function clearUserSelect() {
  userSelected.value = {}
}
async function batchUsers(action: 'enable' | 'disable' | 'admin' | 'user' | 'delete') {
  const ids = users.value.filter((u) => userSelected.value[u.id]).map((u) => u.id)
  if (!ids.length) {
    alert('请先勾选要操作的用户')
    return
  }
  const labelMap: Record<string, string> = { enable: '启用', disable: '禁用', admin: '设为管理员', user: '设为普通用户', delete: '删除' }
  const label = labelMap[action]
  if (action === 'delete') {
    if (!confirm(`确定要删除这 ${ids.length} 个用户吗？删除后其图纸、收藏、分组、库存和 AI 记录将一并清除`)) return
  } else if (action === 'disable') {
    if (!confirm(`确定要禁用这 ${ids.length} 个用户吗？`)) return
  } else if (action === 'admin' || action === 'user') {
    if (!confirm(`确定要将这 ${ids.length} 个用户${label}吗？`)) return
  }
  try {
    const d = await api<{ processed: number; skipped: number }>('/admin/users/batch', {
      method: 'POST',
      body: JSON.stringify({ ids, action })
    })
    alert(`已${label} ${d.processed} 个用户${d.skipped ? '，跳过 ' + d.skipped + ' 个' : ''}`)
    userSelected.value = {}
    loadUsers()
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作失败')
  }
}

async function loadPatterns() {
  await run(async () => {
    const q = new URLSearchParams({ search: patternSearch.value, page: String(patternPage.value), size: String(patternSize.value) })
    if (patternStatus.value) q.set('status', patternStatus.value)
    if (patternType.value) q.set('type', patternType.value)
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
  const tags = prompt('标签（用逗号分隔，留空不修改）：', (p.tags || []).join(','))
  if (tags === null) return
  const source = prompt('来源（如：原创 / Perler画廊，留空不修改）：', p.sourceLabel || '')
  if (source === null) return
  const diff = prompt('难度（简单/中等/复杂，留空不修改）：', p.difficulty || '')
  if (diff === null) return
  try {
    await api(`/admin/patterns/${encodeURIComponent(p.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: name.trim() || p.name,
        tags: tags.trim() ? tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : p.tags,
        sourceLabel: source.trim(),
        difficulty: diff && diff.trim() ? diff.trim() : p.difficulty
      })
    })
    loadPatterns()
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作失败')
  }
}

async function toggleFeatured(p: AdminPattern) {
  try {
    await api(`/admin/patterns/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: JSON.stringify({ featured: !p.featured }) })
    loadPatterns()
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作失败')
  }
}

// ---------- 新增图纸 ----------
const showNewPattern = ref(false)
const newPatMsg = ref('')
const newPat = ref({
  id: '',
  name: '',
  paletteId: 'mard-221-github',
  tags: '',
  sourceLabel: '',
  difficulty: '',
  status: 'published',
  featured: false,
  content: ''
})
function openNewPattern() {
  newPat.value = { id: '', name: '', paletteId: 'mard-221-github', tags: '', sourceLabel: '', difficulty: '', status: 'published', featured: false, content: '' }
  newPatMsg.value = ''
  showNewPattern.value = true
}

function parseContent(text: string): string[][] | null {
  const t = text.trim()
  if (!t) return null
  // JSON 数组
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t)
      if (!Array.isArray(arr)) return null
      return arr.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '.')) : []))
    } catch {
      return null
    }
  }
  // 网格文本：每行用空格/逗号/制表符分隔的色号，. 表示空格
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return null
  const rows = lines.map((line) => line.split(/[,;\t ]+/).map((c) => c.trim()).filter(Boolean))
  return rows
}

async function createPattern() {
  newPatMsg.value = ''
  const name = newPat.value.name.trim()
  if (!name) {
    newPatMsg.value = '请填写图纸名称'
    return
  }
  const rows = parseContent(newPat.value.content)
  if (!rows || !rows.length) {
    newPatMsg.value = '图纸内容不能为空，支持色号网格或 JSON 数组'
    return
  }
  try {
    await api('/admin/patterns', {
      method: 'POST',
      body: JSON.stringify({
        id: newPat.value.id.trim() || undefined,
        name,
        paletteId: newPat.value.paletteId,
        tags: newPat.value.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
        sourceLabel: newPat.value.sourceLabel.trim(),
        difficulty: newPat.value.difficulty.trim() || undefined,
        status: newPat.value.status,
        featured: newPat.value.featured,
        rows
      })
    })
    showNewPattern.value = false
    loadPatterns()
    // 刷新图纸库数据
    try { await fetch('/api/patterns') } catch { /* ignore */ }
  } catch (e) {
    newPatMsg.value = e instanceof Error ? e.message : '创建失败'
  }
}

async function deletePattern(p: AdminPattern) {
  if (p.isBuiltin && !p.sourceLabel) {
    alert('种子内置图纸不能删除，可改为下架；采集来的图纸可以删除')
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

// ---------- 图纸批量管理 ----------
const patternSelected = ref<Record<string, boolean>>({})
const patternSelectedCount = computed(() => Object.values(patternSelected.value).filter(Boolean).length)
const batchDifficulty = ref('简单')
function togglePatternSelect(id: string) {
  patternSelected.value[id] = !patternSelected.value[id]
}
function togglePatternSelectAll(checked: boolean) {
  const next: Record<string, boolean> = {}
  for (const p of patterns.value) next[p.id] = checked
  patternSelected.value = next
}
function clearPatternSelect() {
  patternSelected.value = {}
}
async function batchPatterns(action: 'delete' | 'publish' | 'hide' | 'difficulty') {
  const ids = patterns.value.filter((p) => patternSelected.value[p.id]).map((p) => p.id)
  if (!ids.length) {
    alert('请先勾选要操作的图纸')
    return
  }
  if (action === 'delete' && !confirm(`确定删除选中的 ${ids.length} 张图纸吗？（内置无来源图纸会自动跳过）`)) return
  try {
    const d = await api<{ processed: number; skipped: number }>('/admin/patterns/batch', {
      method: 'POST',
      body: JSON.stringify({ ids, action, difficulty: action === 'difficulty' ? batchDifficulty.value : undefined })
    })
    alert(`批量${action === 'delete' ? '删除' : action === 'publish' ? '上架' : action === 'hide' ? '下架' : '改难度'}完成：成功 ${d.processed} 条${d.skipped ? '，跳过 ' + d.skipped + ' 条' : ''}`)
    patternSelected.value = {}
    loadPatterns()
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作失败')
  }
}

// ---------- 分享批量 ----------
const shareSelected = ref<Record<string, boolean>>({})
const shareSelectedCount = computed(() => Object.values(shareSelected.value).filter(Boolean).length)
function toggleShareSelect(id: string) {
  shareSelected.value[id] = !shareSelected.value[id]
}
function toggleShareSelectAll(checked: boolean) {
  const next: Record<string, boolean> = {}
  for (const s of shares.value) next[s.id] = checked
  shareSelected.value = next
}
function clearShareSelect() {
  shareSelected.value = {}
}
async function batchShares(action: 'delete') {
  const ids = shares.value.filter((s) => shareSelected.value[s.id]).map((s) => s.id)
  if (!ids.length) {
    alert('请先勾选要操作的分享链接')
    return
  }
  if (!confirm(`确定删除选中的 ${ids.length} 条分享链接吗？`)) return
  try {
    const d = await api<{ processed: number }>('/admin/shares/batch', { method: 'POST', body: JSON.stringify({ ids, action }) })
    alert(`批量删除完成：成功 ${d.processed} 条`)
    shareSelected.value = {}
    loadShares()
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作失败')
  }
}

// ---------- AI 用量批量 ----------
const aiSelected = ref<Record<number, boolean>>({})
const aiSelectedCount = computed(() => Object.values(aiSelected.value).filter(Boolean).length)
function toggleAiSelect(id: number) {
  aiSelected.value[id] = !aiSelected.value[id]
}
function toggleAiSelectAll(checked: boolean) {
  const next: Record<number, boolean> = {}
  for (const r of aiRows.value) next[r.id] = checked
  aiSelected.value = next
}
function clearAiSelect() {
  aiSelected.value = {}
}
async function batchAi(action: 'delete' | 'clear') {
  const ids = aiRows.value.filter((r) => aiSelected.value[r.id]).map((r) => r.id)
  if (action === 'clear') {
    if (!confirm('确定清空全部 AI 用量记录吗？（不可恢复）')) return
    try {
      const d = await api<{ processed: number }>('/admin/ai-usage/batch', { method: 'POST', body: JSON.stringify({ ids: [], action }) })
      alert(`已清空 AI 用量记录 ${d.processed} 条`)
      aiSelected.value = {}
      loadAi()
      return
    } catch (e) {
      alert(e instanceof Error ? e.message : '操作失败')
      return
    }
  }
  if (!ids.length) {
    alert('请先勾选要操作的记录')
    return
  }
  if (!confirm(`确定删除选中的 ${ids.length} 条 AI 用量记录吗？`)) return
  try {
    const d = await api<{ processed: number }>('/admin/ai-usage/batch', { method: 'POST', body: JSON.stringify({ ids, action }) })
    alert(`批量删除完成：成功 ${d.processed} 条`)
    aiSelected.value = {}
    loadAi()
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作失败')
  }
}

// ---------- 反馈批量 ----------
const feedbackSelected = ref<Record<number, boolean>>({})
const feedbackSelectedCount = computed(() => Object.values(feedbackSelected.value).filter(Boolean).length)
function toggleFeedbackSelect(id: number) {
  feedbackSelected.value[id] = !feedbackSelected.value[id]
}
function toggleFeedbackSelectAll(checked: boolean) {
  const next: Record<number, boolean> = {}
  for (const f of feedback.value) next[f.id] = checked
  feedbackSelected.value = next
}
function clearFeedbackSelect() {
  feedbackSelected.value = {}
}
async function batchFeedback(action: 'delete' | 'close') {
  const ids = feedback.value.filter((f) => feedbackSelected.value[f.id]).map((f) => f.id)
  if (!ids.length) {
    alert('请先勾选要操作的反馈')
    return
  }
  if (action === 'delete' && !confirm(`确定删除选中的 ${ids.length} 条反馈吗？`)) return
  if (action === 'close' && !confirm(`确定将选中的 ${ids.length} 条反馈标记为已处理吗？`)) return
  try {
    const d = await api<{ processed: number }>('/admin/feedback/batch', { method: 'POST', body: JSON.stringify({ ids, action }) })
    alert(`批量${action === 'delete' ? '删除' : '处理'}完成：成功 ${d.processed} 条`)
    feedbackSelected.value = {}
    loadFeedback()
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作失败')
  }
}

// ---------- 日志批量 ----------
const logSelected = ref<Record<number, boolean>>({})
const logSelectedCount = computed(() => Object.values(logSelected.value).filter(Boolean).length)
function toggleLogSelect(id: number) {
  logSelected.value[id] = !logSelected.value[id]
}
function toggleLogSelectAll(checked: boolean) {
  const next: Record<number, boolean> = {}
  for (const l of logs.value) next[l.id] = checked
  logSelected.value = next
}
function clearLogSelect() {
  logSelected.value = {}
}
async function batchLogs(action: 'delete' | 'clear') {
  const ids = logs.value.filter((l) => logSelected.value[l.id]).map((l) => l.id)
  if (action === 'clear') {
    if (!confirm('确定清空全部日志吗？（不可恢复）')) return
    try {
      const d = await api<{ processed: number }>('/admin/logs/batch', { method: 'POST', body: JSON.stringify({ ids: [], action }) })
      alert(`已清空日志 ${d.processed} 条`)
      logSelected.value = {}
      loadLogs()
      return
    } catch (e) {
      alert(e instanceof Error ? e.message : '操作失败')
      return
    }
  }
  if (!ids.length) {
    alert('请先勾选要操作的日志')
    return
  }
  if (!confirm(`确定删除选中的 ${ids.length} 条日志吗？`)) return
  try {
    const d = await api<{ processed: number }>('/admin/logs/batch', { method: 'POST', body: JSON.stringify({ ids, action }) })
    alert(`批量删除完成：成功 ${d.processed} 条`)
    logSelected.value = {}
    loadLogs()
  } catch (e) {
    alert(e instanceof Error ? e.message : '操作失败')
  }
}

// ---------- 色卡批量 ----------
const paletteSelected = ref<Record<string, boolean>>({})
const paletteSelectedCount = computed(() => Object.values(paletteSelected.value).filter(Boolean).length)
function togglePaletteSelect(id: string) {
  paletteSelected.value[id] = !paletteSelected.value[id]
}
function togglePaletteSelectAll(checked: boolean) {
  const next: Record<string, boolean> = {}
  for (const p of palettes.value) next[p.id] = checked
  paletteSelected.value = next
}
function clearPaletteSelect() {
  paletteSelected.value = {}
}
async function batchPalettes(action: 'delete') {
  const ids = palettes.value.filter((p) => paletteSelected.value[p.id]).map((p) => p.id)
  if (!ids.length) {
    alert('请先勾选要操作的色卡')
    return
  }
  if (!confirm(`确定删除选中的 ${ids.length} 个色卡吗？（被图纸使用的会自动跳过）`)) return
  try {
    const d = await api<{ processed: number; skipped: number }>('/admin/palettes/batch', { method: 'POST', body: JSON.stringify({ ids, action }) })
    alert(`批量删除完成：成功 ${d.processed} 条${d.skipped ? '，跳过 ' + d.skipped + ' 条' : ''}`)
    paletteSelected.value = {}
    loadPalettesAdmin()
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
  loadCollectStatus()
}

interface CollectSourceResult {
  source: string
  label?: string
  total?: number
  added?: number
  skippedExisting?: number
  skippedByFilter?: number
  skippedNoPng?: number
  errors?: number
  error?: string
  errMsgs?: string[]
}
interface CollectResult {
  total: number
  added: number
  skippedExisting: number
  skippedByFilter?: number
  skippedNoPng: number
  errors: number
  results?: CollectSourceResult[]
}
interface CollectSourceStat {
  source: string
  label: string
  count: number
}
interface CollectHistoryItem {
  action: string
  detail: string
  at: number
}
const collectStatus = ref<{ enabled: boolean; intervalMin: number; limit: number; sources: string[]; collectSources: string[]; lastRunAt: number; lastResult: CollectResult | null; sourceStats: CollectSourceStat[]; history: CollectHistoryItem[] } | null>(null)
const collectMsg = ref('')
async function loadCollectStatus() {
  try {
    collectStatus.value = await api<typeof collectStatus.value>('/admin/collect/status')
  } catch {
    /* 后端不可用 */
  }
}
async function runCollect() {
  collectMsg.value = '⏳ 采集中（抓取所选来源并转换新图纸），请稍候…'
  try {
    const d = await api<{ result: CollectResult }>('/admin/collect/run', { method: 'POST' })
    const r = d.result
    collectMsg.value = `✅ 采集完成：新增 ${r.added} 条，跳过已有 ${r.skippedExisting} 条，过滤 ${r.skippedByFilter ?? 0} 条，失败 ${r.errors} 条` + (r.results?.length ? ' · ' + r.results.map((s) => `${s.label || s.source} +${s.added ?? 0}`).join('，') : '')
    loadCollectStatus()
  } catch (e) {
    collectMsg.value = '❌ 采集失败：' + (e instanceof Error ? e.message : '未知错误')
  }
}

// ---------- 采集预览后再入库（C2） ----------
interface CollectPreviewItem {
  id: string
  name: string
  tags: string[]
  rows: string[][]
  width: number
  height: number
  beads: number
  difficulty: string
  sourceLabel: string
}
const collectPreviewMode = ref(false)
const previewSource = ref('perler')
const previewItems = ref<CollectPreviewItem[]>([])
const previewSelected = ref<Record<string, boolean>>({})
const previewLoading = ref(false)
const previewMsg = ref('')
const thumbCache = new Map<string, string>()
const previewSelectedCount = computed(() => Object.values(previewSelected.value).filter(Boolean).length)
const previewLimit = ref(8)

function sourceLabel(s: string): string {
  const map: Record<string, string> = {
    perler: 'Perler 画廊',
    beadpattern: 'BeadPattern 画廊',
    beadcanvas: 'BeadsCanvas 图纸库',
    makebead: 'MakeBead 图纸库',
    pixelbeads: 'Pixel-Beads'
  }
  return map[s] || s
}
function sourceDesc(s: string): string {
  const map: Record<string, string> = {
    perler: 'perlerbeads.net · 图案预览图',
    beadpattern: 'beadpattern.net · 高清网格图（180×180）',
    beadcanvas: 'beadscanvas.com · 直接抓取完整网格（免下载图片）',
    makebead: 'makebead.com · 详情接口直取完整网格（含每格色值）'
  }
  return map[s] || ''
}
function sourceSite(s: string): string {
  const map: Record<string, string> = {
    perler: 'https://perlerbeads.net/zh/gallery',
    beadpattern: 'https://beadpattern.net/gallery',
    beadcanvas: 'https://www.beadscanvas.com/zh/patterns',
    makebead: 'https://makebead.com/zh-Hans/patterns'
  }
  return map[s] || ''
}
const collectSourceKeys = computed(() => (collectStatus.value?.sources?.length ? collectStatus.value.sources : ['perler', 'beadpattern', 'beadcanvas', 'makebead']))

const expandedSource = ref('')
function toggleSourceExpand(s: string) {
  expandedSource.value = expandedSource.value === s ? '' : s
}
function sourceCount(s: string): number {
  return collectStatus.value?.sourceStats?.find((st) => st.source === s)?.count || 0
}
function sourceLastDetail(s: string): { text: string; errors: string[] } {
  const r = collectStatus.value?.lastResult?.results?.find((x) => x.source === s)
  if (!r) return { text: '', errors: [] }
  if (r.error) return { text: '', errors: [r.error] }
  const parts: string[] = []
  if (r.total != null) parts.push(`抓到 ${r.total} 条`)
  if (r.added) parts.push(`新增 ${r.added}`)
  if (r.skippedExisting) parts.push(`跳过已有 ${r.skippedExisting}`)
  if (r.skippedByFilter) parts.push(`过滤 ${r.skippedByFilter}`)
  if (r.skippedNoPng) parts.push(`无网格 ${r.skippedNoPng}`)
  if (r.errors) parts.push(`失败 ${r.errors}`)
  return { text: parts.join('，'), errors: Array.isArray(r.errMsgs) ? r.errMsgs.slice(0, 3) : [] }
}
function sourceLastText(s: string): string {
  const d = sourceLastDetail(s)
  if (d.errors.length) return '失败'
  return d.text || '无记录'
}
function sourceLastOk(s: string): boolean {
  return !sourceLastDetail(s).errors.length
}
const expandedHistory = ref(-1)

/** 把预览条目的 rows 渲染成缩略图 dataURL（按 mard-221 色卡上色，带缓存） */
function previewThumb(it: CollectPreviewItem): string {
  const cached = thumbCache.get(it.id)
  if (cached) return cached
  const pal = getPalette('mard-221-github')
  const byCode = new Map((pal?.colors || []).map((c) => [c.code, c.hex]))
  const w = it.width
  const h = it.height
  const maxW = 160
  const scale = Math.min(1, maxW / w)
  const cw = Math.max(1, Math.round(w * scale))
  const ch = Math.max(1, Math.round(h * scale))
  const cv = document.createElement('canvas')
  cv.width = cw
  cv.height = ch
  const ctx = cv.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cw, ch)
  const px = Math.max(1, Math.round(scale))
  for (let y = 0; y < h; y++) {
    const row = it.rows[y] || []
    for (let x = 0; x < w; x++) {
      const code = row[x]
      if (!code || code === '.') continue
      ctx.fillStyle = byCode.get(code) || '#cccccc'
      ctx.fillRect(Math.round(x * scale), Math.round(y * scale), px, px)
    }
  }
  const url = cv.toDataURL('image/png')
  thumbCache.set(it.id, url)
  return url
}

async function runPreview() {
  previewLoading.value = true
  previewMsg.value = ''
  previewItems.value = []
  previewSelected.value = {}
  try {
    const d = await api<{ items: CollectPreviewItem[] }>('/admin/collect/preview', {
      method: 'POST',
      body: JSON.stringify({ source: previewSource.value, limit: previewLimit.value })
    })
    previewItems.value = d.items || []
    previewMsg.value = previewItems.value.length
      ? `预览到 ${previewItems.value.length} 条新图纸，勾选后点「导入选中」`
      : '没有新的可采集图纸（可能已全部存在或被过滤）'
  } catch (e) {
    previewMsg.value = '❌ 预览失败：' + (e instanceof Error ? e.message : '未知错误')
  } finally {
    previewLoading.value = false
  }
}

function togglePreview(id: string) {
  previewSelected.value[id] = !previewSelected.value[id]
}

function toggleAllPreview(checked: boolean) {
  const next: Record<string, boolean> = {}
  for (const it of previewItems.value) next[it.id] = checked
  previewSelected.value = next
}

async function importSelected() {
  const items = previewItems.value.filter((it) => previewSelected.value[it.id])
  if (!items.length) {
    previewMsg.value = '请先勾选要导入的图纸'
    return
  }
  previewLoading.value = true
  try {
    const d = await api<{ result: { added: number; skipped: number } }>('/admin/collect/import', {
      method: 'POST',
      body: JSON.stringify({ items })
    })
    previewMsg.value = `✅ 已导入 ${d.result.added} 条（跳过已存在 ${d.result.skipped} 条）`
    previewItems.value = previewItems.value.filter((it) => !previewSelected.value[it.id])
    previewSelected.value = {}
    loadCollectStatus()
    loadPatterns()
    try { await fetch('/api/patterns') } catch { /* ignore */ }
  } catch (e) {
    previewMsg.value = '❌ 导入失败：' + (e instanceof Error ? e.message : '未知错误')
  } finally {
    previewLoading.value = false
  }
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

// ---------- SMTP 测试 ----------
const smtpTestTo = ref('')
const smtpTesting = ref(false)
const smtpTestMsg = ref('')
const smtpTestErr = ref(false)
async function testSmtp() {
  smtpTestMsg.value = ''
  smtpTestErr.value = false
  if (!smtpTestTo.value.trim()) {
    smtpTestErr.value = true
    smtpTestMsg.value = '请输入测试收件邮箱'
    return
  }
  smtpTesting.value = true
  // 客户端超时保险：服务器未响应时按钮不会永远停在“发送中…”
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    await api('/admin/smtp-test', {
      method: 'POST',
      body: JSON.stringify({ to: smtpTestTo.value.trim() }),
      signal: controller.signal
    })
    smtpTestMsg.value = '发送成功，请检查收件箱'
  } catch (e) {
    smtpTestErr.value = true
    smtpTestMsg.value =
      e instanceof Error && e.name === 'AbortError'
        ? '发送超时，请检查 SMTP 配置'
        : e instanceof Error
          ? e.message
          : '发送失败'
  } finally {
    clearTimeout(timer)
    smtpTesting.value = false
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
  tab.value = validAdminTab(route.params.tab)
  loadForTab(tab.value)
})

const tabs = [
  { id: 'dashboard', label: '仪表盘' },
  { id: 'users', label: '用户管理' },
  { id: 'patterns', label: '图纸管理' },
  { id: 'collect', label: '图纸采集' },
  { id: 'palettes', label: '色卡管理' },
  { id: 'shares', label: '分享管理' },
  { id: 'ai', label: 'AI 用量' },
  { id: 'feedback', label: '反馈管理' },
  { id: 'settings', label: '系统设置' },
  { id: 'logs', label: '操作日志' },
  { id: 'update', label: '版本更新' }
] as const
const navGroups: { label: string; items: { id: typeof tab.value; label: string }[] }[] = [
  {
    label: '概览',
    items: [{ id: 'dashboard', label: '仪表盘' }]
  },
  {
    label: '内容管理',
    items: [
      { id: 'patterns', label: '图纸管理' },
      { id: 'collect', label: '图纸采集' },
      { id: 'palettes', label: '色卡管理' }
    ]
  },
  {
    label: '运营管理',
    items: [
      { id: 'users', label: '用户管理' },
      { id: 'shares', label: '分享管理' },
      { id: 'feedback', label: '反馈管理' }
    ]
  },
  {
    label: '系统',
    items: [
      { id: 'ai', label: 'AI 用量' },
      { id: 'settings', label: '系统设置' },
      { id: 'logs', label: '操作日志' },
      { id: 'update', label: '版本更新' }
    ]
  }
]

const NAV_PATHS: Record<string, string> = {
  dashboard: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  users: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  patterns: 'M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z',
  collect: 'M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4',
  palettes: 'M12 21a9 9 0 110-18c4.97 0 8 2.69 8 6 0 1.66-1.34 3-3 3h-2.5a1.5 1.5 0 00-1.5 1.5c0 .39.16.75.4 1.02.28.3.6.68.6 1.1A1.38 1.38 0 0112.38 21H12z',
  shares: 'M10 14a5 5 0 007.07 0l2.83-2.83a5 5 0 00-7.07-7.07l-1.3 1.3M14 10a5 5 0 00-7.07 0L4.1 12.83a5 5 0 007.07 7.07l1.3-1.3',
  ai: 'M12 3v3m0 12v3m9-9h-3M6 12H3m15.36-6.36l-2.12 2.12M7.76 16.24l-2.12 2.12m12.72 0l-2.12-2.12M7.76 7.76L5.64 5.64M12 8a4 4 0 100 8 4 4 0 000-8z',
  feedback: 'M8 10h8m-8 4h5m-9 6V7a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H9l-4 4z',
  settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  logs: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  update: 'M4 4v5h5M20 20v-5h-5M5.6 14a7 7 0 0111.8-4.4L20 12M4 12l2.6 2.4A7 7 0 0018.4 10'
}
function navIcon(id: string): string {
  return NAV_PATHS[id] || NAV_PATHS.dashboard
}


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


// ---------- 版本更新 ----------
interface UpdateStatus {
  current: string
  latestVersion: string
  latestTag: string
  releaseName: string
  releaseNotes: string
  publishedAt: string
  hasUpdate: boolean
  localCommit: string
  remoteCommit: string
  branch: string
  running: boolean
  needsRestart: boolean
  stale: boolean
  status: { running?: boolean; step?: string; stepStartedAt?: number; startedAt?: number; ok?: boolean; error?: string } | null
  logTail: string
  logVisible: boolean
}
const upd = ref<UpdateStatus | null>(null)
const updMsg = ref('')
let updTimer: number | undefined

async function loadUpdate() {
  await run(async () => {
    upd.value = await api<UpdateStatus>('/admin/update/status')
    if (upd.value?.running || upd.value?.needsRestart || upd.value?.stale) pollUpdate()
  })
}
function fmtElapsed(startedAt?: number): string {
  if (!startedAt) return ''
  const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  if (sec < 60) return sec + ' 秒'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m + ' 分 ' + s + ' 秒'
}
function onUpdateVisibility() {
  // 切回前台时立即刷新一次，避免后台标签节流导致重启完成不自动消失
  if (document.visibilityState === 'visible') {
    loadUpdate().catch(() => {})
  }
}
async function tickUpdateStatus() {
  try {
    const st = await api<UpdateStatus>('/admin/update/status')
    const prev = upd.value
    upd.value = st
    // 检测到“待重启 -> 已完成”的切换：自动提示更新完成
    if (prev && prev.needsRestart && !st.needsRestart && !st.running && !st.stale && st.status?.ok) {
      updMsg.value = '✅ 更新完成，服务已重启并生效'
    }
    if (!st.running && !st.needsRestart && !st.stale && updTimer) {
      window.clearInterval(updTimer)
      updTimer = undefined
      window.removeEventListener('visibilitychange', onUpdateVisibility)
    }
  } catch {
    /* 服务重启中 / 网络波动：忽略，继续轮询 */
  }
}
function pollUpdate() {
  window.clearInterval(updTimer)
  window.removeEventListener('visibilitychange', onUpdateVisibility)
  window.addEventListener('visibilitychange', onUpdateVisibility)
  tickUpdateStatus().catch(() => {})
  updTimer = window.setInterval(tickUpdateStatus, 8000)
}
onUnmounted(() => {
  window.clearInterval(updTimer)
  updTimer = undefined
  window.removeEventListener('visibilitychange', onUpdateVisibility)
})

interface ConfirmState {
  title: string
  message: string
  flow?: string[]
  note?: string
  confirmText?: string
  action: () => void | Promise<void>
}
const confirmState = ref<ConfirmState | null>(null)
function askConfirm(c: ConfirmState) {
  confirmState.value = c
}
function closeConfirm() {
  confirmState.value = null
}
async function doConfirm() {
  const c = confirmState.value
  if (!c) return
  closeConfirm()
  await c.action()
}

function askRunUpdate() {
  if (!upd.value?.hasUpdate) {
    updMsg.value = '当前没有可更新的版本'
    return
  }
  askConfirm({
    title: '确认在线更新',
    message: '将拉取最新代码、安装依赖、构建前端并重启服务。期间站点会短暂不可用，请勿关闭页面。',
    flow: ['拉取代码', '安装依赖', '构建前端', '重启服务'],
    note: '更新完成后提示会自动消失，无需手动刷新。',
    confirmText: '开始更新',
    action: runUpdateNow
  })
}
async function runUpdateNow() {
  updMsg.value = ''
  await run(async () => {
    await api('/admin/update/run', { method: 'POST', body: JSON.stringify({ pm2Name: settings.value.updatePm2Name }) })
    updMsg.value = '更新任务已启动，正在后台执行…'
    await loadUpdate()
    pollUpdate()
  })
}
function askResetUpdate() {
  askConfirm({
    title: '重置更新状态',
    message: '将清除上次疑似中断的更新记录，不会影响代码与数据。',
    note: '仅清除更新状态记录，不影响代码与数据。',
    confirmText: '确认重置',
    action: resetUpdateState
  })
}
async function resetUpdateState() {
  await run(async () => {
    await api('/admin/update/reset', { method: 'POST' })
    updMsg.value = '更新状态已重置'
    await loadUpdate()
  })
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

    <!-- 导航：桌面端侧边栏 + 移动端横向标签 -->
    <div class="flex flex-col gap-5 lg:flex-row lg:items-start">
      <aside class="hidden w-52 shrink-0 lg:block">
        <div class="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-100">
          <nav class="space-y-3">
            <div v-for="g in navGroups" :key="g.label">
              <p class="px-2 pb-1 text-[11px] font-semibold text-stone-400">{{ g.label }}</p>
              <div class="space-y-0.5">
                <button
                  v-for="t in g.items"
                  :key="t.id"
                  class="relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition"
                  :class="tab === t.id ? 'bg-brand-50 font-semibold text-brand-700' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-700'"
                  @click="switchTab(t.id)"
                >
                  <span
                    v-if="tab === t.id"
                    class="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-500"
                  ></span>
                  <span class="grid h-6 w-6 shrink-0 place-items-center">
                    <svg class="h-[18px] w-[18px]" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" :d="navIcon(t.id)" /></svg>
                  </span>
                  {{ t.label }}
                </button>
              </div>
            </div>
          </nav>
        </div>
      </aside>

      <!-- 移动端横向标签 -->
      <div class="no-scrollbar -mx-4 flex gap-1 overflow-x-auto border-b border-stone-200 px-4 pb-px lg:hidden">
        <button
          v-for="t in tabs"
          :key="t.id"
          class="flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-medium transition"
          :class="tab === t.id ? 'border-b-2 border-brand-500 text-brand-600' : 'text-stone-400 hover:text-stone-600'"
          @click="switchTab(t.id)"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" :d="navIcon(t.id)" /></svg>
          {{ t.label }}
        </button>
      </div>

      <div class="min-w-0 flex-1 space-y-5">

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
      <div v-if="userSelectedCount > 0" class="flex flex-wrap items-center gap-2 border-b border-stone-100 bg-brand-50/60 px-4 py-2.5">
        <span class="font-medium text-brand-700">已选 {{ userSelectedCount }} 人</span>
        <button class="rounded-md bg-green-600 px-2.5 py-1 font-medium text-white hover:bg-green-700" @click="batchUsers('enable')">启用</button>
        <button class="rounded-md bg-amber-500 px-2.5 py-1 font-medium text-white hover:bg-amber-600" @click="batchUsers('disable')">封禁</button>
        <button class="rounded-md bg-brand-500 px-2.5 py-1 font-medium text-white hover:bg-brand-600" @click="batchUsers('admin')">设为管理员</button>
        <button class="rounded-md bg-stone-500 px-2.5 py-1 font-medium text-white hover:bg-stone-600" @click="batchUsers('user')">取消管理员</button>
        <button class="rounded-md bg-red-500 px-2.5 py-1 font-medium text-white hover:bg-red-600" @click="batchUsers('delete')">删除</button>
        <button class="rounded-md border border-stone-300 bg-white px-2.5 py-1 font-medium text-stone-600 hover:bg-stone-50" @click="clearUserSelect">取消选择</button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full min-w-[840px] text-left text-sm">
          <thead class="bg-stone-50 text-xs text-stone-400">
            <tr>
              <th class="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-brand-500"
                  :checked="users.length > 0 && userSelectedCount === users.length"
                  @change="toggleUserSelectAll(($event.target as HTMLInputElement).checked)"
                />
              </th>
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
            <tr v-for="u in users" :key="u.id" :class="userSelected[u.id] ? 'bg-brand-50/50' : ''">
              <td class="px-4 py-2.5">
                <input v-model="userSelected[u.id]" type="checkbox" class="h-4 w-4 accent-brand-500" @click.stop />
              </td>

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
        <div class="flex rounded-lg bg-stone-100 p-0.5">
          <button
            v-for="t in [{ v: '', l: '全部' }, { v: 'builtin', l: '自有图纸' }, { v: 'user', l: '用户上传' }]"
            :key="t.v"
            class="rounded-md px-2.5 py-1 text-xs font-medium transition"
            :class="patternType === t.v ? 'bg-white text-brand-600 shadow-sm' : 'text-stone-500 hover:text-stone-700'"
            @click="patternType = t.v; patternPage = 1; loadPatterns()"
          >
            {{ t.l }}
          </button>
        </div>
        <button class="btn btn-secondary" @click="patternPage = 1; loadPatterns()">搜索</button>
        <button class="btn btn-primary ml-auto" @click="openNewPattern">＋ 新增图纸</button>
      </div>

      <!-- 批量管理 -->
      <div v-if="patternSelectedCount > 0" class="flex flex-wrap items-center gap-2 border-b border-stone-100 bg-brand-50/60 px-4 py-2 text-xs">
        <span class="font-medium text-brand-700">已选 {{ patternSelectedCount }} 张</span>
        <button class="rounded-md bg-white px-2.5 py-1 font-medium text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50" @click="clearPatternSelect">取消选择</button>
        <button class="rounded-md bg-green-600 px-2.5 py-1 font-medium text-white hover:bg-green-700" @click="batchPatterns('publish')">批量上架</button>
        <button class="rounded-md bg-stone-500 px-2.5 py-1 font-medium text-white hover:bg-stone-600" @click="batchPatterns('hide')">批量下架</button>
        <button class="rounded-md bg-red-500 px-2.5 py-1 font-medium text-white hover:bg-red-600" @click="batchPatterns('delete')">批量删除</button>
        <span class="ml-auto flex items-center gap-1.5 text-stone-600">
          改难度
          <select v-model="batchDifficulty" class="input !w-24 !py-1 text-xs">
            <option>简单</option>
            <option>中等</option>
            <option>复杂</option>
          </select>
          <button class="rounded-md bg-brand-500 px-2.5 py-1 font-medium text-white hover:bg-brand-600" @click="batchPatterns('difficulty')">应用</button>
        </span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full min-w-[820px] text-left text-sm">
          <thead class="bg-stone-50 text-xs text-stone-400">
            <tr>
              <th class="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-brand-500"
                  :checked="patterns.length > 0 && patternSelectedCount === patterns.length"
                  @change="togglePatternSelectAll(($event.target as HTMLInputElement).checked)"
                />
              </th>
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
            <tr v-for="p in patterns" :key="p.id" :class="patternSelected[p.id] ? 'bg-brand-50/50' : ''">
              <td class="px-3 py-2.5">
                <input v-model="patternSelected[p.id]" type="checkbox" class="h-4 w-4 accent-brand-500" @click.stop />
              </td>
              <td class="px-4 py-2.5">
                <div class="flex items-center gap-1.5">
                  <router-link :to="'/pattern/' + p.id" class="font-medium text-stone-800 hover:text-brand-600">{{ p.name }}</router-link>
                  <span v-if="p.featured" class="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">⭐ 推荐</span>
                </div>
                <p class="text-[11px] font-mono text-stone-400">{{ p.id }}<span v-if="p.sourceLabel" class="ml-1.5">· {{ p.sourceLabel }}</span></p>
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
                <button class="btn btn-secondary !px-2.5 !py-1 text-xs" @click="toggleFeatured(p)">{{ p.featured ? '取消推荐' : '推荐' }}</button>
                <button class="btn btn-secondary !px-2.5 !py-1 text-xs" @click="editPattern(p)">编辑</button>
                <button class="btn btn-danger !px-2.5 !py-1 text-xs" :disabled="p.isBuiltin && !p.sourceLabel" @click="deletePattern(p)">删除</button>
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
      <div v-if="shareSelectedCount > 0" class="flex flex-wrap items-center gap-2 border-b border-stone-100 bg-brand-50/60 px-4 py-2.5">
        <span class="font-medium text-brand-700">已选 {{ shareSelectedCount }} 条</span>
        <button class="rounded-md bg-red-500 px-2.5 py-1 font-medium text-white hover:bg-red-600" @click="batchShares('delete')">删除</button>
        <button class="rounded-md border border-stone-300 bg-white px-2.5 py-1 font-medium text-stone-600 hover:bg-stone-50" @click="clearShareSelect">取消选择</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[680px] text-left text-sm">
          <thead class="bg-stone-50 text-xs text-stone-400">
            <tr>
              <th class="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-brand-500"
                  :checked="shares.length > 0 && shareSelectedCount === shares.length"
                  @change="toggleShareSelectAll(($event.target as HTMLInputElement).checked)"
                />
              </th>
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
            <tr v-for="s in shares" :key="s.id" :class="shareSelected[s.id] ? 'bg-brand-50/50' : ''">
              <td class="px-4 py-2.5">
                <input v-model="shareSelected[s.id]" type="checkbox" class="h-4 w-4 accent-brand-500" @click.stop />
              </td>
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
      <div v-if="aiSelectedCount > 0" class="flex flex-wrap items-center gap-2 border-b border-stone-100 bg-brand-50/60 px-4 py-2.5">
        <span class="font-medium text-brand-700">已选 {{ aiSelectedCount }} 条</span>
        <button class="rounded-md bg-red-500 px-2.5 py-1 font-medium text-white hover:bg-red-600" @click="batchAi('delete')">删除</button>
        <button class="rounded-md bg-amber-500 px-2.5 py-1 font-medium text-white hover:bg-amber-600" @click="batchAi('clear')">清空全部</button>
        <button class="rounded-md border border-stone-300 bg-white px-2.5 py-1 font-medium text-stone-600 hover:bg-stone-50" @click="clearAiSelect">取消选择</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[680px] text-left text-sm">
          <thead class="bg-stone-50 text-xs text-stone-400">
            <tr>
              <th class="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-brand-500"
                  :checked="aiRows.length > 0 && aiSelectedCount === aiRows.length"
                  @change="toggleAiSelectAll(($event.target as HTMLInputElement).checked)"
                />
              </th>
              <th class="px-4 py-2.5">ID</th>
              <th class="px-4 py-2.5">用户</th>
              <th class="px-4 py-2.5">描述</th>
              <th class="px-4 py-2.5">模型</th>
              <th class="px-4 py-2.5">状态</th>
              <th class="px-4 py-2.5">时间</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-100">
            <tr v-for="r in aiRows" :key="r.id" :class="aiSelected[r.id] ? 'bg-brand-50/50' : ''">
              <td class="px-4 py-2.5">
                <input v-model="aiSelected[r.id]" type="checkbox" class="h-4 w-4 accent-brand-500" @click.stop />
              </td>
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
      <div v-if="feedbackSelectedCount > 0" class="flex flex-wrap items-center gap-2 border-b border-stone-100 bg-brand-50/60 px-4 py-2.5">
        <span class="font-medium text-brand-700">已选 {{ feedbackSelectedCount }} 条</span>
        <button class="rounded-md bg-green-600 px-2.5 py-1 font-medium text-white hover:bg-green-700" @click="batchFeedback('close')">标记已处理</button>
        <button class="rounded-md bg-red-500 px-2.5 py-1 font-medium text-white hover:bg-red-600" @click="batchFeedback('delete')">删除</button>
        <button class="rounded-md border border-stone-300 bg-white px-2.5 py-1 font-medium text-stone-600 hover:bg-stone-50" @click="clearFeedbackSelect">取消选择</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[720px] text-left text-sm">
          <thead class="bg-stone-50 text-xs text-stone-400">
            <tr>
              <th class="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-brand-500"
                  :checked="feedback.length > 0 && feedbackSelectedCount === feedback.length"
                  @change="toggleFeedbackSelectAll(($event.target as HTMLInputElement).checked)"
                />
              </th>
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
            <tr v-for="f in feedback" :key="f.id" :class="feedbackSelected[f.id] ? 'bg-brand-50/50' : ''">
              <td class="px-4 py-2.5">
                <input v-model="feedbackSelected[f.id]" type="checkbox" class="h-4 w-4 accent-brand-500" @click.stop />
              </td>
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
    <section v-if="tab === 'collect'" class="max-w-5xl space-y-4">
      <div class="card space-y-4 p-5">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-stone-700">🗂 图纸采集</h2>
            <p class="text-xs text-stone-400">定时抓取多个拼豆图库（Perler 画廊、BeadPattern 画廊、MakeBead 等），新图纸自动转成内置图纸（已存在的自动跳过）。</p>
          </div>
          <input v-model="settings.collectEnabled" type="checkbox" class="h-5 w-5 accent-brand-500" title="开启定时采集" />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">采集间隔（分钟）</label>
            <input v-model.number="settings.collectIntervalMin" type="number" min="5" max="10080" class="input !w-40" />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">单次最多新增</label>
            <input v-model.number="settings.collectLimit" type="number" min="1" max="30" class="input !w-40" />
          </div>
        </div>
        <div>
          <p class="mb-1.5 text-xs font-medium text-stone-500">采集来源</p>
          <div class="grid gap-2 sm:grid-cols-2">
            <label
              v-for="s in collectSourceKeys"
              :key="s"
              class="flex items-start gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-stone-200"
              :class="expandedSource === s ? '!ring-brand-400' : ''"
            >
              <input v-model="settings.collectSources" type="checkbox" :value="s" class="mt-0.5 h-4 w-4 accent-brand-500" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-sm font-medium text-stone-700">{{ sourceLabel(s) }}</span>
                  <button type="button" class="shrink-0 text-[10px] text-brand-500 hover:underline" @click="toggleSourceExpand(s)">{{ expandedSource === s ? '收起' : '详情' }}</button>
                </div>
                <span class="block text-[11px] leading-4 text-stone-400">{{ sourceDesc(s) || '外部拼豆图纸库' }}</span>
                <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-stone-500">
                  <span>已入库 <b class="text-stone-700">{{ sourceCount(s) }}</b></span>
                  <span>上次 <span :class="sourceLastOk(s) ? 'text-green-600' : 'text-red-500'">{{ sourceLastText(s) }}</span></span>
                  <a v-if="sourceSite(s)" :href="sourceSite(s)" target="_blank" rel="noopener" class="text-brand-500 hover:underline">查看源站 ↗</a>
                </div>
                <div v-if="expandedSource === s" class="mt-2 space-y-1 border-t border-stone-100 pt-2 text-[10px] leading-4 text-stone-500">
                  <p v-if="sourceLastDetail(s).errors.length" class="font-medium text-red-500">失败原因：<template v-for="(e, i) in sourceLastDetail(s).errors" :key="i"><span v-if="i" class="mx-0.5">/</span>{{ e }}</template></p>
                  <p v-if="sourceLastDetail(s).text">{{ sourceLastDetail(s).text }}</p>
                  <p v-if="!sourceLastDetail(s).text && !sourceLastDetail(s).errors.length">尚无采集记录，可先点「立即采集一次」。</p>
                </div>
              </div>
            </label>
          </div>
        </div>
        <div>
          <p class="mb-1.5 text-xs font-medium text-stone-500">采集过滤（不想要的直接跳过）</p>
          <div class="grid gap-2 sm:grid-cols-3">
            <div>
              <label class="mb-1 block text-[11px] text-stone-400">排除标签（逗号分隔，标签含即跳过）</label>
              <input v-model="settings.collectExcludeTags" class="input !w-full !py-1.5 text-xs" placeholder="如：pokemon, fan craft, 宝可梦" />
            </div>
            <div>
              <label class="mb-1 block text-[11px] text-stone-400">最大网格宽度（0=不限）</label>
              <input v-model.number="settings.collectMaxWidth" type="number" min="0" max="500" class="input !w-full !py-1.5 text-xs" placeholder="0" />
            </div>
            <div>
              <label class="mb-1 block text-[11px] text-stone-400">最大豆数（0=不限）</label>
              <input v-model.number="settings.collectMaxBeads" type="number" min="0" max="1000000" class="input !w-full !py-1.5 text-xs" placeholder="0" />
            </div>
          </div>
          <p class="mt-1 text-[11px] text-stone-400">例：BeadPattern 画廊 704 张里大量是宝可梦同人，填排除标签可跳过；设置后会作用于手动采集和定时采集。</p>
        </div>
        <div class="rounded-xl bg-stone-50 px-4 py-3 text-xs leading-5 text-stone-500">
          <p v-if="collectStatus">
            上次采集：{{ collectStatus.lastRunAt ? fmtTime(collectStatus.lastRunAt) : '从未' }}
            <span v-if="collectStatus.lastResult"> · 上次结果：新增 {{ collectStatus.lastResult.added }}，跳过已有 {{ collectStatus.lastResult.skippedExisting }}，过滤 {{ collectStatus.lastResult.skippedByFilter ?? 0 }}，失败 {{ collectStatus.lastResult.errors }}</span>
          <span v-if="collectStatus.lastResult?.results?.length" class="mt-0.5 block">分来源：<template v-for="(s, i) in collectStatus.lastResult.results" :key="s.source">{{ i ? '、' : '' }}{{ s.label || s.source }} +{{ s.added ?? 0 }}{{ s.error ? '（' + s.error + '）' : '' }}</template></span>
          </p>
          <p v-else>尚未采集过。</p>
          <p v-if="collectMsg" class="mt-1 font-medium" :class="collectMsg.startsWith('❌') ? 'text-red-500' : collectMsg.startsWith('✅') ? 'text-green-600' : 'text-brand-600'">{{ collectMsg }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button class="btn btn-secondary" :disabled="collectMsg.startsWith('⏳')" @click="runCollect">⚡ 立即采集一次</button>
          <button
            class="btn btn-secondary"
            :class="collectPreviewMode ? '!bg-brand-500 !text-white' : ''"
            @click="collectPreviewMode = !collectPreviewMode"
          >👀 预览后再入库</button>
        </div>

        <!-- 采集预览：抓取+转换但不入库，勾选后再导入 -->
        <div v-if="collectPreviewMode" class="space-y-3 rounded-xl bg-stone-50 p-4">
          <div class="flex flex-wrap items-center gap-2 text-xs text-stone-500">
            <span class="font-medium">预览来源：</span>
            <select v-model="previewSource" class="input !w-48 !py-1.5 text-xs">
              <option v-for="s in collectStatus?.sources || []" :key="s" :value="s">{{ sourceLabel(s) }}</option>
            </select>
            <span class="font-medium">预览条数：</span>
            <select v-model="previewLimit" class="input !w-24 !py-1.5 text-xs">
              <option :value="8">8</option>
              <option :value="12">12</option>
              <option :value="16">16</option>
              <option :value="24">24</option>
              <option :value="30">30</option>
            </select>
            <button class="btn btn-secondary !py-1 text-xs" :disabled="previewLoading" @click="runPreview">抓取预览</button>
            <label v-if="previewItems.length" class="ml-auto flex cursor-pointer items-center gap-1.5 font-medium">
              <input
                type="checkbox"
                class="h-4 w-4 accent-brand-500"
                :checked="previewItems.length > 0 && previewSelectedCount === previewItems.length"
                @change="toggleAllPreview(($event.target as HTMLInputElement).checked)"
              />
              全选
            </label>
          </div>
          <p
            v-if="previewMsg"
            class="text-xs"
            :class="previewMsg.startsWith('❌') ? 'text-red-500' : previewMsg.startsWith('✅') ? 'text-green-600' : 'text-stone-500'"
          >{{ previewMsg }}</p>
          <div v-if="previewItems.length" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <div
              v-for="it in previewItems"
              :key="it.id"
              class="cursor-pointer overflow-hidden rounded-xl bg-white ring-1 ring-stone-200 transition"
              :class="previewSelected[it.id] ? '!ring-2 !ring-brand-500' : ''"
              @click="togglePreview(it.id)"
            >
              <div class="relative">
                <img :src="previewThumb(it)" :alt="it.name" class="h-32 w-full bg-white object-contain" />
                <input v-model="previewSelected[it.id]" type="checkbox" class="absolute right-1.5 top-1.5 h-4 w-4 accent-brand-500" @click.stop />
              </div>
              <div class="p-2">
                <p class="truncate text-xs font-medium text-stone-700" :title="it.name">{{ it.name }}</p>
                <p class="mt-0.5 text-[10px] text-stone-400">{{ it.width }}×{{ it.height }} · {{ it.beads }} 豆 · {{ it.difficulty }}</p>
                <p v-if="it.tags?.length" class="mt-0.5 truncate text-[10px] text-stone-400">{{ it.tags.slice(0, 3).join('、') }}</p>
              </div>
            </div>
          </div>
          <div v-if="previewItems.length" class="flex items-center gap-2">
            <button class="btn btn-primary !py-1.5 text-xs" :disabled="previewLoading || previewSelectedCount === 0" @click="importSelected">
              📥 导入选中 {{ previewSelectedCount }} 条
            </button>
          </div>
        </div>
        <!-- 采集历史 -->
        <div v-if="collectStatus?.history?.length" class="rounded-xl bg-stone-50 px-4 py-3">
          <p class="mb-2 text-xs font-semibold text-stone-600">最近采集记录（最近 20 次）</p>
          <div class="max-h-44 overflow-auto">
            <table class="w-full text-left text-[11px] text-stone-500">
              <thead>
                <tr class="text-stone-400">
                  <th class="whitespace-nowrap py-1 pr-3 font-medium">时间</th>
                  <th class="whitespace-nowrap py-1 pr-3 font-medium">类型</th>
                  <th class="py-1 font-medium">说明</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(h, hi) in collectStatus.history" :key="hi" class="cursor-pointer border-t border-stone-200/60" @click="expandedHistory = expandedHistory === hi ? -1 : hi">
                  <td class="whitespace-nowrap py-1 pr-3">{{ fmtTime(h.at) }}</td>
                  <td class="whitespace-nowrap py-1 pr-3">{{ h.action === 'admin_collect_run' ? '采集' : '导入' }}</td>
                  <td class="py-1" :title="h.detail">{{ expandedHistory === hi ? h.detail : (h.detail.length > 40 ? h.detail.slice(0, 40) + '?' : h.detail) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p v-if="settingsMsg" class="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600">{{ settingsMsg }}</p>
      <div class="flex justify-end">
        <button class="btn btn-primary" @click="saveSettings">保存采集设置</button>
      </div>
    </section>

    <section v-if="tab === 'settings'" class="max-w-3xl space-y-4">
      <div class="card space-y-4 p-5">
        <h2 class="text-sm font-semibold text-stone-700">📢 基础设置</h2>
        <div>
          <label class="mb-1.5 block text-xs font-medium text-stone-500">站点公告</label>
          <textarea v-model="settings.siteNotice" rows="3" class="input w-full resize-y" placeholder="显示在页面顶部的公告"></textarea>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-50 px-4 py-3">
          <div>
            <p class="text-sm font-medium text-stone-700">维护模式</p>
            <p class="text-xs text-stone-400">开启后前端顶部显示维护提示</p>
          </div>
          <input v-model="settings.maintenance" type="checkbox" class="h-5 w-5 accent-brand-500" />
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-50 px-4 py-3">
          <div>
            <p class="text-sm font-medium text-stone-700">开放注册</p>
            <p class="text-xs text-stone-400">关闭后新用户无法注册，只能登录已有账号</p>
          </div>
          <input v-model="settings.registerOpen" type="checkbox" class="h-5 w-5 accent-brand-500" />
        </div>
      </div>

      <div class="card space-y-4 p-5">
        <h2 class="text-sm font-semibold text-stone-700">🧩 功能开关</h2>
        <p class="text-xs text-stone-400">关闭后对应菜单隐藏、直接访问会被引导回首页。</p>
        <div class="grid gap-2 sm:grid-cols-2">
          <div v-for="f in featureItems" :key="f.key" class="flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-4 py-3">
            <div>
              <p class="text-sm font-medium text-stone-700">{{ f.icon }} {{ f.label }}</p>
              <p class="text-xs text-stone-400">{{ f.desc }}</p>
            </div>
            <input v-model="settings.features[f.key]" type="checkbox" class="h-5 w-5 accent-brand-500" />
          </div>
        </div>
      </div>

      <div class="card space-y-4 p-5">
        <h2 class="text-sm font-semibold text-stone-700">🤖 AI 设置</h2>
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-50 px-4 py-3">
          <div>
            <p class="text-sm font-medium text-stone-700">AI 生成开关</p>
            <p class="text-xs text-stone-400">关闭后 AI 生成接口返回不可用</p>
          </div>
          <input v-model="settings.aiEnabled" type="checkbox" class="h-5 w-5 accent-brand-500" />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">登录用户每日 AI 次数上限</label>
            <input v-model.number="settings.aiDailyLimit" type="number" min="1" max="10000" class="input !w-40" />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">游客每日 AI 次数上限</label>
            <input v-model.number="settings.aiGuestLimit" type="number" min="0" max="10000" class="input !w-40" />
            <p class="mt-1 text-[11px] text-stone-400">填 0 表示游客完全不能使用 AI 生成。</p>
          </div>
        </div>
      </div>

      <div class="card space-y-4 p-5">
        <h2 class="text-sm font-semibold text-stone-700">🔑 AI 服务配置</h2>
        <p class="text-xs text-stone-400">AI 生图 / 参考图编辑使用的服务地址与密钥，保存后立即生效。</p>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">API 服务地址</label>
            <input v-model="settings.aiApiBase" class="input w-full" placeholder="https://dashscope.aliyuncs.com/api/v1" />
            <p class="mt-1 text-[11px] text-stone-400">留空则使用默认地址（通义千问 DashScope）。</p>
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">API Key</label>
            <input
              v-model="settings.aiApiKey"
              type="password"
              class="input w-full"
              :placeholder="settings.aiApiKeyConfigured ? '已配置，留空保持不变' : '填入新的 API Key'"
            />
            <p class="mt-1 text-[11px] text-stone-400">
              <span v-if="settings.aiApiKeyConfigured" class="mr-2">当前已配置：{{ settings.aiApiKeyMasked }}</span>
              <label class="inline-flex cursor-pointer items-center gap-1">
                <input v-model="settings.aiApiKeyClear" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" />
                清除 Key（回退到环境变量）
              </label>
            </p>
          </div>
        </div>
        <p class="text-[11px] leading-4 text-stone-400">
          生图模型：<code class="rounded bg-stone-100 px-1">{{ settings.aiModel }}</code> · 参考图模型：<code class="rounded bg-stone-100 px-1">{{ settings.aiEditModel }}</code>
          （模型名在服务端 .env 的 WANX_MODEL / WANX_EDIT_MODEL 中配置）
        </p>
      </div>


      <div class="card space-y-4 p-5">
        <h2 class="text-sm font-semibold text-stone-700">📧 邮件服务（找回密码）</h2>
        <p class="text-xs text-stone-400">配置 SMTP 后，用户可在登录页点「忘记密码」通过邮箱重置密码。</p>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">SMTP 服务器地址</label>
            <input v-model="settings.smtpHost" class="input w-full" placeholder="smtp.example.com" />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">端口</label>
            <input v-model.number="settings.smtpPort" type="number" min="1" max="65535" class="input !w-40" placeholder="465" />
            <p class="mt-1 text-[11px] text-stone-400">465 = SSL，587 = STARTTLS。</p>
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">账号（邮箱）</label>
            <input v-model="settings.smtpUser" class="input w-full" placeholder="noreply@example.com" />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">密码 / 授权码</label>
            <input v-model="settings.smtpPass" type="password" class="input w-full" :placeholder="settings.smtpPassConfigured ? '已配置，留空保持不变' : '填入密码或授权码'" />
            <label class="mt-1 inline-flex cursor-pointer items-center gap-1 text-[11px] text-stone-400">
              <input v-model="settings.smtpPassClear" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" />
              清除密码
            </label>
          </div>
          <div class="sm:col-span-2">
            <label class="mb-1.5 block text-xs font-medium text-stone-500">发件人地址（可选）</label>
            <input v-model="settings.smtpFrom" class="input w-full" placeholder="拼豆工坊 <noreply@example.com>" />
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <input v-model="smtpTestTo" class="input !w-64" placeholder="测试收件邮箱" />
          <button class="btn btn-secondary" :disabled="smtpTesting" @click="testSmtp">{{ smtpTesting ? '发送中…' : '发送测试邮件' }}</button>
          <span v-if="smtpTestMsg" class="text-xs" :class="smtpTestErr ? 'text-red-600' : 'text-green-600'">{{ smtpTestMsg }}</span>
        </div>
      </div>

      <div class="card space-y-4 p-5">
        <h2 class="text-sm font-semibold text-stone-700">🎁 积分 / AI 兑换</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">每日签到积分</label>
            <input v-model.number="settings.checkinPoints" type="number" min="1" max="1000" class="input !w-40" />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">连续 7 天额外奖励</label>
            <input v-model.number="settings.checkinStreakBonus" type="number" min="0" max="1000" class="input !w-40" />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">兑换消耗积分</label>
            <input v-model.number="settings.exchangeCost" type="number" min="1" max="10000" class="input !w-40" />
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">兑换获得 AI 次数</label>
            <input v-model.number="settings.exchangeQuota" type="number" min="1" max="1000" class="input !w-40" />
          </div>
        </div>
      </div>

      <div class="card space-y-4 p-5">
        <h2 class="text-sm font-semibold text-stone-700">🔄 在线更新配置</h2>
        <div>
          <label class="mb-1.5 block text-xs font-medium text-stone-500">pm2 进程名</label>
          <input v-model="settings.updatePm2Name" class="input !w-64" placeholder="pindou" />
          <p class="mt-1 text-[11px] text-stone-400">仅当服务通过 pm2 启动时需要，更新完成后会自动执行 pm2 restart 该进程。</p>
        </div>
      </div>

      <p v-if="settingsMsg" class="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600">{{ settingsMsg }}</p>
      <div class="flex justify-end">
        <button class="btn btn-primary" @click="saveSettings">保存设置</button>
      </div>
    </section>

    <!-- 操作日志 -->
    <section v-if="tab === 'logs'" class="card overflow-hidden">
      <div v-if="logSelectedCount > 0" class="flex flex-wrap items-center gap-2 border-b border-stone-100 bg-brand-50/60 px-4 py-2.5">
        <span class="font-medium text-brand-700">已选 {{ logSelectedCount }} 条</span>
        <button class="rounded-md bg-red-500 px-2.5 py-1 font-medium text-white hover:bg-red-600" @click="batchLogs('delete')">删除</button>
        <button class="rounded-md bg-amber-500 px-2.5 py-1 font-medium text-white hover:bg-amber-600" @click="batchLogs('clear')">清空全部</button>
        <button class="rounded-md border border-stone-300 bg-white px-2.5 py-1 font-medium text-stone-600 hover:bg-stone-50" @click="clearLogSelect">取消选择</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[680px] text-left text-sm">
          <thead class="bg-stone-50 text-xs text-stone-400">
            <tr>
              <th class="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-brand-500"
                  :checked="logs.length > 0 && logSelectedCount === logs.length"
                  @change="toggleLogSelectAll(($event.target as HTMLInputElement).checked)"
                />
              </th>
              <th class="px-4 py-2.5">ID</th>
              <th class="px-4 py-2.5">用户</th>
              <th class="px-4 py-2.5">操作</th>
              <th class="px-4 py-2.5">详情</th>
              <th class="px-4 py-2.5">IP</th>
              <th class="px-4 py-2.5">时间</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-100">
            <tr v-for="l in logs" :key="l.id" :class="logSelected[l.id] ? 'bg-brand-50/50' : ''">
              <td class="px-4 py-2.5">
                <input v-model="logSelected[l.id]" type="checkbox" class="h-4 w-4 accent-brand-500" @click.stop />
              </td>
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
    <!-- 版本更新 -->
    <section v-if="tab === 'update'" class="max-w-3xl space-y-4">
      <div class="card space-y-4 p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-base font-semibold text-stone-800">⬇ 版本更新</h2>
          <div class="flex items-center gap-2">
            <button class="btn btn-secondary !px-3 !py-1.5" :disabled="loading" @click="loadUpdate">刷新状态</button>
            <button class="btn btn-secondary !px-3 !py-1.5" :disabled="loading" @click="askResetUpdate">重置更新状态</button>
          </div>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="rounded-xl bg-stone-50 px-4 py-3">
            <p class="text-xs text-stone-400">当前版本</p>
            <p class="mt-1 text-lg font-semibold text-stone-800">{{ upd?.current || '-' }}</p>
          </div>
          <div class="rounded-xl bg-stone-50 px-4 py-3">
            <p class="text-xs text-stone-400">最新版本</p>
            <p class="mt-1 text-lg font-semibold" :class="upd?.hasUpdate ? 'text-brand-600' : 'text-stone-800'">{{ upd?.latestVersion || '未获取' }}</p>
          </div>
        </div>
        <div v-if="upd" class="rounded-xl px-4 py-3" :class="upd.running ? 'bg-amber-50 text-amber-700' : upd.hasUpdate ? 'bg-green-50 text-green-700' : 'bg-stone-50 text-stone-600'">
          <template v-if="upd.running">
            ⏳ 正在更新中：{{ upd.status?.step || '…' }}
            <span class="ml-2 text-xs opacity-80">已运行 {{ fmtElapsed(upd.status?.startedAt) }}（超过 30 分钟无进展会自动重置，可重新点击更新）</span>
          </template>
          <template v-else-if="upd.needsRestart && !upd.stale">⏳ 构建已完成，正在重启服务…（服务重启后会自动标记完成）</template>
          <template v-else-if="upd.hasUpdate">✨ 发现新版本 {{ upd.latestVersion }}（当前 {{ upd.current }}）</template>
          <template v-else-if="upd.latestVersion">✅ 已是最新版本（{{ upd.current }}）</template>
          <template v-else>ℹ️ 尚未获取到远程版本信息（请检查服务器能否访问 GitHub）</template>
        </div>
        <div v-if="upd?.needsRestart || upd?.stale" class="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <span>
            <template v-if="upd.needsRestart && !upd.stale">⏳ 构建已完成，正在重启服务…（如页面已正常访问但状态未更新，可点击右上角「重置更新状态」）</template>
            <template v-else-if="upd.stale && upd.needsRestart">⚠️ 上次更新疑似在重启服务时中断，可重置状态后重新检查。</template>
            <template v-else>⚠️ 上次更新疑似中断（已运行超过 30 分钟无进展），可重置状态后重新检查。</template>
          </span>
        </div>
        <p v-if="updMsg" class="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">{{ updMsg }}</p>
        <p v-if="upd?.localCommit && !upd?.latestTag" class="text-[11px] text-stone-400">本地提交 {{ upd.localCommit }} · 远程 {{ upd.remoteCommit || '未知' }}（{{ upd.branch || 'main' }} 分支）</p>
        <p v-if="upd?.status?.error" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">上次更新失败：{{ upd.status.error }}</p>

        <div v-if="upd?.releaseNotes" class="rounded-xl border border-stone-100 p-4">
          <h3 class="mb-2 text-sm font-semibold text-stone-700">📝 更新日志（{{ upd.latestTag }}）</h3>
          <pre class="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-xs leading-5 text-stone-600">{{ upd.releaseNotes }}</pre>
        </div>

        <div class="flex flex-wrap items-center gap-3 border-t border-stone-100 pt-4">
          <button class="btn btn-primary" :disabled="upd?.running || upd?.needsRestart || !upd?.hasUpdate" @click="askRunUpdate">一键更新到最新版</button>
          <span class="text-xs text-stone-400">更新将执行：拉取代码 → 安装依赖 → 构建前端 → 重启服务（pm2）</span>
        </div>
        <div v-if="upd?.logTail && upd?.logVisible !== false" class="rounded-xl border border-stone-100 p-4">
          <h3 class="mb-2 text-sm font-semibold text-stone-700">🪵 执行日志</h3>
          <pre class="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-3 font-mono text-xs leading-5 text-stone-600">{{ upd.logTail }}</pre>
        </div>
      </div>
    </section>

    <!-- 色卡管理 -->
    <section v-if="tab === 'palettes'" class="card overflow-hidden">
      <div class="flex flex-wrap items-center gap-2 p-4">
        <h2 class="text-sm font-semibold text-stone-700">品牌色卡（数据库）</h2>
        <p v-if="palMsg" class="text-xs text-green-600">{{ palMsg }}</p>
        <p v-if="palErr" class="text-xs text-red-600">{{ palErr }}</p>
        <button class="btn btn-primary ml-auto" @click="openNewPalette">＋ 新增色卡</button>
      </div>
      <div v-if="paletteSelectedCount > 0" class="flex flex-wrap items-center gap-2 border-b border-stone-100 bg-brand-50/60 px-4 py-2.5">
        <span class="font-medium text-brand-700">已选 {{ paletteSelectedCount }} 个</span>
        <button class="rounded-md bg-red-500 px-2.5 py-1 font-medium text-white hover:bg-red-600" @click="batchPalettes('delete')">删除</button>
        <button class="rounded-md border border-stone-300 bg-white px-2.5 py-1 font-medium text-stone-600 hover:bg-stone-50" @click="clearPaletteSelect">取消选择</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[680px] text-left text-sm">
          <thead class="bg-stone-50 text-xs text-stone-400">
            <tr>
              <th class="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-brand-500"
                  :checked="palettes.length > 0 && paletteSelectedCount === palettes.length"
                  @change="togglePaletteSelectAll(($event.target as HTMLInputElement).checked)"
                />
              </th>
              <th class="px-4 py-2.5">名称</th>
              <th class="px-4 py-2.5">品牌</th>
              <th class="px-4 py-2.5">色数</th>
              <th class="px-4 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-100">
            <tr v-for="p in palettes" :key="p.id" :class="paletteSelected[p.id] ? 'bg-brand-50/50' : ''">
              <td class="px-4 py-2.5">
                <input v-model="paletteSelected[p.id]" type="checkbox" class="h-4 w-4 accent-brand-500" @click.stop />
              </td>
              <td class="px-4 py-2.5">
                <p class="font-medium text-stone-800">{{ p.title }}</p>
                <p class="font-mono text-[11px] text-stone-400">{{ p.id }}</p>
              </td>
              <td class="px-4 py-2.5">
                <span class="chip !text-[11px]" :class="p.brand === '进口' ? '!bg-purple-50 !text-purple-600 !ring-purple-100' : '!bg-brand-50 !text-brand-600 !ring-brand-100'">{{ p.brand }}</span>
              </td>
              <td class="px-4 py-2.5 text-stone-600">{{ p.count }}</td>
              <td class="px-4 py-2.5 text-right whitespace-nowrap">
                <button class="btn btn-secondary !px-2.5 !py-1 text-xs" @click="editPaletteMeta(p)">信息</button>
                <button class="btn btn-secondary !px-2.5 !py-1 text-xs" @click="openPaletteColors(p)">编辑颜色</button>
                <button class="btn btn-danger !px-2.5 !py-1 text-xs" @click="deletePaletteAdmin(p)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 新增图纸 -->
    <div v-if="showNewPattern" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="showNewPattern = false">
      <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <h3 class="text-base font-semibold text-stone-800">＋ 新增图纸</h3>
        <p class="mt-1 text-xs text-stone-400">新增后立即出现在前端图纸库；支持「推荐」与「下架」。</p>
        <div class="mt-4 space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-stone-500">名称 *</label>
              <input v-model="newPat.name" class="input" placeholder="图纸名称" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-stone-500">ID（可选）</label>
              <input v-model="newPat.id" class="input" placeholder="留空自动生成" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-stone-500">色卡</label>
              <select v-model="newPat.paletteId" class="input !py-1.5">
                <option v-for="pl in PALETTES" :key="pl.id" :value="pl.id">{{ pl.title }}（{{ pl.count }} 色）</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-stone-500">来源</label>
              <input v-model="newPat.sourceLabel" class="input" placeholder="如：原创" />
            </div>
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-stone-500">标签（逗号分隔）</label>
            <input v-model="newPat.tags" class="input" placeholder="动物, 卡通, 简单" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-stone-500">难度</label>
              <select v-model="newPat.difficulty" class="input !py-1.5">
                <option value="">自动</option>
                <option value="简单">简单</option>
                <option value="中等">中等</option>
                <option value="复杂">复杂</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-stone-500">状态</label>
              <select v-model="newPat.status" class="input !py-1.5">
                <option value="published">上架</option>
                <option value="hidden">下架</option>
              </select>
            </div>
          </div>
          <label class="flex items-center gap-2 text-sm text-stone-700">
            <input v-model="newPat.featured" type="checkbox" class="h-4 w-4 accent-brand-500" /> ⭐ 设为推荐图纸
          </label>
          <div>
            <label class="mb-1 block text-xs font-medium text-stone-500">图纸内容 *</label>
            <textarea v-model="newPat.content" rows="6" class="input w-full resize-y font-mono text-xs" placeholder="每行一个格子：色号用空格/逗号分隔，空格用 . 表示&#10;A1 B2 .&#10;. C3 D4&#10;或粘贴 JSON 数组"></textarea>
            <p class="mt-1 text-[11px] text-stone-400">示例：第一行 A1 B2 .，第二行 . C3 D4（共两行三列）。</p>
          </div>
        </div>
        <p v-if="newPatMsg" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ newPatMsg }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn btn-secondary" @click="showNewPattern = false">取消</button>
          <button class="btn btn-primary" @click="createPattern">创建图纸</button>
        </div>
      </div>
    </div>
    <!-- 新增色卡 -->
    <div v-if="showNewPalette" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="showNewPalette = false">
      <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <h3 class="text-base font-semibold text-stone-800">＋ 新增色卡</h3>
        <p class="mt-1 text-xs text-stone-400">新增后前端色卡页与生成器立即可用（需要刷新页面后生效）。</p>
        <div class="mt-4 space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-stone-500">ID *（小写字母数字/短横线）</label>
              <input v-model="newPal.id" class="input" placeholder="如 my-palette" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-stone-500">名称 *</label>
              <input v-model="newPal.title" class="input" placeholder="色卡名称" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-stone-500">品牌</label>
              <select v-model="newPal.brand" class="input !py-1.5">
                <option value="国内">国内</option>
                <option value="进口">进口</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-stone-500">简介</label>
              <input v-model="newPal.description" class="input" placeholder="可选" />
            </div>
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-stone-500">颜色 *（每行：色号 #RRGGBB）</label>
            <textarea v-model="newPal.colors" rows="8" class="input w-full resize-y font-mono text-xs" placeholder="A1 #FAF5CD&#10;B2 #4A3B32"></textarea>
          </div>
        </div>
        <p v-if="newPalMsg" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ newPalMsg }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn btn-secondary" @click="showNewPalette = false">取消</button>
          <button class="btn btn-primary" @click="createPalette">创建色卡</button>
        </div>
      </div>
    </div>

    <!-- 编辑色卡颜色 -->
    <div v-if="showPaletteColors" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="showPaletteColors = false">
      <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <h3 class="text-base font-semibold text-stone-800">🎨 编辑色卡：{{ paletteColorsTitle }}</h3>
        <p class="mt-1 text-xs text-stone-400">每行一个「色号 #RRGGBB」，保存会整体替换全部颜色。</p>
        <textarea v-model="paletteColorsText" rows="12" class="input mt-3 w-full resize-y font-mono text-xs" placeholder="A1 #FAF5CD"></textarea>
        <p v-if="paletteColorsMsg" class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ paletteColorsMsg }}</p>
        <p class="mt-1 text-[11px] text-stone-400">当前共 {{ parseColorsText(paletteColorsText).length }} 个颜色</p>
        <div class="mt-4 flex justify-end gap-2">
          <button class="btn btn-secondary" @click="showPaletteColors = false">取消</button>
          <button class="btn btn-primary" @click="savePaletteColors">保存颜色</button>
        </div>
      </div>
    </div>
      </div>
    </div>

  </div>

    <!-- 通用确认弹窗（替换浏览器原生 confirm） -->
    <div v-if="confirmState" class="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" @click.self="closeConfirm">
      <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div class="flex items-start gap-3">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </span>
          <div class="min-w-0 flex-1">
            <h3 class="text-base font-semibold text-stone-800">{{ confirmState.title }}</h3>
            <p class="mt-1.5 text-sm leading-6 text-stone-500">{{ confirmState.message }}</p>
            <div v-if="confirmState.flow" class="mt-4 flex flex-wrap items-center gap-1.5">
              <template v-for="(step, si) in confirmState.flow" :key="step">
                <span v-if="si > 0" class="text-stone-300">→</span>
                <span class="rounded-lg bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600">{{ step }}</span>
              </template>
            </div>
            <div v-if="confirmState.note" class="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
              {{ confirmState.note }}
            </div>
          </div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn btn-secondary" @click="closeConfirm">取消</button>
          <button class="btn btn-primary" @click="doConfirm">{{ confirmState.confirmText || '确定' }}</button>
        </div>
      </div>
    </div>
</template>
