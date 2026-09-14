"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChatPanel } from "./components/ChatPanel";
import { DocumentPanel } from "./components/DocumentPanel";
import { ToolsPanel } from "./components/ToolsPanel";
import { ThemeToggle } from "./components/ThemeToggle";
import { X } from "lucide-react";
import type { HighlightReq } from "./components/DocumentPanel";
import {
  chatStream,
  createConversation,
  createNote,
  deleteConversation,
  deleteDocument,
  getConversation,
  getDocument,
  listConversations,
  listDocuments,
  syncConversation,
  uploadDocument,
} from "./lib/api";
import type { ConversationInfo, LoadedMessage, PersistentMessage } from "./lib/api";
import type { ChatMessage, Citation, DocumentDetail, DocumentInfo } from "./lib/types";

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 640;
const DOC_MIN = 260;
const DOC_MAX = 640;
const LS_SIDEBAR = "bs:sidebarW";
const LS_DOC = "bs:docW";

function mapLoadedMessages(list: LoadedMessage[]): ChatMessage[] {
  return list.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    citations: (m.citations as ChatMessage["citations"]) ?? [],
    sources: (m.sources as ChatMessage["sources"]) ?? [],
    suggestions: m.suggestions ?? [],
    error: m.error,
  }));
}

function mapToPersist(msgs: ChatMessage[]): PersistentMessage[] {
  return msgs.map((m) => ({
    role: m.role,
    content: m.content,
    citations: m.citations,
    sources: m.sources,
    suggestions: m.suggestions,
    error: m.error,
  }));
}

function readSaved(key: string, min: number, max: number): number | null {
  if (typeof window === "undefined") return null;
  try {
    const v = Number(localStorage.getItem(key));
    if (Number.isFinite(v) && v >= min && v <= max) return Math.round(v);
  } catch {
    /* ignore */
  }
  return null;
}

