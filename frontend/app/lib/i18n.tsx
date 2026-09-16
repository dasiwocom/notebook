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
  "ui.documents": "文档",
  "ui.expand": "展开",
  "ui.collapse": "收起",
  "ui.cancel": "取消",
  "ui.save": "保存",
  "ui.delete": "删除",
  "ui.openPreview": "打开预览",

  "doc.search": "搜索文档…",
  "doc.paste": "粘贴 Markdown / 纯文本…",
  "doc.selectAll": "全选",
  "doc.delete": "删除文档",
  "doc.sort": "排序",
  "doc.sort.recent": "最近",
  "doc.sort.name": "名称",
  "doc.sort.chars": "字数",
  "doc.empty": "还没有文档",
  "doc.empty.hint": "上传或粘贴一份文档开始",
  "doc.upload": "上传文档",
  "doc.status.failed": "处理失败",
  "doc.status.indexing": "索引中",
  "doc.status.indexed": "已索引",
  "doc.addToChat": "加入对话",
  "doc.removeFromChat": "从对话移除",
  "doc.back": "返回文档列表",
  "doc.pagesUploading": "页面上传中…",
  "doc.processing": "正在处理你上传的文档",
  "doc.processing.hint": "处理完成后即可查看和提问",
  "doc.retry": "重试",
  "doc.reindexing": "重新索引中…",
  "doc.header": "文档与来源",

  "chat.title": "对话",
  "chat.placeholder": "向你的文档提问…",
  "chat.empty.title": "向你的文档提问",
  "chat.empty.hint": "上传 Markdown / PDF 后，回答将基于你的文档并附带可点来源",
  "chat.noConversations": "还没有对话",
  "chat.new": "新建对话",
  "chat.searchConv": "搜索对话…",
  "chat.retry": "重试",
  "chat.saveToNote": "保存为笔记",
  "chat.copy": "复制回答",
  "chat.switch": "切换对话",
  "chat.menu": "菜单",
  "chat.stop": "停止",
  "chat.send": "发送",
  "chat.deleteConv": "删除对话",
  "chat.export": "导出",
  "chat.viewSource": "查看来源",
  "chat.thinking": "思考中…",
  "note.empty": "空白笔记",
  "note.title": "笔记",
  "note.placeholder": "写点什么…",
  "note.newHint": "新建笔记（需先勾选一份文档）",
  "note.save": "保存为笔记",
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
  "ui.documents": "Documents",
  "ui.expand": "Expand",
  "ui.collapse": "Collapse",
  "ui.cancel": "Cancel",
  "ui.save": "Save",
  "ui.delete": "Delete",
  "ui.openPreview": "Open preview",

  "doc.search": "Search documents…",
  "doc.paste": "Paste Markdown / plain text…",
  "doc.selectAll": "Select all",
  "doc.delete": "Delete document",
  "doc.sort": "Sort",
  "doc.sort.recent": "Recent",
  "doc.sort.name": "Name",
  "doc.sort.chars": "Characters",
  "doc.empty": "No documents yet",
  "doc.empty.hint": "Upload or paste a document to start",
  "doc.upload": "Upload",
  "doc.status.failed": "Failed",
  "doc.status.indexing": "Indexing",
  "doc.status.indexed": "Indexed",
  "doc.addToChat": "Add to chat",
  "doc.removeFromChat": "Remove from chat",
  "doc.back": "Back to documents",
  "doc.pagesUploading": "Pages uploading…",
  "doc.processing": "Processing your uploaded document",
  "doc.processing.hint": "You can view & ask once it's ready",
  "doc.retry": "Retry",
  "doc.reindexing": "Re-indexing…",
  "doc.header": "Documents & sources",

  "chat.title": "Chat",
  "chat.placeholder": "Ask your documents…",
  "chat.empty.title": "Ask your documents anything",
  "chat.empty.hint": "After you upload Markdown / PDF files, answers are generated from your documents with cited sources",
  "chat.noConversations": "No conversations yet",
  "chat.new": "New conversation",
  "chat.searchConv": "Search conversations…",
  "chat.retry": "Retry",
  "chat.saveToNote": "Save to note",
  "chat.copy": "Copy answer",
  "chat.switch": "Switch conversation",
  "chat.menu": "Menu",
  "chat.stop": "Stop",
  "chat.send": "Send",
  "chat.deleteConv": "Delete conversation",
  "chat.export": "Export",
  "chat.viewSource": "View source",
  "chat.thinking": "Thinking…",
  "note.empty": "Empty note",
  "note.title": "Note",
  "note.placeholder": "Write something…",
  "note.newHint": "New note (select a document first)",
  "note.save": "Save to note",
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