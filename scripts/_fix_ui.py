# -*- coding: utf-8 -*-
import io

# ---------- A) PatternGrid.vue: show codes down to 5px ----------
p = r"F:\Code\codex\pd\src\components\PatternGrid.vue"
with io.open(p, "r", encoding="utf-8") as f:
    s = f.read()

def rep(old, new):
    global s
    assert old in s, "NOT FOUND: " + old[:80]
    s = s.replace(old, new, 1)

rep(
"""const fontSize = computed(() =>
  props.showCodes && props.cellSize >= 9 ? Math.max(7, Math.round(props.cellSize * 0.38)) : 0
)""",
"""// 格子 >= 5px 就显示色号，字体随格子自适应缩小（最小 5px）
const fontSize = computed(() =>
  props.showCodes && props.cellSize >= 5 ? Math.max(5, Math.round(props.cellSize * 0.36)) : 0
)""")

rep(
"""      if (props.showCodes && cell >= 9) {
        const fs = Math.max(7, cell * 0.38)""",
"""      if (props.showCodes && cell >= 5) {
        const fs = Math.max(5, cell * 0.36)""")

with io.open(p, "w", encoding="utf-8") as f:
    f.write(s)
print("PatternGrid low-size codes OK")

# ---------- B) GeneratorView.vue: width snaps to board ----------
p2 = r"F:\Code\codex\pd\src\views\GeneratorView.vue"
with io.open(p2, "r", encoding="utf-8") as f:
    s = f.read()

def rep2(old, new):
    global s
    assert old in s, "NOT FOUND: " + old[:80]
    s = s.replace(old, new, 1)

rep2(
"""// 底板尺寸（板数规划）
const boardSize = ref(29)""",
"""// 底板尺寸（板数规划）
const boardSize = ref(29)
// 宽度对齐底板：输出宽度吸附到整板倍数（如 29/58/87…）
const alignBoard = ref(true)""")

rep2(
"""  let outW = Math.max(8, Math.min(200, width.value))
  let outH = Math.max(8, Math.round((outW * h) / w))
  if (outH > 200) {
    outH = 200
    outW = Math.max(8, Math.round((200 * w) / h))
  }
  return { w: outW, h: outH }
})""",
"""  let outW = Math.max(8, Math.min(200, width.value))
  let outH = Math.max(8, Math.round((outW * h) / w))
  if (outH > 200) {
    outH = 200
    outW = Math.max(8, Math.round((200 * w) / h))
  }
  // 宽度对齐底板：吸附到整板倍数，避免出现"不满一块板又超一块板"的宽度
  if (alignBoard.value && boardSize.value > 0) {
    const b = boardSize.value
    const boards = Math.max(1, Math.round(outW / b))
    outW = boards * b
    outH = Math.max(8, Math.round((outW * h) / w))
    if (outH > 200) {
      outH = 200
      outW = Math.max(b, Math.round((200 * w) / h / b) * b)
    }
  }
  return { w: outW, h: outH }
})""")

# template: width slider show boards + board section align checkbox
rep2(
"""            <div class="mb-1.5 flex items-center justify-between text-xs font-medium text-stone-500">
              <label for="width-slider">图纸宽度（豆数）</label>
              <span class="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-brand-600">{{ outputSize.w }}×{{ outputSize.h }}</span>
            </div>""",
"""            <div class="mb-1.5 flex items-center justify-between text-xs font-medium text-stone-500">
              <label for="width-slider">图纸宽度（豆数）</label>
              <span class="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-brand-600">
                {{ outputSize.w }}×{{ outputSize.h }}
                <template v-if="alignBoard && outputSize.w > 0">≈ {{ Math.max(1, Math.round(outputSize.w / boardSize)) }} 板宽</template>
              </span>
            </div>""")

rep2(
"""            <select v-model.number="boardSize" class="input !py-1.5">
              <option :value="29">标准方板 29×29</option>
              <option :value="50">大板 50×50</option>
              <option :value="104">超大板 104×104</option>
            </select>
            <p class="mt-1 text-[11px] text-stone-400">生成后自动提示需要几块底板、怎么排布。</p>""",
"""            <select v-model.number="boardSize" class="input !py-1.5">
              <option :value="29">标准方板 29×29</option>
              <option :value="50">大板 50×50</option>
              <option :value="104">超大板 104×104</option>
            </select>
            <label class="mt-2 flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-500">
              <input v-model="alignBoard" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" />
              宽度对齐底板（整板倍数）
            </label>
            <p class="mt-1 text-[11px] text-stone-400">开启后图纸宽度自动吸附到整板倍数（如 29/58/87…），底板不浪费；生成后提示需要几块板、怎么排布。</p>""")

with io.open(p2, "w", encoding="utf-8") as f:
    f.write(s)
print("GeneratorView board-snap OK")