<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { paletteGroups } from '../data/palettes'
import { remoteHealth } from '../utils/shareApi'
import { useAuth, type AiUsage } from '../composables/useAuth'
import { api, getToken } from '../utils/api'

const router = useRouter()
const prompt = ref('一只可爱的橘猫，卡通插画，大色块')
const paletteId = ref('mard-221-github')
const width = ref(64)
const generating = ref(false)
const error = ref('')
const imageBase64 = ref('')
const usedModel = ref('')
// F3 AI 参考图模式：可选上传参考图，按描述重绘（img2img）
const refImageBase64 = ref('')
const refImageName = ref('')
function onRefImageChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    error.value = '请选择图片文件'
    input.value = ''
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    error.value = '参考图不能超过 10MB'
    input.value = ''
    return
  }
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    URL.revokeObjectURL(url)
    // 参考图要求边长 512~4096：过大缩小到 1024 控制体积，过小放大到至少 512 避免被接口拒绝
    const MIN = 512
    const MAX = 1024
    let w = img.naturalWidth
    let h = img.naturalHeight
    const mx = Math.max(w, h)
    if (mx > MAX || mx < MIN) {
      const target = mx > MAX ? MAX : MIN
      if (w > h) { h = Math.max(1, Math.round((h / w) * target)); w = target }
      else { w = Math.max(1, Math.round((w / h) * target)); h = target }
    }
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const ctx = cv.getContext('2d')
    if (!ctx) { error.value = '参考图处理失败'; return }
    ctx.drawImage(img, 0, 0, w, h)
    const keepAlpha = /png|webp/i.test(file.type)
    refImageBase64.value = cv.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.88)
    refImageName.value = file.name
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    error.value = '参考图加载失败，请换一张'
  }
  img.src = url
}
function removeRefImage() {
  refImageBase64.value = ''
  refImageName.value = ''
}
const serverOk = ref<boolean | null>(null)
const auth = useAuth()
const { isLoggedIn } = auth
const usage = ref<AiUsage | null>(null)

// ---------- 生成历史（登录用户云端，游客 localStorage） ----------
interface AiHistoryItem {
  id?: number
  prompt: string
  imageBase64: string
  paletteId?: string
  width?: number
  model?: string
  createdAt: number
}
const HISTORY_KEY = 'pd_ai_history'
const history = ref<AiHistoryItem[]>([])

function loadHistory() {
  if (auth.state.user) {
    api<{ history: AiHistoryItem[] }>('/ai/history')
      .then((d) => { history.value = d.history || [] })
      .catch(() => {})
  } else {
    try {
      history.value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as AiHistoryItem[]
    } catch {
      history.value = []
    }
  }
}
function saveGuestHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value.slice(0, 12)))
  } catch {
    /* noop */
  }
}
function recordHistory(rawPrompt: string, img: string) {
  if (!img) return
  if (auth.state.user) return // 后端已自动记录
  history.value.unshift({ prompt: rawPrompt.slice(0, 120), imageBase64: img, paletteId: paletteId.value, width: width.value, createdAt: Date.now() })
  history.value = history.value.slice(0, 12)
  saveGuestHistory()
}
function useHistoryItem(h: AiHistoryItem) {
  sessionStorage.setItem('pd_ai_image', h.imageBase64)
  router.push(`/generator?ai=1&palette=${encodeURIComponent(h.paletteId || paletteId.value)}&width=${h.width || width.value}`)
}
async function deleteHistoryItem(h: AiHistoryItem) {
  if (auth.state.user && h.id) {
    try {
      await api(`/ai/history/${h.id}`, { method: 'DELETE' })
      history.value = history.value.filter((x) => x.id !== h.id)
    } catch {
      /* ignore */
    }
  } else {
    history.value = history.value.filter((x) => x !== h)
    saveGuestHistory()
  }
}
function clearHistory() {
  if (!confirm('确定清空全部生成历史吗？')) return
  if (auth.state.user) {
    Promise.all(
      history.value.filter((h) => h.id).map((h) => api(`/ai/history/${h.id}`, { method: 'DELETE' }).catch(() => {}))
    ).then(() => {
      history.value = []
    })
  } else {
    history.value = []
    saveGuestHistory()
  }
}
function fmtHistoryTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function getGuestId(): string {
  let id = ''
  try {
    id = localStorage.getItem('pd_guest_id') || ''
  } catch {
    /* noop */
  }
  if (!id) {
    id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
    try {
      localStorage.setItem('pd_guest_id', id)
    } catch {
      /* noop */
    }
  }
  return id
}

async function refreshUsage() {
  if (auth.state.user) {
    auth.aiUsage().then((u) => (usage.value = u)).catch(() => {})
    return
  }
  try {
    const res = await fetch('/api/ai/guest-usage?guestId=' + encodeURIComponent(getGuestId()))
    if (res.ok) usage.value = (await res.json()) as AiUsage
  } catch {
    /* 后端不可用 */
  }
}

onMounted(() => {
  remoteHealth().then((h) => (serverOk.value = h ? h.ai : false))
  auth.fetchMe().then(() => {
    refreshUsage()
    loadHistory()
  })
})

