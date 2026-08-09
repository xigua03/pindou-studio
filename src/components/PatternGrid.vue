<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import type { Pattern, BeadPalette } from '../types'
import { contrastText } from '../utils/color'
import { drawCoordFrame, coordStripWidth } from '../utils/export'

const props = withDefaults(
  defineProps<{
    pattern: Pattern
    palette: BeadPalette
    cellSize?: number
    showCodes?: boolean
    grid?: boolean
    emptyBg?: string
    forceCanvas?: boolean
    /** 拼豆进度：已完成格子的 key 集合（key = `${x},${y}`） */
    progress?: Set<string> | null
    /** 允许点击格子（用于拼豆进度标记） */
    clickable?: boolean
    /** show row/column coordinate numbers + board reference lines */
    showCoords?: boolean
    /** board-boundary reference line interval (cells); >0 draws thick red lines */
    boardSize?: number
  }>(),
  { cellSize: 18, showCodes: false, grid: true, emptyBg: 'rgba(0,0,0,0.045)', forceCanvas: false, progress: null, clickable: false, showCoords: false, boardSize: 0 }
)

const emit = defineEmits<{
  (e: 'cell-click', x: number, y: number): void
  /** C14：拖拽经过的格子（连续标记） */
  (e: 'cell-drag', x: number, y: number): void
  /** C14：Shift+拖拽框选矩形区域（含端点） */
  (e: 'cell-box', x0: number, y0: number, x1: number, y1: number): void
}>()

const colorMap = computed(() => new Map(props.palette.colors.map((c) => [c.code, c])))

/** 格子数很大时改用 canvas 渲染，避免上千个 DOM 节点卡顿 */
const useCanvas = computed(() => props.forceCanvas || props.showCoords || props.boardSize > 0 || props.pattern.width * props.pattern.height > 3000)

const cells = computed(() => {
  const list: { code: string; hex: string; key: string }[] = []
  for (let y = 0; y < props.pattern.height; y++) {
    const row = props.pattern.rows[y] ?? []
    for (let x = 0; x < props.pattern.width; x++) {
      const code = row[x] ?? ''
      list.push({
        code,
        hex: colorMap.value.get(code)?.hex ?? '#ffffff',
        key: `${x},${y}`
      })
    }
  }
  return list
})

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${props.pattern.width}, ${props.cellSize}px)`
}))

// 格子 >= 5px 就显示色号，字体随格子自适应缩小（最小 5px）
const fontSize = computed(() =>
  props.showCodes && props.cellSize >= 5 ? Math.max(5, Math.round(props.cellSize * 0.36)) : 0
)

/* ---------- canvas 渲染 ---------- */
const canvasRef = ref<HTMLCanvasElement | null>(null)

function drawCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  const cell = props.cellSize
  const strip = props.showCoords ? coordStripWidth(cell, Math.max(props.pattern.width, props.pattern.height)) : 0
  const leftW = props.showCoords ? strip : 0
  const topH = props.showCoords ? strip : 0
  canvas.width = leftW + props.pattern.width * cell
  canvas.height = topH + props.pattern.height * cell
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = props.emptyBg
  ctx.fillRect(leftW, topH, props.pattern.width * cell, props.pattern.height * cell)
  for (let y = 0; y < props.pattern.height; y++) {
    const row = props.pattern.rows[y] ?? []
    for (let x = 0; x < props.pattern.width; x++) {
      const code = row[x] ?? ''
      const px = leftW + x * cell
      const py = topH + y * cell
      if (code && code !== '.') {
        const color = colorMap.value.get(code)
        if (color) {
          ctx.fillStyle = color.hex
          ctx.fillRect(px, py, cell, cell)
          if (props.showCodes && cell >= 5) {
            const fs = Math.max(5, cell * 0.36)
            ctx.fillStyle = contrastText(color.hex)
            ctx.font = `600 ${fs}px ui-monospace, "Microsoft YaHei", sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(code.length > 2 ? code.slice(0, 2) : code, px + cell / 2, py + cell / 2 + 0.5)
          }
        }
      }
      // 空豆格子也画网格线，方便数出要空几格
      if (props.grid) {
        ctx.strokeStyle = 'rgba(0,0,0,0.12)'
        ctx.lineWidth = 0.5
        ctx.strokeRect(px + 0.25, py + 0.25, cell - 0.5, cell - 0.5)
      }
    }
  }
  // 拼豆进度：已完成格子盖半透明白
  if (props.progress && props.progress.size > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    for (const key of props.progress) {
      const [gx, gy] = key.split(',').map(Number)
      if (Number.isFinite(gx) && Number.isFinite(gy)) ctx.fillRect(leftW + gx * cell, topH + gy * cell, cell, cell)
    }
  }
  if (props.showCoords) {
    drawCoordFrame(ctx, props.pattern, cell, leftW, topH, { x: 0, y: 0, w: props.pattern.width, h: props.pattern.height }, { boardSize: props.boardSize, strip })
  }
}

