<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CropRect } from '../types'

const props = withDefaults(
  defineProps<{
    src: string
    imageW: number
    imageH: number
    modelValue?: CropRect | null
    maxWidth?: number
    maxHeight?: number
  }>(),
  { maxWidth: 360, maxHeight: 340 }
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: CropRect | null): void
}>()

const wrap = ref<HTMLElement | null>(null)

const scale = computed(() => {
  if (!props.imageW || !props.imageH) return 1
  return Math.min(props.maxWidth / props.imageW, props.maxHeight / props.imageH, 1)
})
const dispW = computed(() => Math.max(1, Math.round(props.imageW * scale.value)))
const dispH = computed(() => Math.max(1, Math.round(props.imageH * scale.value)))

const rect = computed(() => props.modelValue ?? null)

function clampRect(r: CropRect): CropRect {
  const w = Math.max(4, Math.min(r.w, props.imageW))
  const h = Math.max(4, Math.min(r.h, props.imageH))
  const x = Math.max(0, Math.min(r.x, props.imageW - w))
  const y = Math.max(0, Math.min(r.y, props.imageH - h))
  return { x, y, w, h }
}

function fullRect(): CropRect {
  return { x: 0, y: 0, w: props.imageW, h: props.imageH }
}

type HandleMode = 'new' | 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface DragState {
  mode: HandleMode
  startX: number
  startY: number
  orig: CropRect
}
const drag = ref<DragState | null>(null)

function pos(e: PointerEvent): { x: number; y: number } {
  const el = wrap.value
  if (!el) return { x: 0, y: 0 }
  const r = el.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function onDown(e: PointerEvent, mode: HandleMode) {
  e.preventDefault()
  e.stopPropagation()
  const p = pos(e)
  const cur = rect.value ? { ...rect.value } : fullRect()
  drag.value = { mode, startX: p.x, startY: p.y, orig: cur }
  try {
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  } catch {
    /* ignore */
  }
}

function onMove(e: PointerEvent) {
  if (!drag.value) return
  const p = pos(e)
  const dx = p.x - drag.value.startX
  const dy = p.y - drag.value.startY
  const s = scale.value || 1
  const dxI = dx / s
  const dyI = dy / s
  const o = drag.value.orig
  const m = drag.value.mode
  let next: CropRect = { ...o }
  switch (m) {
    case 'move':
      next = { x: o.x + dxI, y: o.y + dyI, w: o.w, h: o.h }
      break
    case 'new': {
      const x1 = o.x
      const y1 = o.y
      next = { x: Math.min(x1, x1 + dxI), y: Math.min(y1, y1 + dyI), w: Math.abs(dxI), h: Math.abs(dyI) }
      break
    }
    case 'e':
      next.w = Math.max(4, Math.min(o.w + dxI, props.imageW - o.x))
      break
    case 's':
      next.h = Math.max(4, Math.min(o.h + dyI, props.imageH - o.y))
      break
    case 'w': {
      const right = o.x + o.w
      next.x = Math.max(0, Math.min(o.x + dxI, right - 4))
      next.w = right - next.x
      break
    }
    case 'n': {
      const bottom = o.y + o.h
      next.y = Math.max(0, Math.min(o.y + dyI, bottom - 4))
      next.h = bottom - next.y
      break
    }
    case 'ne': {
      next.w = Math.max(4, Math.min(o.w + dxI, props.imageW - o.x))
      const bottom = o.y + o.h
      next.y = Math.max(0, Math.min(o.y + dyI, bottom - 4))
      next.h = bottom - next.y
      break
    }
    case 'nw': {
      const right = o.x + o.w
      next.x = Math.max(0, Math.min(o.x + dxI, right - 4))
      next.w = right - next.x
      const bottom = o.y + o.h
      next.y = Math.max(0, Math.min(o.y + dyI, bottom - 4))
      next.h = bottom - next.y
      break
    }
    case 'se': {
      next.w = Math.max(4, Math.min(o.w + dxI, props.imageW - o.x))
      next.h = Math.max(4, Math.min(o.h + dyI, props.imageH - o.y))
      break
    }
    case 'sw': {
      const right = o.x + o.w
      next.x = Math.max(0, Math.min(o.x + dxI, right - 4))
      next.w = right - next.x
      next.h = Math.max(4, Math.min(o.h + dyI, props.imageH - o.y))
      break
    }
  }
  const f = clampRect(next)
  f.x = Math.round(f.x)
  f.y = Math.round(f.y)
  f.w = Math.round(f.w)
  f.h = Math.round(f.h)
  emit('update:modelValue', f)
}

function onUp() {
  drag.value = null
}

const rectStyle = computed(() => {
  if (!rect.value) return {}
  const s = scale.value
  return {
    left: rect.value.x * s + 'px',
    top: rect.value.y * s + 'px',
    width: rect.value.w * s + 'px',
    height: rect.value.h * s + 'px'
  }
})

const handles = [
  { m: 'nw', x: 0, y: 0 },
  { m: 'n', x: 0.5, y: 0 },
  { m: 'ne', x: 1, y: 0 },
  { m: 'e', x: 1, y: 0.5 },
  { m: 'se', x: 1, y: 1 },
  { m: 's', x: 0.5, y: 1 },
  { m: 'sw', x: 0, y: 1 },
  { m: 'w', x: 0, y: 0.5 }
] as const

const cursorMap: Record<string, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize'
}

