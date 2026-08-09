# 🧩 拼豆工坊 · 拼豆图纸工具（Pindou Studio）

一个**无需登录**的在线拼豆图纸网站。
图片转换、色卡匹配、库存计算全部在浏览器本地完成，不上传任何数据；收藏、图纸、豆仓库存保存在 `localStorage`。

## ✨ 功能

| 功能 | 说明 |
| --- | --- |
| 🤖 AI 生成 | **用文字描述生成图纸**：输入描述 → 通义万相文生图 → 一键跳转到「图片转图纸」继续调参生成（需本地启动后端，见下方运行） |
| 🏠 图纸库 | 内置 **110+ 张像素图纸**（原创 + Perler 画廊采集 + 后台新增），支持搜索、**难度/豆数筛选**、标签筛选与**分页浏览**（默认每页 16 张，可切换每页数量）；管理员可在后台新增内置图纸、推荐置顶、维护标签/来源、上架/下架 |
| 🖼️ 图片转图纸 | 上传任意图片 → **可选上传前裁剪**（拖拽选区/手柄缩放）+ 默认宽度按图片自适应 + 边缘锐化 + 色彩增强（可调亮度/饱和度/对比度）+ 细节档位（超采样 1/2/3 倍）+ **画布宽度 16~256 自由缩放**+ **背景处理（默认背景留空：边缘连通智能抠图，只去掉外围背景、图案内部保留；默认自动裁剪空白边距）** + **仅用手头颜色生成**（豆仓里没有的色号自动映射到最近的有色）+ **底板尺寸/板数规划**（29×29 / 50×50 / 104×104，自动算需要几块板）+ 最近色 / Floyd-Steinberg 抖动量化 → 生成图纸；生成后可 **✨ 一键拼豆风**（预设参数重新生成）、**🔁 切换品牌色卡并重新映射**、**🎨 颜色优化**（合并相似色 / 去杂色 / 逐色排除与重映射）、**🧮 库存对照**（每种颜色用多少豆 / 豆仓还差多少，直连豆仓） |
| 🧮 图纸详情 | 网格预览（可开关色号/网格、调格子大小、选底板算板数）、用豆统计、缺豆提醒、**🧭 拼豆进度追踪**（逐颗标记已放，支持**按住拖动连续标记**与 **Shift+拖拽框选一整块**，进度自动保存到本地）、**🔁 跨品牌换色卡**（一键转成 Perler/Hama 等任意色卡并保存副本）、**🛒 购物清单 / BOM**（需要/占比/已有/需购，按豆仓库存算"差几颗需买"，打印/CSV 导出）、**🔗 分享**（5 位字母数字短链接，可自定义/修改编号，修改后原链接立即失效；启动后端后**跨设备可打开**，未启动时回退为仅本机浏览器）、**🧊 3D 预览**（立体豆子效果，大图自动缩放不裁剪，可手动放大/缩小 50%-300% 并下载 PNG）、**⬇ 透明背景 PNG**（只有豆子色块、空白格透明的导出）、**⬇ 底板布局图**（按板分割并编号，规划拼豆顺序） |
| ✏️ 图纸编辑 | 画笔/橡皮/吸管/**油漆桶**（泛洪填充）/**框选**（复制/剪切/粘贴/删除，Ctrl+C/X/V），**左右/上下对称绘制**、**放大镜**（悬停看局部）、全局颜色替换、旋转 90°、左右翻转、清空，**撤销/重做**（按钮 + Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y），**← 退出**（有未保存改动会先确认），涂完保存 |
| 📦 豆仓 | 按品牌色卡登记你拥有的豆子颜色与数量；图纸详情自动计算"差几颗/需购几颗" |
| 🎨 色卡 | **20 套品牌色卡共 4600+ 色号**（国内：MARD 221/291、COCO、DODO、卡卡、漫漫、盼盼、咪小窝、小舞、黄豆豆、柿柿、童趣、优肯 174/221/197/418；进口：Perler、Hama、Nabbi）+ **🧪 自定义调色板**（自己创建色卡：增删色号+颜色，保存后可在生成器/换色卡中使用）；颜色选色 → 跨品牌查找最接近色号 |
| ♥ 我的 | 收藏 + 我的图纸，本地持久化；**自动去重**（内容相同的图纸只保留一份）+ **批量管理**（多选、全选、批量收藏/删除、批量移动分组）+ **📁 分组**（收藏/图纸按组筛选、卡片加入分组）+ **⇪ 导入图纸**（粘贴色号网格 / JSON / 字符画） |
| 👤 用户 | **注册/登录**（`/#/login`）、**个人中心**（`/#/profile`：资料/改密/AI 用量/云同步/我的分享/注销）、**☁️ 跨设备云同步**（图纸/收藏/分组/豆仓库存，注册后自动同步，个人中心可手动同步）、**🛠 后台管理**（`/#/admin`，仅管理员：仪表盘/用户/图纸/分享/AI 用量/反馈/设置/日志/导出/**图纸库管理**（新增/推荐/标签/来源/下架）/**功能开关**（图纸库、图片转图纸、AI 生成、色卡、豆仓、分享 6 项可独立开关）/注册开关/**游客 AI 限额**） |
| ⬇ 导出 | 下载 PNG 图片 / PNG 色号版 / **综合图纸（图案+色号板+用量一张图）** / CSV 用豆统计 / 单页打印 / **A4 分区打印**（大图纸自动切成多页，可另存为 PDF） |

## 🛠 技术栈（规划）

- **构建**：[Vite 7](https://vitejs.dev) + [Vue 3](https://vuejs.org)（`<script setup>` 组合式 API）+ TypeScript
- **路由**：vue-router（Hash 模式，任意静态服务器/托管平台可直接部署，无需重写规则）
- **样式**：[Tailwind CSS v4](https://tailwindcss.com)（`@tailwindcss/vite` 插件）+ 少量自定义 CSS
- **状态/持久化**：轻量响应式 store（`composables/useStore.ts`）+ `localStorage`，图纸/收藏/库存本地保存；登录后可通过后端云同步（`composables/useAuth.ts`）
- **用户/后台**：`server/`（Express + node:sqlite + JWT + bcryptjs）提供注册登录、云同步、AI 用量、功能开关、游客限额、图纸库管理与后台管理 API；前端 `AuthView / ProfileView / AdminView` + `composables/useConfig.ts`（公开配置/功能开关）
- **图像处理**：HTML5 Canvas 读像素 + **CIEDE2000 色差公式**最近色匹配；Floyd–Steinberg 误差扩散抖动；大图纸（>3000 格）自动用 Canvas 渲染避免 DOM 卡顿
- **色卡数据**：20 套品牌色卡（MARD、COCO、DODO、卡卡、漫漫、盼盼、咪小窝、小舞、黄豆豆、柿柿、童趣、优肯、Perler、Hama、Nabbi 等），来自 [HansBug/pindou-color-data](https://github.com/HansBug/pindou-color-data)、[get-colors-from-beans](https://git.xiongxiao.me/abearxiong/get-colors-from-beans)、[maxcleme/beadcolors](https://github.com/maxcleme/beadcolors)
- **部署**：`npm run build` 产物为纯静态文件（`dist/`），可放到 GitHub Pages / Netlify / Vercel / Nginx 等任意地方

> **可选后端**：核心功能（图片转图纸、色卡、库存、编辑）全部在浏览器本地完成。需要启动本地 Node 后端（`npm run server`）的功能：跨设备分享、AI 生成图纸、**用户注册登录 / 云同步 / 后台管理 / 功能开关 / 游客 AI 限额**。不启动后端时其余功能照常可用（登录页会提示后端未连接，功能开关默认全部开启）。

## 🚀 运行

```bash
npm install        # 安装依赖
npm run server     # 启动本地后端 http://localhost:8787（分享 / AI / 登录注册 / 云同步 / 后台管理需要）
npm run dev        # 开发服务器 http://localhost:5173（/api 已代理到 8787）
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 预览生产构建
```

> 首次启动后端会自动建库并创建默认管理员：`admin / admin123`（请登录后在后台尽快修改密码）。

> **后端说明**：`server/` 是基于 Express 的 Node 服务（Node 24 内置 `node:sqlite`，无需原生编译），提供「跨设备分享」「AI 文生图」「用户注册登录 / 云同步 / 后台管理」等接口（读取根目录 `.env` 的 `DASHSCOPE_API_KEY`，文生图模型可用 `WANX_MODEL` 配置，默认 `wanx2.1-t2i-turbo`）。开发时 Vite 已把 `/api` 代理到 8787；部署时可把该服务部署到任意 Node 主机/VPS，并把前端请求指向后端地址。

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
  App.vue       顶部导航（带图标的大号导航栏）+ 页脚布局
```

## 📝 说明

- 图纸与色号数据仅供学习交流，请勿商用色卡数据本身。
- 颜色匹配基于 CIEDE2000，视觉最接近；实际豆子颜色受批次/屏幕影响，建议以实物为准。