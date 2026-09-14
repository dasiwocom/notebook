"use client";

import { useEffect, useRef, useState } from "react";
import { Moon, Settings, Sun } from "lucide-react";

type Mode = "light" | "dark";

function apply(mode: Mode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
}

function readMode(): Mode {
  if (typeof window === "undefined") return "light";
  const saved = localStorage.getItem("theme");
  return saved === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("light");
  const [open, setOpen] = useState(false);
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
    setMode(next);
    localStorage.setItem("theme", next);
    apply(next);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded-full border border-black/[0.05] bg-white px-3 text-xs text-zinc-500 transition-all hover:text-zinc-800 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <Settings className="h-3.5 w-3.5" strokeWidth={2} />
        Settings
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-xl border border-black/[0.06] bg-white p-2 shadow-xl dark:border-white/10 dark:bg-[#22262b]"
        >
          <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Appearance
          </p>
          <div className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[13px] text-zinc-600 dark:text-zinc-300">
            <span>日夜模式</span>
            <div className="flex rounded-full bg-zinc-100 p-0.5 dark:bg-[#2a2d33]">
              <button
                onClick={() => set("light")}
                className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] transition-colors ${
                  mode === "light"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-[#37383b] dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                <Sun className="h-3 w-3" strokeWidth={2} />
                日间
              </button>
              <button
                onClick={() => set("dark")}
                className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] transition-colors ${
                  mode === "dark"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-[#37383b] dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                <Moon className="h-3 w-3" strokeWidth={2} />
                夜间
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}