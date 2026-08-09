# 部署说明 · 拼豆工坊（Linux · 宝塔面板 · Node 24.19.0）

本文档面向 **Linux 服务器 + 宝塔面板** 环境部署，Node.js 版本 **24.19.0**（后端使用 Node 内置 `node:sqlite`，无需额外安装数据库）。

## 架构一览

| 组件 | 说明 |
| --- | --- |
| 前端 | Vite 构建的纯静态文件（`dist/`），Hash 路由，由 **Nginx** 托管 |
| 后端 | Express 服务，入口 `server/index.mjs`，默认端口 **8787**，由 **PM2** 守护 |
| 数据库 | SQLite 单文件：`server/data/pindou.db`（首次启动自动创建并导入内置图纸/色卡） |
| 数据目录 | `server/data/`（数据库 + 运行时数据，可整目录备份） |

---

## 一、环境准备

### 1. 安装 Node.js 24.19.0

**方式 A：宝塔 Node 版本管理器**
宝塔面板 → 软件商店 → 安装「Node.js 版本管理器」→ 安装 **24.19.0** 并设为默认版本。

**方式 B：nvm（命令行）**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 24.19.0
nvm alias default 24.19.0
node -v   # 确认输出 v24.19.0
```

### 2. 安装 PM2（进程守护）
```bash
npm install -g pm2
pm2 -v
```

### 3. 防火墙放行
- 网站流量：放行 **80 / 443**（宝塔「安全」中添加放行）
- 后端 **8787 端口不需要对外开放**，只允许本机访问即可（Nginx 反向代理转发）

---

## 二、上传 / 拉取代码

```bash
cd /www/wwwroot
git clone https://github.com/xigua03/pindou-studio.git pindou
cd pindou
```
> 也可用宝塔「文件」上传压缩包解压到 `/www/wwwroot/pindou`。

---

## 三、安装依赖并构建前端

```bash
cd /www/wwwroot/pindou
npm install        # 安装全部依赖（构建需要 devDependencies）
npm run build      # 类型检查 + 生产构建，产物输出到 dist/
```

构建完成后确认存在 `dist/index.html`。

---

## 四、配置 .env

```bash
cp .env.example .env
vim .env
```

按需填写（AI 生成图纸 / 识图需要）：

```env
# 千问（阿里云百炼）API Key
DASHSCOPE_API_KEY=sk-你的key
VISION_MODEL=qwen-vl-max
# 文生图模型（AI 生成图纸菜单）
WANX_MODEL=wanx2.1-t2i-turbo
# 若非千问（OpenAI 兼容）服务，取消注释并改地址
# DASHSCOPE_BASE_URL=https://api.openai.com/v1

# 正式访问地址（用于找回密码邮件里的重置链接）
FRONTEND_URL=https://你的域名

# SMTP 也可不填，在后台「系统设置 → 邮件服务」里配置（后台优先）
# SMTP_HOST=smtpdm.aliyun.com
# SMTP_PORT=465
# SMTP_USER=noreply@example.com
# SMTP_PASS=你的密码或授权码
# SMTP_FROM=拼豆工坊 <noreply@example.com>
```

> `.env` 属于敏感文件，不要提交到 Git；`.gitignore` 已忽略。

---

## 五、启动后端（PM2）

```bash
cd /www/wwwroot/pindou
pm2 start server/index.mjs --name pindou --interpreter node
pm2 save          # 保存进程列表
pm2 startup       # 按提示执行输出的命令，实现开机自启
```

**权限**：确认运行用户对数据目录有写权限（自动创建 `server/data/pindou.db`）：

```bash
chown -R $(whoami) server/data
```

**验证后端**：
```bash
curl http://127.0.0.1:8787/api/health   # 返回 {"ok":true} 之类即正常
pm2 status        # pindou 应处于 online
```

首次启动会自动：建库 → 导入内置图纸与品牌色卡 → 创建默认管理员 `admin / admin123`（上线后请尽快在后台改密）。

---

## 六、配置 Nginx（宝塔「网站」）

1. 宝塔「网站」→ 添加站点：填写你的域名，PHP 版本选「**纯静态**」。
2. 进入站点「设置 → 配置文件」，替换为：

```nginx
server {
    listen 80;
    server_name 你的域名;
    root /www/wwwroot/pindou/dist;
    index index.html;

    # 后端 API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        client_max_body_size 30m;   # 云同步/后台导入大图需要
    }

    # 前端静态资源（Hash 路由，无需 history 回退规则，保留兜底）
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

3. 保存后点击「重载」Nginx。

