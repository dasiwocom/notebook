// Electron 主进程（跨平台）：拉起 FastAPI + Next(standalone) 子进程，开窗口加载前端。
// - 后端 Python：优先用捆绑的 .venv（Linux 打包自包含）；没有则首次运行用系统 python
//   在用户目录建 venv 并 pip install -r requirements.txt（Win/mac 通用）。
// - 数据（DB/PDF 页图/OCR/上传）落到 app.getPath("userData")，不写进 AppImage。
// - 前端 standalone server 用捆绑的 node 跑（linux bin/node，win bin/node.exe），
//   没有则退回系统 node。

const { app, BrowserWindow, dialog } = require("electron");
const { spawn, spawnSync } = require("child_process");
const net = require("net");
const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");

// 每次启动生成随机 API 令牌：后端据此要求 Authorization 头，前端经 preload 注入，
// 防止局域网内其它主机 / 浏览器里的网页跨站读写本地接口（删文档、烧 API key 等）。
const API_TOKEN = crypto.randomBytes(24).toString("hex");

// 单实例锁：避免两个实例各起一套服务、并发写同一个 SQLite。
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

let quitting = false;

const DEV = !app.isPackaged;
const ROOT = DEV ? path.resolve(__dirname, "..") : process.resourcesPath;
const BACKEND_DIR = path.join(ROOT, "backend");
const FRONTEND_DIR = DEV
  ? path.join(ROOT, "frontend", ".next", "standalone")
  : path.join(ROOT, "frontend");
const NEXT_SERVER = path.join(FRONTEND_DIR, "server.js");

const IS_WIN = process.platform === "win32";
const LOG_FILE = path.join(app.getPath("temp"), "notebook-electron.log");
const STATE_FILE = path.join(app.getPath("userData"), "state.json");

let win = null;
let children = [];

function log(msg) {
  const line = `[electron] ${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function writeState(extra) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        { pid: process.pid, packaged: app.isPackaged, backendDir: BACKEND_DIR, frontendDir: FRONTEND_DIR, ...extra },
        null,
        2
      )
    );
  } catch {}
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function poll(url, timeoutMs, expectedStatus = 200) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === expectedStatus) resolve();
        else if (Date.now() < deadline) setTimeout(tryOnce, 400);
        else reject(new Error(`ready check ${url} -> ${res.statusCode}`));
      });
      req.on("error", () => {
        if (Date.now() < deadline) setTimeout(tryOnce, 400);
        else reject(new Error(`ready check failed: ${url}`));
      });
      req.setTimeout(1500, () => req.destroy());
    };
    tryOnce();
  });
}

async function startChild(cmd, args, opts) {
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (d) => log(`[${opts.name}] ${String(d).trimEnd()}`));
  child.stderr.on("data", (d) => log(`[${opts.name}:err] ${String(d).trimEnd()}`));
  child.on("exit", (code, sig) => {
    log(`[${opts.name}] exited code=${code} sig=${sig || "none"}`);
    // 运行期子进程意外崩溃（非退出清理）→ 弹窗并退出，避免窗口指向死端口。
    if (!quitting && (code !== 0 || sig)) {
      showFatal(`子进程 [${opts.name}] 意外退出（code=${code} sig=${sig || "none"}）`);
    }
  });
  children.push(child);
  return child;
}

// ---------- 后端 Python & 数据目录 ----------

function venvPython(venvDir) {
  return path.join(venvDir, IS_WIN ? "Scripts" : "bin", IS_WIN ? "python.exe" : "python");
}

// 捆绑的便携 Python（python-build-standalone）：完全自包含，普通用户机无需装 Python。
// 结构不跨平台统一：
//   - Linux: python/bin/python3
//   - Windows: python/python/python.exe（package.win.json 把 tools/python-win → python）
// 依赖一律装在 python/pydeps。
function portablePython() {
  const base = path.join(ROOT, "python");
  const winPy = path.join(base, "python", "python.exe");
  if (fs.existsSync(winPy)) return { py: winPy, pydeps: path.join(base, "pydeps") };
  const linuxPy = path.join(base, "bin", "python3");
  if (fs.existsSync(linuxPy)) return { py: linuxPy, pydeps: path.join(base, "pydeps") };
  return null;
}

function findSystemPython() {
  const candidates = IS_WIN ? ["python", "py"] : ["python3.13", "python3", "python"];
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ["--version"], { windowsHide: true, timeout: 5000 });
      if (!r.error && r.status === 0) return c;
    } catch {}
  }
  return null;
}

async function bootstrapVenv() {
  const userData = app.getPath("userData");
  const venvDir = path.join(userData, "backend-venv");
  const py = venvPython(venvDir);
  if (fs.existsSync(py)) return py;

  const sysPy = findSystemPython();
  if (!sysPy) throw new Error("找不到系统 Python，无法准备后端运行环境（请先安装 Python 3.13）");
  log(`首次运行：用系统 Python(${sysPy}) 在 ${venvDir} 建 venv`);
  await runStep(sysPy, ["-m", "venv", venvDir], "创建 venv");
  let pip = py;
  await runStep(pip, ["-m", "pip", "install", "--disable-pip-version-check", "-i", "https://pypi.tuna.tsinghua.edu.cn/simple", "--timeout", "30", "-r", path.join(BACKEND_DIR, "requirements.txt")], "安装后端依赖（可能较久）");
  return py;
}

function runStep(cmd, args, label) {
  return new Promise((resolve, reject) => {
    log(`run ${label}: ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, {
      cwd: BACKEND_DIR,
      env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: 900000, // 15 分钟兜底，避免 pip 卡死时窗口干等
    });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    child.on("error", (err) => reject(new Error(`${label} 启动失败: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} 失败(code=${code}):\n${out.split("\n").slice(-8).join("\n")}`));
    });
  });
}

