"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Mode = "light" | "dark";

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
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    const saved = readMode();
    requestAnimationFrame(() => {
      setMode(saved);
      apply(saved);
    });
  }, []);

  const set = (next: Mode) => {
    setMode(next);
    localStorage.setItem("theme", next);
    apply(next);
  };

  return (
    <button
      onClick={() => set(mode === "dark" ? "light" : "dark")}
      title="Appearance"
      aria-label="Toggle theme"
      className="flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.05] bg-white text-zinc-500 transition-all hover:text-zinc-800 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
    >
      {mode === "dark" ? (
        <Sun className="h-3.5 w-3.5" strokeWidth={2} />
      ) : (
        <Moon className="h-3.5 w-3.5" strokeWidth={2} />
      )}
    </button>
  );
}