> 注意：`root` 必须指向构建产物 `dist/`，而不是项目根目录。

---

## 七、配置 HTTPS（推荐）

1. 宝塔「网站 → SSL」→ 申请 **Let's Encrypt 免费证书** → 开启「强制 HTTPS」。
2. 把 `.env` 里的 `FRONTEND_URL` 改成 `https://你的域名`，然后重启后端：
   ```bash
   pm2 restart pindou
   ```
3. 重新加载 Nginx 使证书生效。

---

## 八、部署后验证

1. 浏览器打开 `https://你的域名`：首页与图纸库正常显示。
2. 打开 `https://你的域名/#/admin`，用 `admin / admin123` 登录后台（**登录后立即改密**）。
3. 功能自检：
   - 注册一个新账号 → 个人中心 → 云同步正常
   - 生成一个分享链接，用另一个浏览器/手机打开
   - 「AI 生成」能出图（需 `.env` 已填 `DASHSCOPE_API_KEY`，未填会在页面提示）
   - 后台「系统设置 → 邮件服务」填好 SMTP 后点「发送测试邮件」能收到

---

## 八·五、更新已部署站点（每次发版后）

`ash
# 1. 进入项目目录
cd /www/wwwroot/pindou

# 2. 拉取最新代码（首次需先安装 git）
#    CentOS / 宝塔：  yum install -y git
#    Ubuntu/Debian： apt install -y git
git pull

# 3. 安装依赖（含构建所需 devDependencies，不要用 --omit=dev / --production）
npm install

# 4. 重新构建前端（产出新的 dist/，Nginx 直接托管；文件名带 hash 会自动清理浏览器缓存）
npm run build

# 5. 重启后端
pm2 restart pindou

# 6. 验证
curl http://127.0.0.1:8787/api/health   # 期望返回 {"ok":true,"ai":true,"maintenance":false}
`

> 说明：
> - server/data/（SQLite 数据库：用户/图纸/分享/后台配置）与 .env（AI Key、SMTP、端口）都被 .gitignore 排除，git pull **不会**动它们，你的数据与密钥全部保留。
> - 前端是纯静态 dist/，Nginx **无需重启**；用户在浏览器强刷一次（Ctrl+F5）即可看到新版。
> - 服务器没装 git 时，也可用宝塔「网站 → 版本管理」的 Git 功能拉取，或先 yum install -y git。
> - 若 
pm run build 报内存不足：NODE_OPTIONS=--max-old-space-size=2048 npm run build。
> - 如果只想更新后端（不涉及前端改动），可跳过第 4 步的 
pm run build。

## 九、日常运维

| 操作 | 命令 |
| --- | --- |
| 查看后端日志 | `pm2 logs pindou` |
| 重启后端 | `pm2 restart pindou` |
| 更新代码 | 见下方 |

**更新代码流程**：
```bash
cd /www/wwwroot/pindou
git pull
npm install
npm run build
pm2 restart pindou
```

**数据备份**（重要）：数据库是单文件，直接备份即可：
```bash
cp server/data/pindou.db /www/backup/pindou-$(date +%F).db
```
建议在宝塔「计划任务」里加一条每日定时备份脚本。

---

## 十、常见问题

1. **`node:sqlite` 报错 / 找不到模块**
   → 确认 `node -v` 为 24.x（24.19.0 内置，无需 `--experimental-sqlite` 标志）。若用的是宝塔自带旧版 Node，请用版本管理器切到 24.19.0。

2. **Nginx 502 Bad Gateway**
   → 后端没起来或 8787 未监听。执行 `pm2 status`、`pm2 logs pindou` 查看报错；确认 Nginx `proxy_pass` 地址端口正确。

3. **上传/保存大图纸报 413**
   → Nginx `client_max_body_size` 调大（如 50m）后重载。

4. **SMTP 测试一直转圈/超时**
   → 检查 SMTP 服务器地址、端口（465/587）与授权码；确认服务器出站 465/587 未被防火墙拦截。客户端已内置 20s 超时，不会一直卡住。

5. **采集定时任务不执行**
   → 后端必须保持运行（PM2 online），且服务器可访问外网采集源；采集开关在后台「采集中心」开启。

6. **8787 端口被占用**
   → 换个端口启动：`PORT=8788 pm2 restart pindou --update-env`，并同步修改 Nginx `proxy_pass`。

7. **图片转图纸、色卡、豆仓等纯前端功能**
   → 全部在浏览器本地运行，即使后端未启动也可用；只有登录/云同步/分享/后台/AI 依赖后端。