function handleStyle(h: (typeof handles)[number]) {
  const r = rect.value
  if (!r) return {}
  const s = scale.value
  return {
    left: (r.x + h.x * r.w) * s - 6 + 'px',
    top: (r.y + h.y * r.h) * s - 6 + 'px',
    cursor: cursorMap[h.m] ?? 'pointer'
  }
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between gap-2 text-xs text-stone-500">
      <span class="font-medium">✂️ 裁剪范围（拖拽选区移动，拖拽四角/四边缩放）</span>
      <div class="flex shrink-0 gap-1.5">
        <button
          type="button"
          class="rounded-md bg-stone-100 px-2 py-1 text-[11px] font-medium hover:bg-stone-200"
          @click="emit('update:modelValue', fullRect())"
        >
          重置整图
        </button>
        <button
          type="button"
          class="rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-600 hover:bg-brand-100"
          @click="emit('update:modelValue', null)"
        >
          不裁剪
        </button>
      </div>
    </div>

    <div
      ref="wrap"
      data-testid="crop-wrap"
      class="relative select-none rounded-xl bg-stone-100 ring-1 ring-stone-200"
      :style="{ width: dispW + 'px', height: dispH + 'px' }"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <img :src="src" draggable="false" class="pointer-events-none block h-full w-full rounded-xl" style="user-select: none" />

      <!-- 新建选区层（点击选区外拖动可重新框选） -->
      <div class="absolute inset-0 cursor-crosshair" @pointerdown="onDown($event, 'new')"></div>

      <template v-if="rect">
        <div
          class="absolute cursor-move border-2 border-white ring-1 ring-black/30"
          :style="[rectStyle, { boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }]"
          @pointerdown="onDown($event, 'move')"
        >
          <div
            class="pointer-events-none absolute inset-0 opacity-40"
            style="
              background-image: linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px);
              background-size: 33.333% 33.333%;
            "
          ></div>
        </div>

        <div
          v-for="h in handles"
          :key="h.m"
          :data-handle="h.m"
          class="absolute z-10 h-3 w-3 rounded-sm border border-black/40 bg-white shadow"
          :style="handleStyle(h)"
          @pointerdown="onDown($event, h.m)"
        ></div>

        <div class="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">
          {{ rect.w }}×{{ rect.h }} px
        </div>
      </template>
    </div>
  </div>
</template>
