# notebook — 本地 Markdown 版 NotebookLM

基于你自己本地 Markdown 文档的检索问答工具（Grounded RAG）：

- 上传 .md 文档，按**标题层级切块**并做语义检索
- 提问时只基于你的文档作答，回答带**来源引用**（点击可看原文片段）
- 对话走 **DeepSeek API**；向量化用**本地 fastembed**（bge-small-zh，CPU 离线，不依赖外网 embedding 服务）
- Web 前端 + FastAPI 后端，本地单机运行，数据存在本地 SQLite

## 目录结构

```
notebook/
├── backend/
│   ├── app/
│   │   ├── main.py        # FastAPI 接口
│   │   ├── chunker.py     # Markdown 按标题切块
│   │   ├── embeddings.py  # OpenAI 兼容 embedding 客户端
│   │   ├── retriever.py   # numpy 向量检索
│   │   ├── chat.py        # 检索增强对话 + 引用解析
│   │   └── db.py          # SQLite 存储
│   ├── requirements.txt
│   └── .env.example
└── frontend/              # Next.js (App Router) + Tailwind
```

接口一览（后端 `:8000`）：
- `GET  /api/documents` 文档列表
- `POST /api/documents` 上传 .md（multipart）
- `GET  /api/documents/{id}` 文档详情 + 分块
- `DELETE /api/documents/{id}` 删除
- `POST /api/chat` 提问 `{"message": "..."}`

## 环境要求

- Python ≥ 3.11
- Node ≥ 20

## 第一步：配置

```bash
cp backend/.env.example backend/.env
# 用任意编辑器打开 backend/.env，把你的 DeepSeek API Key（sk-...）填入 DEEPSEEK_API_KEY
```

默认配置：

| 配置项 | 值 |
|---|---|
| 对话模型 | `deepseek-chat`（DeepSeek V3，走他们的 API） |
| Embedding | `BAAI/bge-small-zh-v1.5`（本地 fastembed，约 100MB，CPU 推理） |

首次运行后端时会自动从 HuggingFace 下载 embedding 模型（~100MB）。若网络不通，设置环境变量 `HF_ENDPOINT=https://hf-mirror.com HF_HUB_DISABLE_XET=1` 走国内镜像。

## 第二步：启动后端

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env           # 按需改成你的端点/模型
.venv/bin/uvicorn app.main:app --port 8000
```

`backend/.env` 配置说明见 `backend/.env.example`（端点、embedding / 对话模型、切块参数都在这）。

## 第三步：启动前端（生产模式）

```bash
cd frontend
npm install
npm run build          # 首次构建，约几秒
npm run start          # http://localhost:3000
```

> 注意用 `npm run start`（生产服务器），不要用 `npm run dev`。开发模式下访问 `http://127.0.0.1:3000` 或局域网 IP 会触发 Next.js 的 HMR 跨域保护导致页面反复刷新、表现为"全死"。

前端和后端跨主机访问的说明：
- 前端绑定 `0.0.0.0:3000`，后端绑定 `0.0.0.0:8000`，同一局域网内的其它设备也能用
- 前端会自动按访问的域名去找 `:8000` 后端（比如你用 `http://172.30.x.x:3000` 访问，它就会调 `http://172.30.x.x:8000`），无需配置；若后端在别的地址，可在 `frontend/.env.local` 写 `NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000`

## 已知现状 / 路线图

当前：
- 支持 `#`/`##`… ATX 标题结构切块；Setext 标题（`===` 下划线式）暂不识别
- 单 Notebook（所有文档在同一个检索空间）；无账号系统
- 对话非流式

下一步：
- 支持 PDF 解析（新增一层解析器即可，切块/检索/引用链路复用）
- SSE 流式输出
- 多 Notebook / 文档大纲视图与引用跳转到原文行
- 笔记与导览、Audio Overview