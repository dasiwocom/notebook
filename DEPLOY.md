# Notebook 部署指南（宝塔面板 / 通用 Linux）

本地知识库问答系统，三部分互相独立：

| 部件 | 技术栈 | 端口(本地) | 说明 |
|---|---|---|---|
| 前端 | Next.js 15 (App Router, `output: standalone`) | 3000 | Node 进程跑 `.next/standalone/server.js` |
| 后端 | FastAPI (Python ≥3.10) | 8000 | 上传/切块/向量化/RAG 问答/PDF 渲染 |
| 官网 site/ | 纯静态 HTML | 任意 | `site/` 目录，可作独立静态站点 |

前端浏览器默认回调 `http://<当前host>:8000`。部署到域名时推荐**同源反代**：
浏览器只访问域名 → Nginx 把 `/` 转发前端、`/api/` 转发后端（免 CORS、不暴露 8000）。

---

## 1. 本地快速启动

```bash
# 后端
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # 填写 DEEPSEEK_API_KEY 等
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# 前端（另一终端）
cd ../frontend
npm install
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public/. .next/standalone/public/
cd .next/standalone && PORT=3000 node server.js
```

> `.next/standalone` 每次 build 后必须手动拷入 `static/` 与 `public/`（含 PWA 的 sw.js、manifest、图标）。
> Electron 端由 `electron/` 负责，自动拉起前后端，无需手动启动。

---

## 2. 后端配置（backend/.env）

必需项：

```env
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
CHAT_MODEL=deepseek-chat
EMBEDDING_PROVIDER=bge-small-zh      # 本机 fastembed，CPU 离线
```

可选：`OPENAI_API_KEY / OPENAI_BASE_URL`（OpenAI 兼容网关）、`PDF_DATA_DIR / PDF_OCR_DIR / PDF_PAGES_DIR`（数据目录，默认 `backend/data/` 下）。

运行期可在网页「设置」里覆盖（存 `data/settings.json`，不落代码仓库）。

---

## 3. 构建前端部署包（在本地做，省服务器资源）

```bash
cd frontend
NEXT_PUBLIC_API_BASE=/ npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public/. .next/standalone/public/
cd .. && zip -r frontend-deploy.zip frontend/.next/standalone
```

> **构建机 Node 主版本必须与服务器一致**（standalone 有 Node 版本校验）。
> `NEXT_PUBLIC_API_BASE=/` 让浏览器走同源 `/api/*`；本地运行不要带这个变量（默认直连 `host:8000`）。

---

## 4. 宝塔面板部署

### 4.1 后端 —— Python 项目管理器
1. 上传整个 `backend/` 到服务器（如 `/www/wwwroot/notebook/backend`）。
2. 宝塔「软件商店 → Python 项目管理器」新增项目：目录选 backend，Python 3.10+，自动建虚拟环境。
3. 执行 `pip install -r requirements.txt`（fastembed/onnxruntime 体积大、较慢）。
4. 创建 `backend/.env`（见第 2 节）。
5. 启动命令：`uvicorn app.main:app --host 127.0.0.1 --port 8000`。

### 4.2 前端 —— Node 项目（PM2）
1. 上传解压 `frontend-deploy.zip`（即 standalone 目录）。
2. 宝塔「Node 项目」新增：启动文件 `server.js`，环境变量 `PORT=3000`、`HOSTNAME=127.0.0.1`。

### 4.3 网站 + 反向代理 + SSL
1. 宝塔「网站 → 添加站点」绑定你的域名（目录随意）。
2. 申请 SSL（Let's Encrypt）。
3. 修改该站点 Nginx 配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
location /api/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;        # 聊天为流式输出，必须关缓冲
    proxy_read_timeout 300s;
}
location /sw.js {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
}
```

4. 安全组/防火墙只放行 80、443；3000/8000 保持仅本机回环。

### 4.4 官网 site/
把 `site/` 单独建一个静态站点（或挂子目录），Nginx 直接 `root` 指向即可，无需 Node。

---

## 5. 更新流程

```bash
# 前端改动
cd frontend && NEXT_PUBLIC_API_BASE=/ npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public/. .next/standalone/public/
# 上传替换 standalone → 宝塔 Node 项目重启

# 后端改动
# 上传 backend（排除 data/、.venv/）→ 重启 Python 项目
```

---

## 6. 数据与备份

所有用户数据都在 **`backend/data/`**：
- `app.db` 文档索引/对话（SQLite）
- `pdf/`、`pdfpages/`、`pdf_ocr/`：PDF 原文、渲染页图、OCR
- `settings.json` 运行时覆盖

备份 = 拷贝 `backend/data/` 即可；恢复 = 原样放回。

---

## 7. 干净源码包

仓库结构（部署前请排除这些目录/文件，避免体积与泄露）：

```
排除：frontend/node_modules、frontend/.next、
      backend/.venv、backend/data、backend/**/__pycache__、
      electron/node_modules、electron/dist、electron/release
注意：backend/.env 含密钥，切勿上传到公开仓库
```