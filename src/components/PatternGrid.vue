<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import type { Pattern, BeadPalette } from '../types'
import { contrastText } from '../utils/color'

const props = withDefaults(
  defineProps<{
    pattern: Pattern
    palette: BeadPalette
    cellSize?: number
    showCodes?: boolean
    grid?: boolean
    emptyBg?: string
    forceCanvas?: boolean
  }>(),
  { cellSize: 18, showCodes: false, grid: true, emptyBg: 'rgba(0,0,0,0.045)', forceCanvas: false }
)

const colorMap = computed(() => new Map(props.palette.colors.map((c) => [c.code, c])))

/** 格子数很大时改用 canvas 渲染，避免上千个 DOM 节点卡顿 */
const useCanvas = computed(() => props.forceCanvas || props.pattern.width * props.pattern.height > 3000)

const cells = computed(() => {
  const list: { code: string; hex: string; key: string }[] = []
  for (let y = 0; y < props.pattern.height; y++) {
    const row = props.pattern.rows[y] ?? []
    for (let x = 0; x < props.pattern.width; x++) {
      const code = row[x] ?? ''
      list.push({
        code,
        hex: colorMap.value.get(code)?.hex ?? '#ffffff',
        key: `${x}-${y}`
      })
    }
  }
  return list
})

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${props.pattern.width}, ${props.cellSize}px)`
}))

const fontSize = computed(() =>
  props.showCodes && props.cellSize >= 9 ? Math.max(7, Math.round(props.cellSize * 0.38)) : 0
)

/* ---------- canvas 渲染 ---------- */
const canvasRef = ref<HTMLCanvasElement | null>(null)

function drawCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  const cell = props.cellSize
  canvas.width = props.pattern.width * cell
  canvas.height = props.pattern.height * cell
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = props.emptyBg
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (let y = 0; y < props.pattern.height; y++) {
    const row = props.pattern.rows[y] ?? []
    for (let x = 0; x < props.pattern.width; x++) {
      const code = row[x] ?? ''
      if (!code || code === '.') continue
      const color = colorMap.value.get(code)
      if (!color) continue
      const px = x * cell
      const py = y * cell
      ctx.fillStyle = color.hex
      ctx.fillRect(px, py, cell, cell)
      if (props.showCodes && cell >= 9) {
        const fs = Math.max(7, cell * 0.38)
        ctx.fillStyle = contrastText(color.hex)
        ctx.font = `600 ${fs}px ui-monospace, "Microsoft YaHei", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(code.length > 2 ? code.slice(0, 2) : code, px + cell / 2, py + cell / 2 + 0.5)
      }
      if (props.grid) {
        ctx.strokeStyle = 'rgba(0,0,0,0.12)'
        ctx.lineWidth = 0.5
        ctx.strokeRect(px + 0.25, py + 0.25, cell - 0.5, cell - 0.5)
      }
    }
  }
}

watch([() => props.pattern, () => props.palette, () => props.cellSize, () => props.showCodes, () => props.grid], () => {
  if (useCanvas.value) drawCanvas()
})
onMounted(() => {
  if (useCanvas.value) drawCanvas()
})
</script>

<template>
  <canvas
    v-if="useCanvas"
    ref="canvasRef"
    class="inline-block"
    style="image-rendering: auto"
  ></canvas>
  <div v-else class="inline-grid overflow-hidden rounded-sm" :style="gridStyle">
    <div
      v-for="c in cells"
      :key="c.key"
      class="grid-cell"
      :style="{
        width: cellSize + 'px',
        height: cellSize + 'px',
        background: c.code && c.code !== '.' ? c.hex : emptyBg,
        color: c.code && c.code !== '.' ? contrastText(c.hex) : 'transparent',
        fontSize: fontSize + 'px',
        boxShadow: grid && c.code && c.code !== '.' ? 'inset 0 0 0 0.5px rgba(0,0,0,0.12)' : 'none'
      }"
    >
      {{ showCodes && c.code && c.code !== '.' ? (c.code.length > 2 ? c.code.slice(0, 2) : c.code) : '' }}
    </div>
  </div>
</template>

<style scoped>
.grid-cell {
  display: grid;
  place-items: center;
  line-height: 1;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  user-select: none;
}
</style>