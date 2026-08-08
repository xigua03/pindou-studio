<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { paletteGroups } from '../data/palettes'
import { remoteHealth } from '../utils/shareApi'

const router = useRouter()
const prompt = ref('一只可爱的橘猫，卡通插画，大色块')
const paletteId = ref('mard-221-github')
const width = ref(64)
const generating = ref(false)
const error = ref('')
const imageBase64 = ref('')
const usedModel = ref('')
const serverOk = ref<boolean | null>(null)

onMounted(() => {
  remoteHealth().then((h) => (serverOk.value = h ? h.ai : false))
})

/** 追加拼豆友好提示，提升转图纸效果 */
function buildPrompt(p: string): string {
  return `${p}，简洁卡通插画风格，边缘清晰，大色块，背景纯色，适合像素化`
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: buildPrompt(p) })
    })
    const data = (await res.json()) as { ok?: boolean; imageBase64?: string; model?: string; error?: string }
    if (!res.ok || !data.ok) {
      error.value = data.error || 'AI 生成失败，请检查后端配置'
      return
    }
    imageBase64.value = data.imageBase64 ?? ''
    usedModel.value = data.model ?? ''
  } catch {
    error.value = '请求失败：请先运行 npm run server 启动后端服务'
  } finally {
    generating.value = false
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
      <p class="mt-1 text-sm text-stone-500">输入一段文字描述，AI 先生成图片，再一键转成拼豆图纸。需要本地启动后端（<code class="rounded bg-stone-100 px-1 font-mono">npm run server</code>）并配置千问 API Key。</p>
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
          ⚠ 后端服务未启动：请先运行 <code class="rounded bg-white px-1 font-mono">npm run server</code> 再生成。
        </div>

        <button class="btn btn-primary w-full" :disabled="generating" @click="generate">
          {{ generating ? '⏳ AI 正在生成…（约 10~30 秒）' : '✨ AI 生成图片' }}
        </button>
        <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{{ error }}</p>
      </section>

      <!-- 结果 -->
      <section class="card min-w-0 p-5">
        <h2 class="mb-3 text-sm font-semibold text-stone-700">🖼 生成结果</h2>
        <div v-if="imageBase64" class="space-y-3">
          <img :src="imageBase64" alt="AI 生成图片" class="max-h-[420px] w-full rounded-xl object-contain ring-1 ring-stone-200" />
          <p class="text-[11px] text-stone-400">模型：{{ usedModel || '通义万相' }} · 生成后会自动转成你选色卡的拼豆图纸</p>
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

    <section class="card p-5 text-xs leading-6 text-stone-500">
      <h2 class="mb-1 text-sm font-semibold text-stone-700">💡 使用步骤</h2>
      <ol class="list-decimal space-y-1 pl-5">
        <li>在项目根目录运行 <code class="rounded bg-stone-100 px-1 font-mono">npm run server</code> 启动后端（会自动读 <code class="rounded bg-stone-100 px-1 font-mono">.env</code> 里的 DASHSCOPE_API_KEY）。</li>
        <li>输入想拼的图案描述（如「一只橘猫，卡通大色块」），点「AI 生成图片」。</li>
        <li>等 10~30 秒生成完成后，点「用这张图转图纸」，会自动跳转到图片转图纸页并载入图片。</li>
        <li>在那里继续调宽度/色卡/细节，点「生成图纸」即可得到拼豆图纸。</li>
      </ol>
    </section>
  </div>
</template>