/** 追加拼豆友好提示，提升转图纸效果 */
function buildPrompt(p: string): string {
  return `${p}，简洁卡通插画风格，边缘清晰，大色块，背景纯色，适合像素化，内容健康向上`
}

/** 把后端/AI 的原始报错翻译成用户能看懂的话 */
function friendlyError(raw: string): string {
  if (!raw) return 'AI 生成失败，请稍后重试'
  if (/SAFETY|inappropriate|sensitive|敏感|不合规/i.test(raw)) {
    return '内容安全审核未通过：可能是描述中包含了敏感或不合适的内容。请把描述改得更温和、正向一点再试（如避免暴力、血腥、恐怖、争议等词汇）。'
  }
  if (/超时|timeout/i.test(raw)) return 'AI 生成超时了，请稍后再试一次。'
  if (/between \d+ and \d+ pixels|image (width|height)|尺寸|512|4096/i.test(raw)) {
    return '参考图尺寸需在 512~4096 像素之间。上传时已自动调整，若仍失败请换一张边长更大的图片再试。'
  }
  if (/游客今日 AI 生成次数已用完/i.test(raw)) return '游客今日 AI 生成次数已用完，登录后可获得更多次数。'
  if (/^AI 生成失败/i.test(raw)) return raw
  return 'AI 生成失败：' + raw
}

async function generate() {
  const p = prompt.value.trim()
  if (!p) {
    error.value = '请先输入图片描述'
    return
  }
  error.value = ''
  generating.value = true
  imageBase64.value = ''
  try {
    const res = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}) },
      body: JSON.stringify({ prompt: buildPrompt(p), guestId: getGuestId(), paletteId: paletteId.value, width: width.value, referenceImage: refImageBase64.value || undefined })
    })
    const data = (await res.json()) as { ok?: boolean; imageBase64?: string; model?: string; error?: string }
    if (!res.ok || !data.ok) {
      error.value = friendlyError(data.error || '')
      return
    }
    imageBase64.value = data.imageBase64 ?? ''
    usedModel.value = data.model ?? ''
    recordHistory(p, imageBase64.value)
  } catch {
    error.value = 'AI 服务暂时不可用，请稍后再试'
  } finally {
    generating.value = false
    refreshUsage()
  }
}

function useInGenerator() {
  if (!imageBase64.value) return
  sessionStorage.setItem('pd_ai_image', imageBase64.value)
  router.push(`/generator?ai=1&palette=${encodeURIComponent(paletteId.value)}&width=${width.value}`)
}
</script>

