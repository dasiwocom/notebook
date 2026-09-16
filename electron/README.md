# notebook 桌面版（Electron）

`electron/` 是桌面外壳：主进程拉起 FastAPI + Next(standalone) 子进程，开窗口加载前端。
一套代码跨三端（Linux / Windows / macOS）。

## 目录结构

- `main.cjs` —— 主进程（跨平台）：选端口、拉起后端/前端、开窗口、退出清理
- `preload.cjs` —— 注入 `window.electronAPI.apiBase`（后端动态端口）
- `tools/node`、`tools/node.exe` —— 打包进 `bin/` 供前端 server 运行（Win 需要 node.exe）
- `dist/` —— 构建产物

## 运行方式

```bash
cd electron
npm start          # 开发态：直接拉源码里的 backend/.venv + frontend/.next/standalone
```

## 打包（重要：遵守 AGENTS.md「打包铁律」）

Linux 有 wine 时可直接 `npm run dist`；Windows 包必须在 Windows 主机执行
`npx electron-builder --win portable --config package.win.json`（见 `build-win.ps1`）。
Linux 上构建 Windows 包会报 `wine is required`。

## 跨平台机制（关键）

- **后端 Python**：打包后**必须完全自包含**，不允许依赖用户机的 Python。
  Linux 打包捆绑 `tools/python/`（bin/python3 + pydeps）；Windows 打包捆绑
  `tools/python-win/`（python/python.exe + pydeps），经 `package.win.json`
  extraResources 复制进 `resources/python/`。`portablePython()` 同时识别两种结构，
  找不到时宁报错也不能静默退到系统 python（普通用户机没有 Python，静默退必然失败）。
- **Node**：Windows 用 `bin/node.exe`、Linux 用 `bin/node`，都没有就退回系统 node。
- **数据目录**：DB/PDF 页图/OCR 都写到 `userData`（Linux `~/.config/notebook`、
  Win `%APPDATA%\notebook`），不写进安装目录/AppImage；上传的文档因此跨会话保留。
  目录表 `tocs.json` 是只读资源，留在打包目录里（`STUDY_TOC_PATH`）。
- **禁用 asar**（`asar:false`）：main/preload 直接以文件分发，避免资源读取问题。

## 构建三端

```bash
cd electron
# 前端产物先就绪（standalone 已内嵌 .next/static）
(cd ../frontend && npm ci && npm run build && mkdir -p .next/standalone/.next && cp -r .next/static .next/standalone/.next/static)

# 网络受限时用镜像
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

npm run dist        # Linux AppImage
npm run dist:win    # Windows portable（须在 Windows 上跑，或在 Linux 装 wine）
npm run dist:mac    # macOS dmg（必须在 macOS 上构建，Xcode 许可限制）
```

> Windows 装机包（.exe）依赖 wine 编辑 PE 资源：Linux 上构建会报 `wine is required`。
> 已用 `win-unpacked` 直接打 `notebook-1.0.0-win64-portable.zip` 作免安装版；
> 正式 installer 请在 Windows 主机执行 `npm run dist:win`。macOS 同理必须于 Mac 构建。

## 产物

- `dist/notebook-1.0.0.AppImage`（~400M，含 Linux portable Python，离线可用）
- Windows：`dist/<productName>-1.0.0<主版本>.exe`（portable，含
  `resources/python/python/python.exe` + `resources/python/pydeps`，双击即用）

## 已知待完善（todo）

- 应用图标（当前用 Electron 默认图标）
- Windows 正式 NSIS 安装包（需 windows 主机或 wine）
- macOS 签名/公证
- 首次启动的"正在解压/启动"进度提示（当前把日志写 `%TEMP%/notebook-electron.log`）
- 单实例锁（避免同时开两个实例各起一套服务）