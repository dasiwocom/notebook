"use client";

import React, { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  MoreVertical,
  Plus,
  Quote,
  RotateCcw,
  Save,
  SendHorizontal,
  Settings,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import type { ChatMessage } from "../lib/types";
import type { ConversationInfo } from "../lib/api";
import SettingsPanel from "./SettingsPanel";

type Props = {
  messages: ChatMessage[];
  loading: boolean;
  onSend: (text: string) => void;
  onCite: (msgId: string, n: number) => void;
  onClear: () => void;
  onStop: () => void;
  canClear: boolean;
  conversations: ConversationInfo[];
  activeConvId?: string | null;
  onNewConversation: () => void;
  onSwitchConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onSaveToNote: (content: string) => void;
};

function CitationLink({ n, onCite }: { n: number; onCite: (n: number) => void }) {
  return (
    <button
      onClick={() => onCite(n)}
      className="mx-0.5 inline-flex -translate-y-px items-center rounded-full bg-zinc-100 px-[7px] py-0.5 text-[11px] font-semibold tabular-nums text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      title="View source"
    >
      {n + 1}
    </button>
  );
}

const CITE_SPLIT_RE = /\[source:(\d+)\]/g;

const MAX_BADGES_PER_SOURCE = 2;
const MAX_BADGES_TOTAL = 48;

function toCiteMarkdown(content: string): string {
  // 角标去噪 + 密集编号：[source:N] → 可点击角标 [d+1]。
  // d 按「首次出现顺序」从 0 开始分配，与后端 citations 的密集顺序一致，
  // 避免跳号引用（只引 source:0 和 source:2）时角标错位、点击错源。
  const dense = new Map<number, number>();
  const perSource = new Map<number, number>();
  let total = 0;
  let last: { n: number; end: number } | null = null;
  const re = /\[source:(\d+)\]/g;
  const parts: string[] = [];
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const n = Number(m[1]);
    const dupAdjacent = last !== null && last.n === n && last.end === m.index;
    last = { n, end: re.lastIndex };
    let d = dense.get(n);
    if (d === undefined) {
      d = dense.size;
      dense.set(n, d);
    }
    const atCap =
      (perSource.get(d) ?? 0) >= MAX_BADGES_PER_SOURCE ||
      total >= MAX_BADGES_TOTAL;
    parts.push(content.slice(pos, m.index));
    if (!dupAdjacent && !atCap) {
      parts.push(`[${d + 1}](#cite-${d})`);
      perSource.set(d, (perSource.get(d) ?? 0) + 1);
      total += 1;
    }
    pos = re.lastIndex;
  }
  parts.push(content.slice(pos));
  return parts.join("");
}

function toCopyMarkdown(content: string): string {
  // 复制用：把 [source:N] 转成易读的 [N+1]
  return content.replace(CITE_SPLIT_RE, (_, ns) => `[${Number(ns) + 1}]`);
}

function uniqueCitations(citations: ChatMessage["citations"]) {
  const seen = new Set<number>();
  const out: { c: ChatMessage["citations"][number]; i: number }[] = [];
  citations.forEach((c, i) => {
    if (!seen.has(c.chunk_id)) {
      seen.add(c.chunk_id);
      out.push({ c, i });
    }
  });
  return out;
}

