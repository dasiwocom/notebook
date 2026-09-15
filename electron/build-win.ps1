# 在 Windows 主机上构建 notebook Windows 免安装版（portable exe）。
#
# 前置条件（一次性）：
#   1. 安装 Node.js LTS (https://nodejs.org)。脚本会自动检查。
#   2. 把 Linux 侧 electron/tools/node.exe（68MB）拷贝到本机的 electron/tools/node.exe。
#      （node.exe 是 gitignored 的运行时二进制，不会随仓库自动带过来。
#        没有它，桌面版内置的 Next standalone server 无法启动。）
#   3. 若仓库未 clone：`git clone git@github.com:dasiwocom/notebook.git`
#
# 运行：
#   PowerShell 里，cd 到仓库根目录的 electron/ 下，执行：
#     powershell -ExecutionPolicy Bypass -File build-win.ps1
#   产物：electron/dist/notebook-1.0.0-win64-portable.exe（免安装，双击即用）
#
# 可选：网络受限时，先把下面两行解除注释走国内镜像：
#   $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
#   $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot   # 仓库根目录
$ElectronDir = $PSScriptRoot               # electron/
$FrontendDir = Join-Path $Root "frontend"

Write-Host "==> 0. 环境检查" -ForegroundColor Cyan
try {
    $nodeVer = (node --version).Trim()
    Write-Host "    Node: $nodeVer"
} catch {
    Write-Host "    找不到 node。请先安装 Node.js LTS: https://nodejs.org" -ForegroundColor Red
    exit 1
}

$nodeExe = Join-Path $ElectronDir "tools\node.exe"
if (-not (Test-Path $nodeExe)) {
    Write-Host "    缺少 electron/tools/node.exe（Windows 内置前端 server 用）。" -ForegroundColor Yellow
    Write-Host "    请从 Linux 侧 electron/tools/node.exe 拷贝过来后再继续。" -ForegroundColor Yellow
    exit 1
}
Write-Host "    node.exe: OK"

# ---- 1. 构建前端 standalone ----
Write-Host "==> 1. 构建前端 standalone" -ForegroundColor Cyan
Push-Location $FrontendDir
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "    npm install ...（首次较慢）"
        npm install --no-audit --no-fund
    }
    Write-Host "    npm run build ..."
    npm run build
    Write-Host "    复制 .next/static 与 public 到 standalone ..."
    New-Item -ItemType Directory -Force -Path ".next\standalone\.next" | Out-Null
    Copy-Item -Recurse -Force ".next\static" ".next\standalone\.next\static"
    New-Item -ItemType Directory -Force -Path ".next\standalone\public" | Out-Null
    Copy-Item -Recurse -Force "public\*" ".next\standalone\public\"
} finally {
    Pop-Location
}

# ---- 2. 安装 electron 依赖 ----
Write-Host "==> 2. 安装 electron / electron-builder 依赖" -ForegroundColor Cyan
Push-Location $ElectronDir
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "    npm install ...（会下载 electron 二进制，约 100MB）"
        npm install --no-audit --no-fund
    }
} finally {
    Pop-Location
}

# ---- 3. 打包 Windows portable ----
Write-Host "==> 3. electron-builder --win portable（使用 Windows 专用配置）" -ForegroundColor Cyan
Push-Location $ElectronDir
try {
    npx electron-builder --win portable --config package.win.json
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "构建完成！产物位于 dist/：" -ForegroundColor Green
Get-ChildItem (Join-Path $ElectronDir "dist") -Filter *.exe | ForEach-Object {
    Write-Host "    $($_.Name)  ($([math]::Round($_.Length / 1MB, 1)) MB)" -ForegroundColor Green
}