const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  apiBase: process.env.ELECTRON_API_BASE || "http://127.0.0.1:8000",
});