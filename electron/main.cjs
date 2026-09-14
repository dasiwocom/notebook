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
  child.on("exit", (code, sig) => log(`[${opts.name}] exited code=${code} sig=${sig || "none"}`));
  children.push(child);
  return child;
}

// ---------- 后端 Python & 数据目录 ----------

function venvPython(venvDir) {
  return path.join(venvDir, IS_WIN ? "Scripts" : "bin", IS_WIN ? "python.exe" : "python");
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
  await runStep(pip, ["-m", "pip", "install", "--disable-pip-version-check", "-r", path.join(BACKEND_DIR, "requirements.txt")], "安装后端依赖（可能较久）");
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
    });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} 失败(code=${code}):\n${out.split("\n").slice(-8).join("\n")}`));
    });
  });
}

async function resolveBackend() {
  // 1) 捆绑的 venv（Linux 打包自带）
  const bundled = venvPython(path.join(BACKEND_DIR, ".venv"));
  if (fs.existsSync(bundled)) return bundled;
  // 2) 用户目录 venv（首次运行自动创建）
  return await bootstrapVenv();
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

async function startBackend(python, port) {
  const child = await startChild(python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: BACKEND_DIR,
    env: backendEnvVars(port),
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
  const python = await resolveBackend();
  const node = resolveNode();
  if (!node) throw new Error("找不到可用的 node，无法启动前端服务");
  log(`ports backend=${backendPort} frontend=${frontendPort} python=${python} node=${node}`);

  const BE = await startBackend(python, backendPort);
  const FE = await startFrontend(node, frontendPort);
  writeState({ backendPort, frontendPort });

  const apiBase = `http://127.0.0.1:${backendPort}`;
  process.env.ELECTRON_API_BASE = apiBase;
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

async function showFatal(msg) {
  log(`fatal: ${msg}`);
  try {
    await dialog.showMessageBox({ type: "error", title: "notebook 启动失败", message: String(msg), detail: String(msg) });
  } catch {}
  app.exit(1);
}

app.whenReady().then(() => {
  boot().catch((e) => showFatal(e));
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", () => {
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