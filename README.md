# 🧩 拼豆工坊 · 拼豆图纸工具（Pindou Studio）

一个仿照 [dg.idouge.com「豆格」](https://dg.idouge.com) 的**无需登录**在线拼豆图纸网站。
图片转换、色卡匹配、库存计算全部在浏览器本地完成，不上传任何数据；收藏、图纸、豆仓库存保存在 `localStorage`。

## ✨ 功能

| 功能 | 说明 |
| --- | --- |
| 🏠 图纸库 | 内置 **56 张像素图纸**（原创 + Perler 画廊采集），支持搜索、标签筛选与**分页浏览**（默认每页 14 张，可切换每页数量） |
| 🖼️ 图片转图纸 | 上传任意图片 → **可选上传前裁剪**（拖拽选区/手柄缩放）+ 默认宽度按图片自适应 + 边缘锐化 + 色彩增强（可调亮度/饱和度/对比度）+ 细节档位（超采样 1/2/3 倍）+ **背景处理（默认背景留空：边缘连通智能抠图，只去掉外围背景、图案内部保留；默认自动裁剪空白边距）** + **仅用手头颜色生成**（豆仓里没有的色号自动映射到最近的有色）+ **底板尺寸/板数规划**（29×29 / 50×50 / 104×104，自动算需要几块板）+ 最近色 / Floyd-Steinberg 抖动量化 → 生成图纸；生成后可 **✨ 一键拼豆风**（预设参数重新生成）、**🔁 切换品牌色卡并重新映射**、**🎨 颜色优化**（合并相似色 / 去杂色 / 逐色排除与重映射）、**🧮 库存对照**（每种颜色用多少豆 / 豆仓还差多少，直连豆仓） |
| 🧮 图纸详情 | 网格预览（可开关色号/网格、调格子大小、选底板算板数）、用豆统计、缺豆提醒、**🧭 拼豆进度追踪**（逐颗标记已放，进度自动保存到本地）、**🔁 跨品牌换色卡**（一键转成 Perler/Hama 等任意色卡并保存副本）、**🛒 购物清单 / BOM**（需要/占比/已有/需购，按豆仓库存算"差几颗需买"，打印/CSV 导出）、**🔗 分享**（自定义 1-5 位数字短链接，重复编号会提示已存在）、**🧊 3D 预览**（立体豆子效果，大图自动缩放不裁剪）、**⬇ 底板布局图**（按板分割并编号，规划拼豆顺序） |
| ✏️ 图纸编辑 | 画笔/橡皮/吸管/**油漆桶**（泛洪填充）/**框选**（复制/剪切/粘贴/删除，Ctrl+C/X/V），**左右/上下对称绘制**、**放大镜**（悬停看局部）、全局颜色替换、旋转 90°、左右翻转、清空，**撤销/重做**（按钮 + Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y），**← 退出**（有未保存改动会先确认），涂完保存 |
| 📦 豆仓 | 按品牌色卡登记你拥有的豆子颜色与数量；图纸详情自动计算"差几颗/需购几颗" |
| 🎨 色卡 | **20 套品牌色卡共 4600+ 色号**（国内：MARD 221/291、COCO、DODO、卡卡、漫漫、盼盼、咪小窝、小舞、黄豆豆、柿柿、童趣、优肯 174/221/197/418；进口：Perler、Hama、Nabbi）；颜色选色 → 跨品牌查找最接近色号 |
| ♥ 我的 | 收藏 + 我的图纸，本地持久化，无需登录；**自动去重**（内容相同的图纸只保留一份）+ **批量管理**（多选、全选、批量收藏/删除、批量移动分组）+ **📁 分组**（收藏/图纸按组筛选、卡片加入分组）+ **⇪ 导入图纸**（粘贴色号网格 / JSON / 字符画） |
| ⬇ 导出 | 下载 PNG 图片 / PNG 色号版 / **综合图纸（图案+色号板+用量一张图）** / CSV 用豆统计 / 单页打印 / **A4 分区打印**（大图纸自动切成多页，可另存为 PDF） |

## 🛠 技术栈（规划）

- **构建**：[Vite 7](https://vitejs.dev) + [Vue 3](https://vuejs.org)（`<script setup>` 组合式 API）+ TypeScript
- **路由**：vue-router（Hash 模式，任意静态服务器/托管平台可直接部署，无需重写规则）
- **样式**：[Tailwind CSS v4](https://tailwindcss.com)（`@tailwindcss/vite` 插件）+ 少量自定义 CSS
- **状态/持久化**：轻量响应式 store（`composables/useStore.ts`）+ `localStorage`，无后端、无登录
- **图像处理**：HTML5 Canvas 读像素 + **CIEDE2000 色差公式**最近色匹配；Floyd–Steinberg 误差扩散抖动；大图纸（>3000 格）自动用 Canvas 渲染避免 DOM 卡顿
- **色卡数据**：20 套品牌色卡（MARD、COCO、DODO、卡卡、漫漫、盼盼、咪小窝、小舞、黄豆豆、柿柿、童趣、优肯、Perler、Hama、Nabbi 等），来自 [HansBug/pindou-color-data](https://github.com/HansBug/pindou-color-data)、[get-colors-from-beans](https://git.xiongxiao.me/abearxiong/get-colors-from-beans)、[maxcleme/beadcolors](https://github.com/maxcleme/beadcolors)
- **部署**：`npm run build` 产物为纯静态文件（`dist/`），可放到 GitHub Pages / Netlify / Vercel / Nginx 等任意地方

> 为什么不用后端？拼豆工具的"图片→图纸"本质是纯本地计算，色卡是静态数据，用户数据就是收藏/图纸/库存三样——用 localStorage 就够，省掉服务器成本、没有登录和隐私负担，这也是"无需登录"的最简实现。

## 🚀 运行

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器 http://localhost:5173
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 预览生产构建
```

## 🧪 测试

依赖 Chrome/Edge，脚本会用系统 Chrome 做无头冒烟测试：

```bash
node scripts/smoke.cjs      # 页面路由 + 搜索 + 收藏冒烟测试
node scripts/deep-test.cjs  # 上传→生成→颜色优化→裁剪→A4打印→库存→编辑(撤销/重做)→导入→拼豆进度→换色卡→购物清单→仅用手头颜色 全流程测试
node scripts/screenshots.cjs# 生成页面截图到 screenshots/
```

## 📁 目录结构

```
src/
  components/   PatternGrid（div/canvas 自适应）、PatternCard、ColorLegend
  composables/  useStore.ts（收藏/图纸/库存 本地状态）
  data/         palettes/（6 大色卡 JSON）、palettes.ts、patterns.json（内置图纸）、patterns.ts
  utils/        color.ts（CIEDE2000）、quantize.ts（量化）、export.ts（PNG/CSV/打印）、storage.ts
  views/        Home / PatternDetail / Generator / Editor / Warehouse / Palette / My
  router/       路由（Hash）
  App.vue       导航 + 页脚布局
```

## 📝 说明

- 图纸与色号数据仅供学习交流，请勿商用色卡数据本身。
- 颜色匹配基于 CIEDE2000，视觉最接近；实际豆子颜色受批次/屏幕影响，建议以实物为准。
- 功能参考豆格（dg.idouge.com）的图纸库、图片转图、豆仓库存、色号查询等核心能力重新实现。