function AnswerBody({
  content,
  onCite,
}: {
  content: string;
  onCite: (n: number) => void;
}) {
  const markdown = useMemo(() => toCiteMarkdown(content), [content]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a: ({ href, children, ...rest }: any) => {
      if (typeof href === "string" && href.startsWith("#cite-")) {
        const n = parseInt(href.slice(6), 10);
        return <CitationLink n={n} onCite={onCite} />;
      }
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      );
    },
  };

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert
      prose-headings:mb-2 prose-headings:mt-6 prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-zinc-900
      prose-h1:text-[20px] prose-h2:text-[17px] prose-h3:text-[15px] prose-h4:text-[14px]
      prose-p:my-3 prose-p:text-[15px] prose-p:leading-7 prose-p:text-zinc-800
      prose-li:my-1 prose-li:leading-7 prose-li:text-zinc-800
      prose-strong:font-semibold prose-strong:text-zinc-900
      prose-code:rounded prose-code:bg-zinc-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[13px] prose-code:font-medium prose-code:text-zinc-700 prose-code:before:content-none prose-code:after:content-none
      prose-pre:my-4 prose-pre:rounded-[14px] prose-pre:border prose-pre:border-black/[0.05] prose-pre:bg-zinc-50 prose-pre:shadow-sm
      prose-a:text-zinc-600 prose-a:underline prose-a:underline-offset-2 prose-a:decoration-zinc-300 prose-a:hover:text-zinc-900
      prose-blockquote:my-4 prose-blockquote:border-l-2 prose-blockquote:border-zinc-200 prose-blockquote:not-italic prose-blockquote:font-normal prose-blockquote:text-zinc-500
      prose-hr:border-black/[0.06]
      prose-th:py-1 prose-th:text-zinc-700 prose-td:py-1 prose-table:text-[13px]
      dark:prose-headings:text-zinc-50
      dark:prose-p:text-zinc-300 dark:prose-li:text-zinc-300 dark:prose-strong:text-zinc-50
      dark:prose-code:bg-zinc-800 dark:prose-code:text-zinc-200
      dark:prose-pre:bg-zinc-900 dark:prose-pre:border-white/10
      dark:prose-a:text-zinc-300 dark:prose-a:decoration-zinc-600 dark:prose-a:hover:text-zinc-50
      dark:prose-blockquote:border-zinc-700 dark:prose-blockquote:text-zinc-400
      dark:prose-hr:border-white/10 dark:prose-th:text-zinc-200">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