function canvasCellFromEvent(e: MouseEvent): { x: number; y: number } | null {
  const canvas = canvasRef.value
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const cell = props.cellSize
  const leftW = props.showCoords ? cell : 0
  const topH = props.showCoords ? cell : 0
  const mx = (e.clientX - rect.left) * scaleX
  const my = (e.clientY - rect.top) * scaleY
  const x = Math.floor((mx - leftW) / cell)
  const y = Math.floor((my - topH) / cell)
  if (x < 0 || y < 0 || x >= props.pattern.width || y >= props.pattern.height) return null
  return { x, y }
}

let dragStart: { x: number; y: number } | null = null
let boxStart: { x: number; y: number } | null = null
// pointerdown 已处理点击时，抑制随后浏览器派发的 click 事件，避免重复
let suppressClick = false

function onCanvasClick(e: MouseEvent) {
  if (!props.clickable) return
  if (suppressClick) {
    suppressClick = false
    return
  }
  // 兼容合成 click（如自动化测试 / 键盘触发的 click）
  const p = canvasCellFromEvent(e)
  if (!p) return
  emit('cell-click', p.x, p.y)
}

function onCanvasPointerDown(e: PointerEvent) {
  if (!props.clickable) return
  const p = canvasCellFromEvent(e)
  if (!p) return
  if (e.shiftKey) {
    boxStart = p
    dragStart = null
  } else {
    dragStart = p
    boxStart = null
    suppressClick = true
    emit('cell-click', p.x, p.y)
  }
}
function onCanvasPointerMove(e: PointerEvent) {
  if (!props.clickable || !dragStart) return
  const p = canvasCellFromEvent(e)
  if (!p) return
  emit('cell-drag', p.x, p.y)
}
function onCanvasPointerUp(e: PointerEvent) {
  if (!props.clickable) return
  if (boxStart) {
    const p = canvasCellFromEvent(e)
    if (p) emit('cell-box', boxStart.x, boxStart.y, p.x, p.y)
    boxStart = null
  }
  dragStart = null
}
function onCanvasPointerLeave() {
  dragStart = null
  boxStart = null
}

watch([() => props.pattern, () => props.palette, () => props.cellSize, () => props.showCodes, () => props.grid, () => props.progress, () => props.showCoords, () => props.boardSize], () => {
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
    :class="clickable ? 'cursor-pointer' : ''"
    style="image-rendering: auto"
    @pointerdown="onCanvasPointerDown"
    @pointermove="onCanvasPointerMove"
    @pointerup="onCanvasPointerUp"
    @pointerleave="onCanvasPointerLeave"
    @pointercancel="onCanvasPointerLeave"
    @click="onCanvasClick"
  ></canvas>
  <div v-else class="inline-grid overflow-hidden rounded-sm" :style="gridStyle">
    <div
      v-for="c in cells"
      :key="c.key"
      class="grid-cell relative"
      :class="clickable ? 'cursor-pointer' : ''"
      :style="{
        width: cellSize + 'px',
        height: cellSize + 'px',
        background: c.code && c.code !== '.' ? c.hex : emptyBg,
        color: c.code && c.code !== '.' ? contrastText(c.hex) : 'transparent',
        fontSize: fontSize + 'px',
        boxShadow: grid ? 'inset 0 0 0 0.5px rgba(0,0,0,0.12)' : 'none'
      }"
      @click="clickable ? emit('cell-click', Number(c.key.split(',')[0]), Number(c.key.split(',')[1])) : undefined"
    >
      <span v-if="showCodes && c.code && c.code !== '.'">{{ c.code.length > 2 ? c.code.slice(0, 2) : c.code }}</span>
      <span
        v-if="progress && progress.has(c.key)"
        class="absolute inset-0 grid place-items-center bg-white/55 text-[10px] leading-none text-green-600"
      >✓</span>
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