<template>
  <div class="space-y-5">
    <div>
      <h1 class="text-xl font-bold text-stone-800 sm:text-2xl">🤖 AI 生成图纸</h1>
      <p class="mt-1 text-sm text-stone-500">输入一段文字描述，AI 先生成图片，再一键转成拼豆图纸。每次生成会消耗少量 AI 服务额度。</p>
    </div>

    <div class="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <!-- 输入 -->
      <section class="card space-y-4 p-5">
        <div>
          <label class="mb-1.5 block text-xs font-medium text-stone-500">图片描述</label>
          <textarea
            v-model="prompt"
            rows="4"
            class="input w-full resize-y"
            placeholder="例如：一只戴着蝴蝶结的白色小猫，卡通插画，大色块"
          ></textarea>
          <p class="mt-1 text-[11px] text-stone-400">描述越具体效果越好：主体、颜色、风格、背景。</p>
        </div>

        <!-- 参考图（可选）：AI 按描述重绘这张图 -->
        <div>
          <label class="mb-1.5 block text-xs font-medium text-stone-500">参考图（可选）</label>
          <div v-if="refImageBase64" class="relative overflow-hidden rounded-xl ring-1 ring-stone-200">
            <img :src="refImageBase64" alt="参考图" class="h-36 w-full object-cover" />
            <div class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/55 px-2 py-1 text-[11px] text-white">
              <span class="truncate">{{ refImageName }}</span>
              <button class="shrink-0 rounded-md bg-white/20 px-2 py-0.5 hover:bg-white/30" @click="removeRefImage">移除</button>
            </div>
          </div>
          <label
            v-else
            class="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-stone-200 bg-stone-50 py-6 text-xs text-stone-400 transition hover:border-brand-300 hover:text-brand-500"
          >
            <input type="file" accept="image/*" class="hidden" @change="onRefImageChange" />
            <span class="text-xl">🖼️</span>
            <span>上传参考图，AI 将按你的描述改造这张图（可选）</span>
          </label>
          <p class="mt-1 text-[11px] text-stone-400">示例：上传角色图并描述「改成拼豆风格的卡通插画」。不传参考图则为纯文字生图。参考图边长需 512~4096 像素，过小会自动放大。</p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">目标色卡</label>
            <select v-model="paletteId" class="input !py-1.5">
              <optgroup v-for="g in paletteGroups()" :key="g.label" :label="g.label">
                <option v-for="p in g.items" :key="p.id" :value="p.id">{{ p.title }}（{{ p.count }} 色）</option>
              </optgroup>
            </select>
          </div>
          <div>
            <label class="mb-1.5 block text-xs font-medium text-stone-500">图纸宽度（豆数）</label>
            <input v-model.number="width" type="number" min="16" max="256" step="1" class="input !py-1.5" />
            <p class="mt-1 text-[11px] text-stone-400">16~256，转图纸时自动匹配色卡。</p>
          </div>
        </div>

        <div v-if="serverOk === false" class="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ⚠ AI 服务暂时不可用，请稍后再试。
        </div>

        <div
          v-if="isLoggedIn"
          class="rounded-xl px-3 py-2 text-xs"
          :class="usage && usage.today >= usage.limit ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-600'"
        >
          🤖 今日已用 <b>{{ usage?.today ?? '-' }}</b> / {{ usage?.effectiveLimit ?? usage?.limit ?? '-' }} 次
          <span v-if="usage?.extra">（含积分兑换 +{{ usage.extra }}）</span>
          <span v-if="usage && usage.today >= (usage.effectiveLimit ?? usage.limit)">（今日额度已用完，可在个人中心签到/兑换或明天再来）</span>
        </div>
        <div
          v-else
          class="rounded-xl px-3 py-2 text-xs"
          :class="usage && usage.today >= usage.limit ? 'bg-red-50 text-red-600' : 'bg-stone-100 text-stone-500'"
        >
          <template v-if="usage">
            👤 游客今日已用 <b>{{ usage.today }}</b> / {{ usage.limit }} 次
            <span v-if="usage.today >= usage.limit">（次数已用完，登录后可继续）</span>
          </template>
          <template v-else>👤 游客模式</template>
          <router-link to="/login" class="ml-1 font-medium text-brand-500 hover:underline">登录</router-link>
          后可获得更多次数并跨设备同步。
        </div>

        <button class="btn btn-primary w-full" :disabled="generating" @click="generate">
          {{ generating ? '⏳ AI 正在生成…（约 10~30 秒）' : refImageBase64 ? '✨ AI 按参考图重绘' : '✨ AI 生成图片' }}
        </button>
        <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ error }}</p>
      </section>

      <!-- 结果 -->
      <section class="card min-w-0 p-5">
        <h2 class="mb-3 text-sm font-semibold text-stone-700">🖼 生成结果</h2>
        <div v-if="imageBase64" class="space-y-3">
          <img :src="imageBase64" alt="AI 生成图片" class="max-h-[420px] w-full rounded-xl object-contain ring-1 ring-stone-200" />
          <p class="text-[11px] text-stone-400">生成后会自动转成你选色卡的拼豆图纸</p>
          <button class="btn btn-primary w-full" @click="useInGenerator">🖼️ 用这张图转图纸 →</button>
        </div>
        <div v-else class="grid min-h-[280px] place-items-center rounded-xl border-2 border-dashed border-stone-200 text-center">
          <div class="p-6">
            <p class="text-4xl">🎨</p>
            <p class="mt-2 text-sm text-stone-400">输入描述点生成，这里会显示 AI 图片</p>
          </div>
        </div>
      </section>
    </div>

    <section v-if="history.length" class="card p-5">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-stone-700">🕘 生成历史（最近 {{ history.length }} 条）</h2>
        <button class="btn btn-secondary !px-2.5 !py-1 text-xs" @click="clearHistory">清空历史</button>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div v-for="(h, i) in history" :key="h.id ?? i" class="overflow-hidden rounded-xl ring-1 ring-stone-200">
          <img :src="h.imageBase64" alt="历史生成" class="h-32 w-full object-cover" />
          <div class="bg-white p-2">
            <p class="truncate text-xs font-medium text-stone-700" :title="h.prompt">{{ h.prompt }}</p>
            <p class="mt-0.5 text-[10px] text-stone-400">{{ fmtHistoryTime(h.createdAt) }}</p>
            <div class="mt-1.5 flex gap-1.5">
              <button class="rounded-md bg-brand-500 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-brand-600" @click="useHistoryItem(h)">转图纸</button>
              <button class="rounded-md bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500 hover:bg-stone-200" @click="deleteHistoryItem(h)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="card p-5 text-xs leading-6 text-stone-500">
      <h2 class="mb-1 text-sm font-semibold text-stone-700">💡 使用步骤</h2>
      <ol class="list-decimal space-y-1 pl-5">
        <li>输入想拼的图案描述（如「一只橘猫，卡通大色块」），点「AI 生成图片」。</li>
        <li>想改造已有图片时，可先上传一张参考图，AI 会按你的描述重绘它（纯文字则直接生图）。</li>
        <li>等 10~30 秒生成完成后，点「用这张图转图纸」，会自动跳转到图片转图纸页并载入图片。</li>
        <li>在那里继续调宽度/色卡/细节，点「生成图纸」即可得到拼豆图纸。</li>
        <li>提示：如遇内容安全审核拦截，把描述改得更温和、正向一些（避免暴力/血腥/恐怖/争议等内容）再试。</li>
      </ol>
    </section>
  </div>
</template>
