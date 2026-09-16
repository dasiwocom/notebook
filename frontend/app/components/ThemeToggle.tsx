"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Moon, Settings, Sun } from "lucide-react";
import { useI18n } from "../lib/i18n";
import SettingsPanel from "./SettingsPanel";

type Mode = "light" | "dark";
type Submenu = "lang" | "theme" | "chat" | null;

function apply(mode: Mode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
}

function readMode(): Mode {
  if (typeof window === "undefined") return "light";
  const saved = localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") return saved;
  // 无保存偏好时跟随系统，与 layout.tsx 内联脚本的预置逻辑一致，避免首屏闪烁
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const { lang, setLang, t } = useI18n();
  const [mode, setMode] = useState<Mode>("light");
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<Submenu>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = readMode();
    requestAnimationFrame(() => {
      setMode(saved);
      apply(saved);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const set = (next: Mode) => {
    // 切换期间禁用过渡，避免面板/背景/按钮换色不同步
    document.documentElement.classList.add("no-theme-transition");
    setMode(next);
    localStorage.setItem("theme", next);
    apply(next);
    requestAnimationFrame(() => {
      requestAnimationFrame(() =>
        document.documentElement.classList.remove("no-theme-transition")
      );
    });
  };

  const close = () => {
    setOpen(false);
    setSub(null);
  };

  const item = "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] text-zinc-600 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-[#32383e]";
  const subItem = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-zinc-600 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-[#32383e]";
  const subPanel = "absolute right-full top-0 z-50 mr-1 w-44 rounded-lg border border-black/[0.06] bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#22262b]";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded-full border border-black/[0.05] bg-white px-2.5 text-xs text-zinc-500 transition-all hover:text-zinc-800 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <Settings className="h-3.5 w-3.5" strokeWidth={2} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-52 rounded-lg border border-black/[0.06] bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#22262b]">
          <button onClick={() => setSub(sub === "lang" ? null : "lang")} className={item}>
            <span>{t("settings.dropdown.language")}</span>
            <span className="flex items-center gap-1">
              <span className="text-[12px] text-zinc-400 dark:text-zinc-500">
                {lang === "zh" ? "简体中文" : "English"}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-zinc-400" strokeWidth={2} />
            </span>
          </button>
          {sub === "lang" && (
            <div className={subPanel}>
              <button
                onClick={() => {
                  setLang("zh");
                  close();
                }}
                className={`${subItem} ${lang === "zh" ? "font-medium text-zinc-900 dark:text-zinc-100" : ""}`}
              >
                简体中文
              </button>
              <button
                onClick={() => {
                  setLang("en");
                  close();
                }}
                className={`${subItem} ${lang === "en" ? "font-medium text-zinc-900 dark:text-zinc-100" : ""}`}
              >
                English
              </button>
            </div>
          )}

          <button onClick={() => setSub(sub === "theme" ? null : "theme")} className={item}>
            <span>{t("settings.dropdown.theme")}</span>
            <span className="flex items-center gap-1">
              {mode === "dark" ? (
                <Moon className="h-3.5 w-3.5 text-zinc-400" strokeWidth={2} />
              ) : (
                <Sun className="h-3.5 w-3.5 text-zinc-400" strokeWidth={2} />
              )}
              <span className="text-[12px] text-zinc-400 dark:text-zinc-500">
                {mode === "dark" ? t("settings.appearance.dark") : t("settings.appearance.light")}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-zinc-400" strokeWidth={2} />
            </span>
          </button>
          {sub === "theme" && (
            <div className={subPanel}>
              <button
                onClick={() => set("light")}
                className={`${subItem} ${mode === "light" ? "font-medium text-zinc-900 dark:text-zinc-100" : ""}`}
              >
                <Sun className="h-3.5 w-3.5" strokeWidth={2} />
                {t("settings.appearance.light")}
              </button>
              <button
                onClick={() => set("dark")}
                className={`${subItem} ${mode === "dark" ? "font-medium text-zinc-900 dark:text-zinc-100" : ""}`}
              >
                <Moon className="h-3.5 w-3.5" strokeWidth={2} />
                {t("settings.appearance.dark")}
              </button>
            </div>
          )}

          <button onClick={() => setSub(sub === "chat" ? null : "chat")} className={item}>
            <span>{t("settings.dropdown.chat")}</span>
            <ChevronRight className="h-3.5 w-3.5 text-zinc-400" strokeWidth={2} />
          </button>
          {sub === "chat" && (
            <div className={subPanel}>
              <button
                onClick={() => {
                  setOpen(false);
                  setSub(null);
                  setSettingsOpen(true);
                }}
                className={subItem}
              >
                <Settings className="h-3.5 w-3.5" strokeWidth={2} />
                {t("settings.title")}
              </button>
            </div>
          )}
        </div>
      )}

      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          onSaved={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}