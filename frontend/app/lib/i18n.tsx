"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Lang = "zh" | "en";

const LS_LANG = "nb:lang";

const zh: Record<string, string> = {
  "app.title": "Dasiwo Notebook",
  "settings.title": "设置",
  "settings.save": "保存设置",
  "settings.cancel": "取消",
  "settings.language": "语言",
  "settings.language.hint": "界面显示语言",
  "settings.plugins": "插件市场",
  "settings.plugins.hint": "插件功能即将推出",
  "settings.plugins.coming": "插件市场尚未开放",
  "settings.panel.docs": "文档面板",
  "settings.panel.chat": "对话面板",
  "settings.panel.studio": "学习面板",
  "settings.panel.docs.hint": "文档列表与预览设置",
  "settings.panel.chat.hint": "对话记录与引用设置",
  "settings.panel.studio.hint": "学习工具与笔记设置",
  "settings.panel.coming": "面板管理功能即将推出",

  "ui.close": "关闭",
  "ui.test": "测试连接",
  "ui.studio": "学习工坊",
  "ui.note": "笔记",
  "ui.outputs": "产出",
};

const en: Record<string, string> = {
  "app.title": "Dasiwo Notebook",
  "settings.title": "Settings",
  "settings.save": "Save settings",
  "settings.cancel": "Cancel",
  "settings.language": "Language",
  "settings.language.hint": "UI display language",
  "settings.plugins": "Plugins",
  "settings.plugins.hint": "Plugin marketplace coming soon",
  "settings.plugins.coming": "Plugin marketplace not yet available",
  "settings.panel.docs": "Documents panel",
  "settings.panel.chat": "Chat panel",
  "settings.panel.studio": "Studio panel",
  "settings.panel.docs.hint": "Document list & preview settings",
  "settings.panel.chat.hint": "Conversation & citation settings",
  "settings.panel.studio.hint": "Study tools & notes settings",
  "settings.panel.coming": "Panel management coming soon",

  "ui.close": "Close",
  "ui.test": "Test connection",
  "ui.studio": "Studio",
  "ui.note": "Note",
  "ui.outputs": "Outputs",
};

const dicts: Record<Lang, Record<string, string>> = { zh, en };

type I18nCtx = { lang: Lang; setLang: (l: Lang) => void; t: (k: string) => string };

const Ctx = createContext<I18nCtx | null>(null);

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LS_LANG);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    /* ignore */
  }
  try {
    if (typeof navigator !== "undefined" && /^zh/i.test(navigator.language)) return "zh";
  } catch {
    /* ignore */
  }
  return "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangRaw] = useState<Lang>(() => (typeof window === "undefined" ? "en" : detectLang()));

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(LS_LANG, lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const value = useMemo<I18nCtx>(() => {
    const dict = dicts[lang];
    return {
      lang,
      setLang: setLangRaw,
      t: (k: string) => dict[k] ?? en[k] ?? k,
    };
  }, [lang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used within I18nProvider");
  return v;
}