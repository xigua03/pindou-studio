<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Pattern, BeadPalette } from '../types'

const props = defineProps<{ pattern: Pattern; palette: BeadPalette }>()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const tilt = ref(55)
const cell = ref(16)

const byCode = computed(() => new Map(props.palette.colors.map((c) => [c.code, c])))

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const v = parseInt(n, 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
function adjust(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)))
  return `rgb(${c(r)},${c(g)},${c(b)})`
}

function render() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const p = props.pattern
  const cs = cell.value
  const rad = (cs * 0.9) / 2
  const scaleY = Math.cos((tilt.value * Math.PI) / 180)
  const pad = cs * 1.8
  const boardW = p.width * cs
  const boardH = p.height * cs
  const W = Math.max(340, boardW + pad * 2)
  const H = Math.max(260, boardH * scaleY + pad * 3)
  canvas.width = W
  canvas.height = H
  ctx.clearRect(0, 0, W, H)

  const bx = (W - boardW) / 2
  // 经过 translate+scale 变换后，让底板在画布内垂直居中且不被裁剪
  const by = (H - boardH) / (2 * scaleY)

  ctx.save()
  ctx.translate(0, (boardH * (1 - scaleY)) / 2)
  ctx.scale(1, scaleY)

  // 底板
  ctx.fillStyle = '#f4f1ec'
  ctx.fillRect(bx, by, boardW, boardH)
  ctx.strokeStyle = 'rgba(0,0,0,0.16)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(bx, by, boardW, boardH)

  // 孔 + 豆
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const cx = bx + x * cs + cs / 2
      const cy = by + y * cs + cs / 2
      const code = p.rows[y]?.[x] ?? '.'
      ctx.beginPath()
      ctx.arc(cx, cy, rad * 0.8, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,0,0,0.10)'
      ctx.fill()
      if (code && code !== '.') {
        const hex = byCode.value.get(code)?.hex ?? '#cccccc'
        const g = ctx.createRadialGradient(cx - rad * 0.35, cy - rad * 0.35, rad * 0.12, cx, cy, rad)
        g.addColorStop(0, adjust(hex, 1.35))
        g.addColorStop(0.5, hex)
        g.addColorStop(1, adjust(hex, 0.65))
        ctx.beginPath()
        ctx.arc(cx, cy, rad, 0, Math.PI * 2)
        ctx.fillStyle = g
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.22)'
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(cx - rad * 0.32, cy - rad * 0.34, rad * 0.2, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        ctx.fill()
      }
    }
  }
  ctx.restore()
}

onMounted(() => {
  // 大图纸自动缩小豆子，保证整张图能在预览区里完整看到
  const max = Math.max(props.pattern.width, props.pattern.height)
  if (max > 56) {
    cell.value = Math.max(8, Math.min(16, Math.floor(880 / max)))
  }
  render()
})
watch([() => props.pattern, () => props.palette, tilt, cell], render, { deep: true })
</script>

<template>
  <div>
    <div class="mb-3 flex flex-wrap items-center gap-4 text-xs text-stone-500">
      <label class="flex items-center gap-2">
        倾角
        <input v-model.number="tilt" type="range" min="0" max="85" step="1" class="w-32 accent-brand-500" />
        <span class="w-8 text-right">{{ tilt }}°</span>
      </label>
      <label class="flex items-center gap-2">
        豆子大小
        <input v-model.number="cell" type="range" min="8" max="28" step="1" class="w-32 accent-brand-500" />
        <span class="w-8 text-right">{{ cell }}px</span>
      </label>
      <span class="ml-auto text-stone-400">{{ pattern.width }}×{{ pattern.height }} 格 · {{ palette.title }}</span>
    </div>
    <div class="overflow-auto rounded-xl bg-stone-100 p-3" style="max-height: 66vh">
      <canvas ref="canvasRef" class="mx-auto block"></canvas>
    </div>
  </div>
</template>