const AssistantCard = memo(function AssistantCard({
  m,
  onCite,
  onSend,
  onRetry,
  onSaveToNote,
}: {
  m: ChatMessage;
  onCite: (msgId: string, n: number) => void;
  onSend: (t: string) => void;
  onRetry: () => void;
  onSaveToNote: (content: string) => void;
}) {
  const [openSources, setOpenSources] = useState(false);
  const [copied, setCopied] = useState(false);
  // 流式期间 content 每 token 都在变；用 useDeferredValue 把昂贵的 Markdown
  // 渲染降为低优先级，让打字/滚动保持流畅（React 会在负载下合并渲染）。
  const deferredContent = useDeferredValue(m.content);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toCopyMarkdown(m.content));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const cited = uniqueCitations(m.citations);
  const citeCount = cited.length;

  return (
    <div className="animate-rise w-full p-5 ps-0">
      {m.error ? (
        <div className="rounded-[14px] border border-red-200 bg-red-50/70 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {m.content}
          <button
            onClick={onRetry}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:bg-zinc-900 dark:text-red-400"
            title="Retry"
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="mb-2 text-xs italic text-zinc-400 dark:text-zinc-500">
            {citeCount > 0
              ? `Answer based on ${citeCount} source${citeCount > 1 ? "s" : ""}`
              : "Answer"}
          </div>
          <div className="text-[15px] leading-7">
            {m.content.trim().length === 0 && citeCount === 0 ? (
              <span className="inline-flex items-center gap-3 text-sm text-zinc-400">
                <span className="relative block">
                  <span className="orb" />
                  <span className="orb-ring" />
                </span>
                Thinking…
              </span>
            ) : (
              <AnswerBody
                content={deferredContent}
                onCite={(n) => onCite(m.id, n)}
              />
            )}
          </div>

          {citeCount > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setOpenSources((v) => !v)}
                className="press flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                <Quote className="h-3.5 w-3.5" strokeWidth={2} />
                Sources {citeCount}
                <ChevronDown
                  className="h-3.5 w-3.5 transition-all duration-150"
                  strokeWidth={2}
                  style={{ transform: openSources ? "rotate(180deg)" : undefined }}
                />
              </button>

              {openSources && (
                <div className="mt-2 rounded-2xl border border-black/[0.04] bg-white p-2 dark:border-white/[0.06] dark:bg-[#22262b]">
                  <ul className="space-y-0.5">
                    {cited.map(({ c, i }) => (
                      <li
                        key={c.chunk_id}
                        onClick={() => onCite(m.id, i)}
                        title={c.verified === false ? "This source may not match the claim" : "Click to locate the source"}
                        className={`group cursor-pointer flex items-start gap-2.5 rounded-xl px-3 py-2 text-xs transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04] ${c.verified === false ? "opacity-55" : ""}`}
                      >
                        <span className="mt-px inline-flex w-4 shrink-0 items-center justify-center text-[11px] font-semibold tabular-nums text-zinc-400">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-zinc-700 group-hover:text-zinc-900 dark:text-zinc-300 dark:group-hover:text-zinc-100">
                            {c.doc_name}
                            <span className="text-zinc-400"> › {c.section}</span>
                          </p>
                          <p className="mt-0.5 line-clamp-2 leading-5 text-zinc-400">
                            {c.snippet}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {m.suggestions && m.suggestions.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {m.suggestions.map((s, i) => (
                <button
                  key={s}
                  style={{ animationDelay: `${i * 70}ms` }}
                  onClick={() => onSend(s)}
                  className="animate-rise press flex items-center gap-1.5 rounded-full border border-black/[0.06] px-3 py-1.5 text-xs text-zinc-500 transition-all hover:bg-zinc-50 hover:text-zinc-800 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-100"
                >
                  <Sparkles className="h-3 w-3 text-zinc-400" strokeWidth={2} />
                  {s}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {!m.error && m.content.trim() && (
        <div className="mt-4 flex items-center justify-end gap-1">
          <button
            onClick={() => onSaveToNote(m.content)}
            className="press flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-300"
            title="Save to note"
          >
            <Save className="h-3.5 w-3.5" strokeWidth={2} />
            Save to note
          </button>
          <button
            onClick={copy}
            className={`press flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              copied
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-300"
            }`}
            title="Copy answer"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
});

export function ChatPanel({
  messages,
  loading,
  onSend,
  onCite,
  onClear,
  onStop,
  canClear,
  conversations,
  activeConvId,
  onNewConversation,
  onSwitchConversation,
  onDeleteConversation,
  onSaveToNote,
}: Props) {
  const [input, setInput] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [convMenuOpen, setConvMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen && !convMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-chat-menu]")) setMenuOpen(false);
      if (!(e.target as Element).closest("[data-conv-menu]")) setConvMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen, convMenuOpen]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 只有用户本来就在底部时才自动跟随；流式期间用 instant 避免平滑滚动排队。
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    }
  }, [messages, loading]);

  const submit = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    onSend(text);
  };

  const exportConversation = () => {
    if (messages.length === 0) return;
    const md = messages
      .map((m) =>
        m.role === "user"
          ? `**You**\n\n${m.content}`
          : `**Assistant**\n\n${toCopyMarkdown(m.content)}`
      )
      .join("\n\n---\n\n");
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "notebook-conversation.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      <div className="mb-head mb-chat-head flex h-12 shrink-0 items-center justify-between border-b border-black/[0.05] px-4 dark:border-white/10">
        <div className="relative min-w-0" data-conv-menu>
          <button
            onClick={() => setConvMenuOpen((v) => !v)}
            className="flex max-w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-[15px] text-zinc-800 transition-colors hover:bg-black/[0.04] dark:text-zinc-100 dark:hover:bg-white/[0.06]"
            title="Switch conversation"
          >
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" strokeWidth={2} />
            <span className="truncate">
              {conversations.find((c) => c.id === activeConvId)?.title ?? "Chat"}
            </span>
          </button>
          {convMenuOpen && (
            <div className="absolute left-0 top-full z-40 mt-1.5 w-72 max-h-80 overflow-y-auto rounded-xl border border-black/[0.08] bg-white py-1 shadow-xl dark:border-white/10 dark:bg-[#22262b]">
              {conversations.length === 0 && (
                <p className="px-3 py-2 text-[13px] text-zinc-400">
                  No conversations yet
                </p>
              )}
              {conversations.map((c) => {
                const active = c.id === activeConvId;
                return (
                  <div
                    key={c.id}
                    className={`group flex items-center gap-2 px-2 ${active ? "bg-black/[0.04] dark:bg-white/[0.06]" : ""}`}
                  >
                    <button
                      onClick={() => {
                        onSwitchConversation(c.id);
                        setConvMenuOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left"
                    >
                      <span
                        className={`min-w-0 flex-1 truncate text-[13px] ${
                          active
                            ? "font-medium text-zinc-800 dark:text-zinc-100"
                            : "text-zinc-600 dark:text-zinc-300"
                        }`}
                      >
                        {c.title || "新对话"}
                      </span>
                      <span className="shrink-0 rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[11px] tabular-nums text-zinc-400 dark:bg-white/[0.08]">
                        {c.message_count}
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        onDeleteConversation(c.id);
                        setConvMenuOpen(false);
                      }}
                      className="shrink-0 rounded-md p-1.5 text-zinc-300 opacity-0 transition-opacity hover:bg-black/[0.05] hover:text-red-500 group-hover:opacity-100 dark:hover:bg-white/[0.1]"
                      title="Delete conversation"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                );
              })}
              <button
                onClick={() => {
                  onNewConversation();
                  setConvMenuOpen(false);
                }}
                className="mt-1 flex w-full items-center gap-2 border-t border-black/[0.05] px-3 py-2.5 text-left text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-[#32383e]"
              >
                <Plus className="h-4 w-4" strokeWidth={2} />
                New conversation
              </button>
            </div>
          )}
        </div>
        <div className="relative" data-chat-menu>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            title="Menu"
          >
            <MoreVertical className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-40 mt-1.5 w-44 rounded-xl border border-black/[0.08] bg-white py-1 shadow-xl dark:border-white/10 dark:bg-[#22262b]">
              <button
                onClick={() => {
                  onClear();
                  setMenuOpen(false);
                }}
                disabled={!canClear}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-300 dark:hover:bg-[#32383e] dark:disabled:hover:bg-transparent"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} />
                Clear chat
              </button>
              <button
                onClick={() => {
                  exportConversation();
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-zinc-600 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-[#32383e]"
              >
                <Download className="h-4 w-4" strokeWidth={2} />
                Export .md
              </button>
              <button
                onClick={() => {
                  setSettingsOpen(true);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-zinc-600 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-[#32383e]"
              >
                <Settings className="h-4 w-4" strokeWidth={2} />
                Settings
              </button>
            </div>
          )}
        </div>
      </div>

      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          onSaved={(msg) => {
            setNotice(msg);
            setTimeout(() => setNotice(null), 3000);
          }}
        />
      )}
      {notice && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-xs text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {notice}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto pt-3 md:pt-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 pb-6 md:gap-4 md:pb-8">
          {messages.length === 0 && (
            <div className="mt-24 flex flex-col items-center gap-4 text-center">
              <div className="animate-rise" style={{ animationDelay: "120ms" }}>
                <h2 className="text-lg font-semibold tracking-tight text-zinc-700 dark:text-zinc-100">
                  Ask your documents anything
                </h2>
                <p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-zinc-400">
                  After you upload Markdown / PDF files, answers are generated from
                  your documents with cited sources
                </p>
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div
                key={m.id}
                className="animate-rise self-end max-w-[82%] rounded-[20px] rounded-br-md bg-[#edeffa] px-4 py-2.5 text-[15px] leading-relaxed text-zinc-800 dark:bg-[#1a1d22] dark:text-zinc-100"
              >
                {m.content}
              </div>
            ) : (
              <AssistantCard
                key={m.id}
                m={m}
                onCite={onCite}
                onSend={onSend}
                onRetry={() => {
                  const lastUser = [...messages.slice(0, i)].reverse().find((x) => x.role === "user");
                  onSend(lastUser ? lastUser.content : m.content);
                }}
                onSaveToNote={onSaveToNote}
              />
            )
          )}
        </div>
      </div>

      <div className="shrink-0 px-5 pb-3 pt-1">
        <div className="mx-auto flex w-full max-w-5xl items-end gap-2">
          <div className="flex min-h-11 flex-1 items-center rounded-full border border-black/[0.06] bg-zinc-100/70 px-5 transition-all focus-within:border-zinc-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-zinc-200/50 dark:border-white/10 dark:bg-zinc-800/50 dark:focus-within:bg-zinc-900 dark:focus-within:ring-zinc-700/30">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="Ask your documents…"
              className="max-h-40 w-full resize-none bg-transparent py-2.5 text-[15px] leading-6 outline-none placeholder:text-zinc-400"
            />
          </div>
          {loading ? (
            <button
              onClick={onStop}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#db372d] text-white transition-colors hover:bg-[#c53026] active:scale-95"
              title="Stop"
            >
              <Square className="h-3.5 w-3.5 fill-current" strokeWidth={2} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!input.trim()}
              className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#4259ff] text-white shadow-[0_6px_16px_-4px_var(--shadow-btn)] transition-all hover:bg-[#3d54ea] active:scale-95 disabled:bg-[#ebebeb] disabled:text-zinc-500 disabled:shadow-none disabled:hover:bg-[#ebebeb] dark:disabled:bg-[#33373b] dark:disabled:text-white dark:disabled:hover:bg-[#33373b]"
              title="Send"
            >
              <SendHorizontal className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </main>
  );
}