function Divider({
  onMove,
  onDoubleClick,
  className = "",
}: {
  onMove: (delta: number) => void;
  onDoubleClick: () => void;
  className?: string;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    lastX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.documentElement.classList.add("dragging");
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const delta = e.clientX - lastX.current;
    lastX.current = e.clientX;
    onMove(delta);
  };
  const up = () => {
    if (!dragging.current) return;
    dragging.current = false;
    document.documentElement.classList.remove("dragging");
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={onDoubleClick}
      title="Double-click to reset widths"
      className={`group relative z-10 w-3 shrink-0 cursor-col-resize touch-none select-none ${className}`}
    >
      <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-transparent transition-colors group-hover:bg-zinc-300/70 group-active:bg-[#0b57d0]/60 dark:group-hover:bg-zinc-600" />
    </div>
  );
}

export default function Home() {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
  const [highlightReq, setHighlightReq] = useState<HighlightReq | null>(null);
  const [sidebarW, setSidebarW] = useState(320);
  const [docW, setDocW] = useState(320);
  const [sbCollapsed, setSbCollapsed] = useState(false);
  const [docCollapsed, setDocCollapsed] = useState(false);
  const [conversationIds, setConversationIds] = useState<Set<string>>(new Set());
  const [convs, setConvs] = useState<ConversationInfo[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [convReady, setConvReady] = useState(false);
  const [mobileTab, setMobileTab] = useState<"docs" | "chat" | "tools">("chat");
  const layoutRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const initialized = useRef(false);

  const calcThird = useCallback(
    (innerW: number) => {
      const pad = 16;
      const line = 8;
      const gap = 4;
      const dividers = (sbCollapsed ? 0 : 1) + (docCollapsed ? 0 : 1);
      const children = 3 + dividers;
      const avail = innerW - pad - (children - 1) * gap - dividers * line;
      return Math.max(DOC_MIN, Math.min(SIDEBAR_MAX, Math.floor(avail / 3)));
    },
    [sbCollapsed, docCollapsed]
  );

  useEffect(() => {
    const savedS = readSaved(LS_SIDEBAR, SIDEBAR_MIN, SIDEBAR_MAX);
    const savedD = readSaved(LS_DOC, DOC_MIN, DOC_MAX);
    setSidebarW(savedS ?? calcThird(window.innerWidth));
    setDocW(savedD ?? calcThird(window.innerWidth));
  }, [calcThird]);

  // restore the most recently used conversation from the backend on first load
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      try {
        const list = await listConversations();
        if (list.length === 0) {
          const created = await createConversation();
          setConvId(created.id);
          setConvs([
            {
              id: created.id,
              title: "新对话",
              created_at: 0,
              updated_at: Date.now(),
              message_count: 0,
            },
          ]);
        } else {
          const c = await getConversation(list[0].id);
          setMessages(mapLoadedMessages(c.messages));
          setConversationIds(new Set(c.doc_ids));
          setConvId(list[0].id);
          setConvs(list);
        }
      } catch {
        setNotice("Cannot reach backend, please make sure it's running (port 8000)");
      }
      setConvReady(true);
    })();
  }, []);

  const refreshConvs = useCallback(async () => {
    try {
      const list = await listConversations();
      setConvs(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  // persist selected source documents for the current conversation
  useEffect(() => {
    if (!convReady || !convId) return;
    syncConversation(convId, { doc_ids: [...conversationIds] }).catch(() => {});
  }, [conversationIds, convId, convReady]);

  const persistMessages = useCallback(
    async (msgs: ChatMessage[], title?: string) => {
      if (!convId) return;
      syncConversation(convId, {
        title,
        doc_ids: [...conversationIds],
        messages: mapToPersist(msgs),
      }).catch(() => {});
    },
    [convId, conversationIds]
  );

  useEffect(() => {
    const maxId = messages.reduce((acc, m) => {
      const n = Number(m.id.replace(/^m/, ""));
      return Number.isFinite(n) ? Math.max(acc, n) : acc;
    }, 0);
    idRef.current = maxId;
  }, [messages]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const refresh = useCallback(async () => {
    try {
      const list = await listDocuments();
      setDocuments(list);
      setSelectedId((prev) =>
        prev && !list.some((d) => d.id === prev) ? null : prev
      );
      setConversationIds((prev) => {
        const kept = [...prev].filter((id) => list.some((d) => d.id === id));
        return kept.length === prev.size ? prev : new Set(kept);
      });
    } catch {
      setNotice("Cannot reach backend, please make sure it's running (port 8000)");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // While any document is being processed in the background, keep the list
  // fresh; when a selected document becomes ready, reload its detail.
  useEffect(() => {
    if (!documents.some((d) => d.status === "processing")) return;
    const t = window.setInterval(async () => {
      try {
        const list = await listDocuments();
        setDocuments(list);
        const sel = list.find((d) => d.id === selectedId);
        if (sel && sel.status === "ready") {
          const detail = await getDocument(sel.id);
          setSelectedDoc(detail);
        }
      } catch {
        /* backend restarting */
      }
    }, 2000);
    return () => window.clearInterval(t);
  }, [documents, selectedId]);

  const handleReindexed = useCallback(() => {
    refresh();
    if (selectedId) {
      getDocument(selectedId)
        .then((d) => setSelectedDoc(d))
        .catch(() => {});
    }
  }, [refresh, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedDoc(null);
      return;
    }
    let active = true;
    getDocument(selectedId)
      .then((d) => active && setSelectedDoc(d))
      .catch(() => {
        if (active) {
          setNotice("Failed to load document details");
          setSelectedId(null);
        }
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  const handleOpen = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleToggleConversation = useCallback((id: string) => {
    setConversationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleAllConversation = useCallback(() => {
    setConversationIds((prev) => {
      const allIn = documents.length > 0 && documents.every((d) => prev.has(d.id));
      if (allIn) return new Set<string>();
      const next = new Set(prev);
      documents.forEach((d) => next.add(d.id));
      return next;
    });
  }, [documents]);

  const handleUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadPct(0);
      setNotice(null);
      const total = files.length;
      let done = 0;
      for (const file of files) {
        try {
          const res = await uploadDocument(file, (pct) =>
            setUploadPct(Math.round(((done + pct / 100) / total) * 100))
          );
          done += 1;
          setNotice(`「${res.name}」 uploaded — processing in the background, ask away shortly`);
        } catch (e) {
          done += 1;
          setNotice(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      await refresh();
      setUploading(false);
    },
    [refresh]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteDocument(id);
        await refresh();
      } catch (e) {
        setNotice(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [refresh]
  );

  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const userMsg: ChatMessage = {
        id: `m${++idRef.current}`,
        role: "user",
        content: trimmed,
        citations: [],
        sources: [],
      };
      const asstId = `m${++idRef.current}`;
      const asstMsg: ChatMessage = {
        id: asstId,
        role: "assistant",
        content: "",
        citations: [],
        sources: [],
        suggestions: [],
      };
      setMessages((prev) => [...prev, userMsg, asstMsg]);
      const fresh = [...messagesRef.current, userMsg, asstMsg];
      setLoading(true);
      setNotice(null);

      const isNew = convs.find((c) => c.id === convId)?.message_count === 0;
      const title = isNew ? trimmed.slice(0, 20) : undefined;
      persistMessages(fresh, title);

      const history = messagesRef.current
        .filter((m) => !m.error && m.content)
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content }));

      const docIds =
        conversationIds.size > 0 ? [...conversationIds] : null;

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      try {
        await chatStream({
            message: trimmed,
            history,
            doc_id: null,
            doc_ids: docIds,
            signal: controller.signal,
            onEvent: (ev) => {
              if (ev.type === "delta") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === asstId ? { ...m, content: m.content + ev.text } : m
                  )
                );
              } else if (ev.type === "done") {
                const doneList = messagesRef.current.map((m) =>
                  m.id === asstId
                    ? {
                        ...m,
                        citations: ev.citations,
                        sources: ev.sources,
                        suggestions: ev.suggestions,
                      }
                    : m
                );
                persistMessages(doneList);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === asstId
                      ? {
                          ...m,
                          citations: ev.citations,
                          sources: ev.sources,
                          suggestions: ev.suggestions,
                        }
                      : m
                  )
                );
              } else if (ev.type === "error") {
                const errList = messagesRef.current.map((m) =>
                  m.id === asstId ? { ...m, error: true, content: ev.text } : m
                );
                persistMessages(errList);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === asstId ? { ...m, error: true, content: ev.text } : m
                  )
                );
              }
            },
          });
      } catch (e) {
        const aborted =
          e instanceof DOMException && e.name === "AbortError";
        if (!aborted) {
          const err = `Request failed: ${e instanceof Error ? e.message : String(e)}`;
          const errList = messagesRef.current.map((m) =>
            m.id === asstId ? { ...m, error: true, content: err } : m
          );
          persistMessages(errList);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstId
                ? { ...m, error: true, content: err }
                : m
            )
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [loading, conversationIds, convId, convs, persistMessages]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  const handleCite = useCallback(
    (msgId: string, n: number) => {
      const target = messagesRef.current.find((m) => m.id === msgId);
      const citation = target?.citations?.[n];
      if (!citation) return;
      setMobileTab("docs");
      if (citation.doc_id !== selectedId) {
        setSelectedId(citation.doc_id);
      }
      const idx = messagesRef.current.findIndex((m) => m.id === msgId);
      let query = "";
      for (let i = idx - 1; i >= 0; i--) {
        if (messagesRef.current[i].role === "user") {
          query = messagesRef.current[i].content;
          break;
        }
      }
      setHighlightReq((prev) => ({
        section: citation.section,
        nonce: (prev?.nonce ?? 0) + 1,
        doc_id: citation.doc_id,
        query,
        snippet: citation.snippet,
      }));
    },
    [selectedId]
  );

  // Studio 产出卡片的引用跳转：直接给定引用对象（不在 messages 里）
  const handleSourceJump = useCallback(
    (citation: Citation) => {
      setMobileTab("docs");
      if (citation.doc_id !== selectedId) setSelectedId(citation.doc_id);
      setHighlightReq((prev) => ({
        section: citation.section,
        nonce: (prev?.nonce ?? 0) + 1,
        doc_id: citation.doc_id,
        query: "",
        snippet: citation.snippet,
      }));
    },
    [selectedId]
  );

  // 对话答案存为笔记（笔记挂在单一选中文档下，与 Studio 一致）
  const handleSaveToNote = useCallback(
    async (content: string) => {
      const targetDoc = conversationIds.size === 1 ? [...conversationIds][0] : null;
      if (!targetDoc) {
        setNotice("Save to note: select exactly one source document first");
        return;
      }
      try {
        await createNote(targetDoc, content);
        setNotice("Saved to note");
      } catch (e) {
        setNotice(`Failed to save note: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [conversationIds]
  );

  const handleClearChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setNotice(null);
    if (convId) syncConversation(convId, { messages: [] }).catch(() => {});
  }, [convId]);

  const handleSwitchConversation = useCallback(
    async (id: string) => {
      abortRef.current?.abort();
      abortRef.current = null;
      try {
        const c = await getConversation(id);
        setMessages(mapLoadedMessages(c.messages));
        setConversationIds(new Set(c.doc_ids));
        setConvId(id);
        refreshConvs();
      } catch {
        setNotice("Failed to load conversation");
      }
    },
    [refreshConvs]
  );

  const handleNewConversation = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    try {
      const created = await createConversation();
      setMessages([]);
      setConversationIds(new Set());
      setConvId(created.id);
      refreshConvs();
    } catch {
      /* ignore */
    }
  }, [refreshConvs]);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      try {
        await deleteConversation(id);
        const remaining = await refreshConvs();
        if (id !== convId) return;
        if (remaining.length > 0) {
          const c = await getConversation(remaining[0].id);
          setMessages(mapLoadedMessages(c.messages));
          setConversationIds(new Set(c.doc_ids));
          setConvId(remaining[0].id);
        } else {
          const created = await createConversation();
          setMessages([]);
          setConversationIds(new Set());
          setConvId(created.id);
          refreshConvs();
        }
      } catch {
        /* ignore */
      }
    },
    [convId, refreshConvs]
  );

  const clamp = (v: number, min: number, max: number) =>
    Math.round(Math.min(max, Math.max(min, v)));

  // 分隔线在当前面板的右缘/左缘位置决定符号：
  // 预览面板在左，分隔线在其右缘 → 向右拖 (=delta>0) 加宽 → prev + delta
  // 工具面板在右，分隔线在其左缘 → 向左拖 (=delta<0) 加宽 → prev - delta
  const moveDocDrag = (delta: number) => {
    setDocW((prev) => {
      const next = clamp(prev + delta, DOC_MIN, DOC_MAX);
      try {
        localStorage.setItem(LS_DOC, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const moveSidebarDrag = (delta: number) => {
    setSidebarW((prev) => {
      const next = clamp(prev - delta, SIDEBAR_MIN, SIDEBAR_MAX);
      try {
        localStorage.setItem(LS_SIDEBAR, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const resetWidths = useCallback(() => {
    const innerW = layoutRef.current
      ? layoutRef.current.clientWidth
      : window.innerWidth;
    const t = calcThird(innerW);
    setSidebarW(t);
    setDocW(t);
    try {
      localStorage.setItem(LS_SIDEBAR, String(t));
      localStorage.setItem(LS_DOC, String(t));
    } catch {
      /* ignore */
    }
  }, [calcThird]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="z-20 flex h-14 shrink-0 items-center justify-between bg-background px-5">
        <div className="flex items-center gap-2.5">
          <span className="text-[30px] leading-none">🤓</span>
          <p className="text-2xl font-semibold tracking-tight text-zinc-800 dark:text-zinc-50">
            Dasiwo Notebook
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div
        ref={layoutRef}
        data-mb={mobileTab}
        className="mb-layout flex min-h-0 flex-1 gap-1 p-2"
      >
        <DocumentPanel
          width={docW}
          documents={documents}
          doc={selectedDoc}
          highlight={highlightReq}
          selectedId={selectedId}
          conversationIds={conversationIds}
          uploading={uploading}
          uploadPct={uploadPct}
          collapsed={docCollapsed}
          onOpen={handleOpen}
          onBack={handleBack}
          onToggleCollapse={() => setDocCollapsed((v) => !v)}
          onToggleConversation={handleToggleConversation}
          onToggleAllConversation={handleToggleAllConversation}
          onUpload={handleUpload}
          onDelete={handleDelete}
          onReindexed={handleReindexed}
        />
        {!docCollapsed && (
          <Divider
            onMove={moveDocDrag}
            onDoubleClick={resetWidths}
            className="hidden min-[1200px]:block"
          />
        )}
        <main className="card mb-view mb-chat relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {notice && (
            <div className="z-10 flex items-start justify-between gap-2 border-b border-amber-200/70 bg-amber-50 px-5 py-2.5 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/60 dark:text-amber-300">
              <span className="line-clamp-3">{notice}</span>
              <button
                onClick={() => setNotice(null)}
                className="shrink-0 rounded-full p-1 text-amber-500 hover:bg-amber-100 hover:text-amber-700"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          )}
          <ChatPanel
            messages={messages}
            loading={loading}
            onSend={handleSend}
            onCite={handleCite}
            onClear={handleClearChat}
            onStop={handleStop}
            canClear={messages.length > 0 && !loading}
            conversations={convs}
            activeConvId={convId}
            onNewConversation={handleNewConversation}
            onSwitchConversation={handleSwitchConversation}
            onDeleteConversation={handleDeleteConversation}
            onSaveToNote={handleSaveToNote}
          />
        </main>
        {!sbCollapsed && (
          <Divider
            onMove={moveSidebarDrag}
            onDoubleClick={resetWidths}
            className="hidden min-[1200px]:block"
          />
        )}
        <ToolsPanel
          width={sidebarW}
          conversationIds={conversationIds}
          collapsed={sbCollapsed}
          onToggleCollapse={() => setSbCollapsed((v) => !v)}
          hasDoc={conversationIds.size > 0}
          docId={conversationIds.size === 1 ? [...conversationIds][0] : null}
          convId={convId}
          onCite={handleSourceJump}
        />
      </div>

      <nav className="mb-nav flex h-12 shrink-0 items-stretch border-t border-black/[0.05] px-2 min-[1200px]:hidden dark:border-white/10">
        {(
          [
            { key: "docs", label: "Sources" },
            { key: "chat", label: "Chat" },
            { key: "tools", label: "Studio" },
          ] as const
        ).map((t) => {
          const active = mobileTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setMobileTab(t.key)}
              className="relative flex flex-1 items-center justify-center"
            >
              <span className="relative inline-block">
                <span
                  className={`text-[12px] font-medium transition-colors ${
                    active
                      ? "text-zinc-900 dark:text-zinc-50"
                      : "text-zinc-400 dark:text-zinc-500"
                  }`}
                >
                  {t.label}
                </span>
                <span
                  className={`absolute inset-x-0 -bottom-[8px] h-[3px] rounded-full bg-[#0b57d0] transition-opacity dark:bg-[#a8c7fa] ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                />
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