function venvUsable(py) {
  // 真枪实弹自检：捆绑 venv 是复制自打包机，pyvenv.cfg 写死了打包机的
  // 解释器路径（home=/usr/bin, executable=.../python3.13）。在目标机
  // Python 版本不一致时，光存在 python 不算数——必须能实际 import 后端
  // 全模块链才算可用。模型加载都是惰性的，import 不会触发联网/大模型。
  try {
    const r = spawnSync(py, ["-c", "import app.main"], {
      cwd: BACKEND_DIR,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      windowsHide: true,
      timeout: 60000,
    });
    if (r.error || r.status !== 0) {
      log(`venv health check FAILED: ${py}`);
      const msg = (r.stderr ? String(r.stderr) : "").trim();
      if (msg) log(`  stderr: ${msg.split("\n").slice(-3).join(" | ")}`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function resolveBackend() {
  // 0) 捆绑的便携 Python（linux 打包自带）：最优先，完全自包含
  const portable = portablePython();
  if (portable) {
    log(`using bundled portable python: ${portable.py}`);
    return { python: portable.py, pydeps: portable.pydeps };
  }
  // 1) 捆绑的 venv（旧 linux 包兼容）：通过了健康检测才用
  const bundled = venvPython(path.join(BACKEND_DIR, ".venv"));
  if (fs.existsSync(bundled) && venvUsable(bundled)) {
    log(`using bundled venv: ${bundled}`);
    return { python: bundled, pydeps: null };
  }
  // 2) 用户目录 venv（首次运行自动创建，win/mac 及无捆绑包时）
  const bootstrapped = await bootstrapVenv();
  return { python: bootstrapped, pydeps: null };
}

function backendEnvVars(port) {
  const userData = app.getPath("userData");
  const data = path.join(userData, "data");
  const pdf = path.join(userData, "pdf");
  const pages = path.join(userData, "pdfpages");
  const ocr = path.join(userData, "pdf_ocr");
  for (const d of [data, pdf, pages, ocr]) fs.mkdirSync(d, { recursive: true });
  const env = {
    PORT: String(port),
    DB_PATH: path.join(data, "app.db"),
    PDF_DATA_DIR: pdf,
    PDF_PAGES_DIR: pages,
    PDF_OCR_DIR: ocr,
    NOTEBOOK_TOKEN: API_TOKEN,
  };
  // 目录表是只读资源，保留在打包目录里
  const toc = path.join(BACKEND_DIR, "data", "tocs.json");
  if (fs.existsSync(toc)) env.STUDY_TOC_PATH = toc;
  return env;
}

// ---------- 前端 node ----------

function resolveNode() {
  const binDir = path.join(ROOT, "bin");
  const cands = IS_WIN
    ? [path.join(binDir, "node.exe"), "node"]
    : [path.join(binDir, "node"), "/usr/bin/node", "node"];
  for (const c of cands) {
    if (c.includes(ROOT) || c.includes("usr/bin")) {
      if (fs.existsSync(c)) return c;
    } else {
      try {
        if (spawnSync(c, ["--version"], { windowsHide: true, timeout: 3000 }).status === 0) return c;
      } catch {}
    }
  }
  return null;
}

async function startBackend(python, pydeps, port) {
  const env = backendEnvVars(port);
  // 便携 Python 的依赖目录经 PYTHONPATH 注入；venv 模式无需
  if (pydeps) env.PYTHONPATH = pydeps;
  const child = await startChild(python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: BACKEND_DIR,
    env,
    name: "backend",
  });
  log(`waiting backend on ${port}`);
  await poll(`http://127.0.0.1:${port}/api/health`, 60000);
  log(`backend ready on ${port}`);
  return { port, child };
}

async function startFrontend(node, port) {
  const child = await startChild(node, [NEXT_SERVER], {
    cwd: FRONTEND_DIR,
    env: { HOSTNAME: "127.0.0.1", PORT: String(port) },
    name: "frontend",
  });
  log(`waiting frontend on ${port}`);
  await poll(`http://127.0.0.1:${port}`, 30000);
  log(`frontend ready on ${port}`);
  return { port, child };
}

async function boot() {
  const backendPort = await findFreePort();
  const frontendPort = await findFreePort();
  const { python, pydeps } = await resolveBackend();
  const node = resolveNode();
  if (!node) throw new Error("找不到可用的 node，无法启动前端服务");
  log(`ports backend=${backendPort} frontend=${frontendPort} python=${python} node=${node} pydeps=${pydeps || "-"}`);

  const BE = await startBackend(python, pydeps, backendPort);
  const FE = await startFrontend(node, frontendPort);
  writeState({ backendPort, frontendPort });

  const apiBase = `http://127.0.0.1:${backendPort}`;
  process.env.ELECTRON_API_BASE = apiBase;
  process.env.ELECTRON_API_TOKEN = API_TOKEN;
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    title: "notebook - 学习助手",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  log(`window -> http://127.0.0.1:${frontendPort} (api ${apiBase})`);
  writeState({ backendPort, frontendPort, apiBase });
  win.loadURL(`http://127.0.0.1:${frontendPort}`);
  win.on("closed", () => (win = null));
  return { BE, FE };
}

let fatalShown = false;
async function showFatal(msg) {
  if (fatalShown) return; // 幂等：boot 失败 + 子进程 exit 可能同时触发
  fatalShown = true;
  log(`fatal: ${msg}`);
  try {
    await dialog.showMessageBox({ type: "error", title: "notebook 启动失败", message: String(msg), detail: String(msg) });
  } catch {}
  app.exit(1);
}

if (gotLock) {
  app.whenReady().then(() => {
    boot().catch((e) => showFatal(e));
  });
}

app.on("window-all-closed", () => app.quit());

app.on("before-quit", () => {
  quitting = true;
  log("shutting down");
  for (const c of children) {
    try {
      c.kill();
    } catch {}
  }
});

process.on("exit", () => {
  for (const c of children) {
    try {
      c.kill();
    } catch {}
  }
});

process.on("SIGINT", () => app.quit());
process.on("SIGTERM", () => app.quit());