"use client";

import { useEffect, useState } from "react";
import {
  ChevronRight,
  Moon,
  PanelLeft,
  PanelRight,
  Settings,
  Sun,
} from "lucide-react";
import { useI18n, type Lang } from "../lib/i18n";
import SettingsPanel from "./SettingsPanel";

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

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-2xl dark:border-white/10 dark:bg-[#22262b]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ModePicker({ mode, set }: { mode: Mode; set: (m: Mode) => void }) {
  const { t } = useI18n();
  const btn = (m: Mode, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => set(m)}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
        mode === m
          ? "bg-white font-medium text-zinc-900 shadow-sm dark:bg-[#37383b] dark:text-zinc-50"
          : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="flex rounded-xl bg-zinc-100 p-1 dark:bg-[#2a2d33]">
      {btn("light", <Sun className="h-3.5 w-3.5" strokeWidth={2} />, t("settings.appearance.light"))}
      {btn("dark", <Moon className="h-3.5 w-3.5" strokeWidth={2} />, t("settings.appearance.dark"))}
    </div>
  );
}

export function ThemeToggle({
  leftCollapsed,
  rightCollapsed,
  onToggleLeft,
  onToggleRight,
}: {
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
  onToggleLeft?: () => void;
  onToggleRight?: () => void;
}) {
  const { lang, setLang, t } = useI18n();
  const [mode, setMode] = useState<Mode>("light");
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const saved = readMode();
    requestAnimationFrame(() => {
      setMode(saved);
      apply(saved);
    });
  }, []);

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

  const row = "flex w-full items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-2.5 text-[13px] text-zinc-600 dark:bg-[#1f2327] dark:text-zinc-300";
  const rowLabel = "flex items-center gap-2.5";
  const rowIcon = "h-4 w-4 shrink-0 text-zinc-400";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Settings"
        aria-label="Settings"
        className="flex h-8 items-center gap-1.5 rounded-full border border-black/[0.05] bg-white px-2.5 text-xs text-zinc-500 transition-all hover:text-zinc-800 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <Settings className="h-3.5 w-3.5" strokeWidth={2} />
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-black/[0.05] px-5 dark:border-white/10">
            <h2 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">
              {t("settings.title")}
            </h2>
            <button
              onClick={() => setOpen(false)}
              className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            >
              <span className="text-lg leading-none">×</span>
            </button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <section>
              <h3 className="mb-2 text-[12px] font-medium text-zinc-400 dark:text-zinc-500">
                {t("settings.appearance")}
              </h3>
              <ModePicker mode={mode} set={set} />
            </section>

            <section>
              <h3 className="mb-2 text-[12px] font-medium text-zinc-400 dark:text-zinc-500">
                {t("settings.language")}
              </h3>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-[#2a2d33]">
                {(["zh", "en"] as Lang[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={`rounded-lg px-3 py-2 text-[13px] transition-colors ${
                      lang === l
                        ? "bg-white font-medium text-zinc-900 shadow-sm dark:bg-[#37383b] dark:text-zinc-50"
                        : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                    }`}
                  >
                    {l === "zh" ? "简体中文" : "English"}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-[12px] font-medium text-zinc-400 dark:text-zinc-500">
                {t("settings.panels")}
              </h3>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    onToggleLeft?.();
                    setOpen(false);
                  }}
                  className={row}
                >
                  <span className={rowLabel}>
                    <PanelLeft className={rowIcon} strokeWidth={2} />
                    {t("settings.dropdown.left")}
                  </span>
                  <span className="flex items-center gap-1 text-[12px] text-zinc-400">
                    {leftCollapsed ? t("ui.collapse") : t("ui.expand")}
                    <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
                  </span>
                </button>
                <button
                  onClick={() => {
                    onToggleRight?.();
                    setOpen(false);
                  }}
                  className={row}
                >
                  <span className={rowLabel}>
                    <PanelRight className={rowIcon} strokeWidth={2} />
                    {t("settings.dropdown.right")}
                  </span>
                  <span className="flex items-center gap-1 text-[12px] text-zinc-400">
                    {rightCollapsed ? t("ui.collapse") : t("ui.expand")}
                    <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
                  </span>
                </button>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-[12px] font-medium text-zinc-400 dark:text-zinc-500">
                {t("settings.dropdown.chat")}
              </h3>
              <button
                onClick={() => setSettingsOpen(true)}
                className="flex w-full items-center justify-between rounded-xl bg-zinc-50 px-3 py-2.5 text-[13px] text-zinc-600 transition-colors hover:bg-zinc-100 dark:bg-[#1f2327] dark:text-zinc-300 dark:hover:bg-[#2a2d33]"
              >
                <span className={rowLabel}>
                  <Settings className={rowIcon} strokeWidth={2} />
                  {t("settings.title")}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-zinc-400" strokeWidth={2} />
              </button>
            </section>
          </div>
        </Modal>
      )}

      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          onSaved={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}