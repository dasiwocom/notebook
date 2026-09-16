# AGENTS.md

## 项目速览

notebook：本地优先、来源可溯的知识问答助手。
- `frontend/` Next.js（App Router，Tailwind）
- `backend/` FastAPI + SQLite + 向量检索
- `electron/` 桌面外壳（拉 FastAPI + Next standalone，一套代码跨三端）

## 代码模型 / 行为约束

- 回答必须基于检索到的文档，禁止编造；引用用 `[source:N]`，清洗成密集编号 `[d+1](#cite-d)`。
- `backend/app/study.py` mind_map 提示词有规则：**沿用材料给定的章节编号，不要重新编号**（绪论不是第1章）。
- `chat.py` 章节锚定：叶子点击的问题带 `（第N章 ...）`；引用 path 用 `_enrich_chapter_paths` 注入章节名。
- 工具产出（思维导图/quiz）生成即落库（studies 表），quiz 预览只显示内容、不带头部操作栏。
- 新建笔记 = 全屏编辑（同思维导图预览）；Retry 重发**上一条用户消息**，不是出错消息本身。

## 开发命令

```bash
# 后端（开发）   http://127.0.0.1:8000
cd backend && .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
# 前端（开发）   http://127.0.0.1:3000  （构建 standalone 部署）
cd frontend && npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public/. .next/standalone/public/
cd .next/standalone && env HOSTNAME=127.0.0.1 PORT=3000 node server.js
```

验证过：`npm run build` 通过后部署 3000/8000。

## 打包铁律（写死，勿改）

普通用户电脑**没有任何开发工具**（无 Python / Node / 无 venv）。任何依赖"用户装环境"的
方案都会导致打不开。因此：

1. **安装包必须完全自包含**：捆绑 portable Python + 全部依赖 + Node。
   - Linux：`electron/tools/python/`（bin/python3 + pydeps，AppImage 自带）
   - Windows：`electron/tools/python-win/`（python/python.exe + pydeps，经
     `package.win.json` extraResources 的 `tools/python-win → python` 复制进 resources）
   - `electron/main.cjs` 的 `portablePython()` 同时识别两种结构；无捆绑时**宁缺勿用**
     （不静默回退到系统 python 裸环境，否则普通用户机必然打不开）。
2. **后端依赖清单 `backend/requirements.txt` 必须纯 ASCII**：Windows 下 pip 用 GBK
   读文件，中文注释会 `UnicodeDecodeError`，导致整个依赖安装崩溃。
3. **打包只跑 `electron-builder --win portable --config package.win.json`**
   （Linux 产物 `npm run dist`），**不要**在脚本里依赖 GitHub 下载：
   用镜像 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`，
   并 `CSC_IDENTITY_AUTO_DISCOVERY=false`（免签名）。winCodeSign 解压符号链接失败时
   手动放缓存 + 用普通文件替代 darwin dylib 符号链接。
4. **前端 standalone 必须手动拷 static/public**：`next build` 的 standalone 不含
   `.next/static` 与 `public`，漏拷则 CSS 全丢。
5. **端口与鉴权**：打包后端端口动态（随机），前端一律走 `electronAPI.apiBase`（preload
   注入），**禁止**在前端写死 `:8000`。打包鉴权用 `electronAPI.token`：
   - fetch 带 `Authorization: Bearer <token>`（`authHeaders()`）
   - `<img>` 无法带 header，用 query token `?token=`（后端 `TokenAuthMiddleware`
     有 query-string 兜底，`backend/app/main.py`）
6. **`.ps1`/`.cjs` 跨平台换行**：zip 解压出的 .ps1 是 LF，Windows PowerShell 5.1 解析
   会报错；脚本保持英文注释、注意换行。
7. 安装包产物（site/*.AppImage、site/*.deb、electron/dist/*.exe）**不入 git**（gitignore），
   单独上传官网/分发。

## 数据落盘（非缓存，勿删）

`backend/data/`：`app.db`（文档/chunks/会话/产出全在库内）、`pdf/`（原文件）、
`pdfpages/`（页图）、`pdf_ocr/`。打包运行态写系统用户目录（Win `%APPDATA%\notebook`）。

## 发布 / git

- 每阶段功能完成即 `git push origin main --tags`（feature commit 打 tag：v1.0.0…）。
- `winnote.md` 是 Windows 打包现场复盘（改动已合入本仓库，该文件仅供追溯）。