"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Copy,
  FileText,
  List,
  ListChecks,
  Loader2,
  PanelRight,
  PenLine,
  Save,
  Square,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { chatStream, createNote, deleteNote, listNotes, listStudies, syncStudies, updateNote } from "../lib/api";

type Tool = {
  label: string;
  prompt: string;
  icon: typeof Zap;
  color: string;
};

const TOOLS: Tool[] = [
  {
    label: "Fast Track",
    prompt: "Give me a crash course on this subject, section by section",
    icon: Zap,
    color: "#edeffa",
  },
  {
    label: "Key Points",
    prompt: "Highlight the key points of this course for me",
    icon: ListChecks,
    color: "#f2f2e8",
  },
  {
    label: "Mind Map",
    prompt: "思维导图",
    icon: Brain,
    color: "#e8f0fe",
  },
  {
    label: "Quiz",
    prompt: "选择题",
    icon: CircleCheck,
    color: "#e1f5e4",
  },
  {
    label: "Chapters",
    prompt: "List the chapter structure of this book",
    icon: List,
    color: "#f0e9ef",
  },
];

const NOTE_COLOR = "#f6f0e2";

/* ── Output type ──────────────────────────────────────────────────── */

type MindMapNode = { label: string; children?: MindMapNode[] };
type QuizQuestion = { q: string; opts: string[]; ans: number; explain: string };

type Output = {
  id: string;
  label: string;
  icon: typeof Zap;
  color: string;
  status: "running" | "done" | "error";
  expanded: boolean;
  content: string;
  error?: string;
  structured?: MindMapNode | QuizQuestion[] | null;
  ts: number;
};

type Note = {
  id: string;
  doc_id: string;
  content: string;
  created_at: number;
  updated_at: number;
};

type Props = {
  width: number;
  conversationIds: ReadonlySet<string>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  hasDoc: boolean;
  docId?: string | null;
  convId?: string | null;
};

function toCiteMarkdown(content: string): string {
  return content.replace(
    /\[source:(\d+)\]/g,
    (_m, idx: string) => `[${Number(idx) + 1}]`
  );
}

function OutputMarkdown({ content }: { content: string }) {
  return (
    <div
      className="prose prose-sm max-w-none dark:prose-invert
      prose-headings:mb-2 prose-headings:mt-5 prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-zinc-900
      prose-h1:text-[18px] prose-h2:text-[16px] prose-h3:text-[15px] prose-h4:text-[14px]
      prose-p:my-2.5 prose-p:text-[14px] prose-p:leading-7 prose-p:text-zinc-700
      prose-li:my-1 prose-li:leading-7 prose-li:text-zinc-700
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
      dark:prose-hr:border-white/10 dark:prose-th:text-zinc-200"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {toCiteMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}

/* ── Mind Map ─────────────────────────────────────────────────────── */

function MindMapTree({ node, depth = 0 }: { node: MindMapNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-0.5 text-[13px] text-zinc-700 dark:text-zinc-300"
        style={{ paddingLeft: depth * 16 }}
      >
        {hasChildren ? (
          <button
            onClick={() => setOpen(!open)}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
          >
            <ChevronDown
              className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`}
              strokeWidth={2}
            />
          </button>
        ) : (
          <span className="inline-block h-4 w-4 shrink-0" />
        )}
        <span
          className={`min-w-0 ${depth === 0 ? "text-[14px] font-semibold text-zinc-900 dark:text-zinc-50" : depth === 1 ? "font-medium text-zinc-800 dark:text-zinc-200" : ""}`}
        >
          {node.label}
        </span>
      </div>
      {open &&
        hasChildren &&
        node.children!.map((child, i) => (
          <MindMapTree key={`${child.label}-${i}`} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

/* ── Quiz Cards ───────────────────────────────────────────────────── */

function QuizCards({ questions }: { questions: QuizQuestion[] }) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const q = questions[current];
  const total = questions.length;
  const answered = Object.keys(answers).length;
  const correct = Object.entries(answers).filter(
    ([i, a]) => questions[Number(i)].ans === a
  ).length;

  const choose = (idx: number) => {
    if (answers[current] !== undefined) return;
    setAnswers((prev) => ({ ...prev, [current]: idx }));
  };

  if (!q) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[12px] text-zinc-500 dark:text-zinc-400">
        <span>
          {current + 1} / {total}
        </span>
        <span>
          {correct} / {answered} correct
        </span>
      </div>
      <p className="text-[14px] font-medium text-zinc-800 dark:text-zinc-100">
        {q.q}
      </p>
      <div className="flex flex-col gap-1.5">
        {q.opts.map((opt, i) => {
          const chosen = answers[current] === i;
          const isCorrect = i === q.ans;
          const revealed = answers[current] !== undefined;
          let cls =
            "w-full rounded-xl border px-3 py-2.5 text-left text-[13px] transition-all ";
          if (!revealed) {
            cls +=
              "border-black/[0.08] bg-white hover:border-[#0b57d0] hover:bg-[#edeffa] dark:border-white/10 dark:bg-[#2a2d33] dark:hover:border-[#a8c7fa] dark:hover:bg-[#2a3350]";
          } else if (isCorrect) {
            cls += "border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-900/20 dark:text-emerald-200";
          } else if (chosen && !isCorrect) {
            cls += "border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-900/20 dark:text-red-300";
          } else {
            cls += "border-black/[0.05] bg-zinc-50 opacity-60 dark:border-white/5 dark:bg-zinc-800/30";
          }
          return (
            <button key={i} onClick={() => choose(i)} className={cls}>
              {opt}
            </button>
          );
        })}
      </div>
      {answers[current] !== undefined && q.explain && (
        <p className="rounded-lg bg-zinc-50 px-3 py-2 text-[13px] leading-6 text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400">
          {q.explain}
        </p>
      )}
      {answers[current] !== undefined && (
        <div className="flex justify-end">
          <button
            onClick={() => setCurrent((c) => Math.min(c + 1, total - 1))}
            disabled={current >= total - 1}
            className="rounded-xl border border-black/[0.08] px-4 py-1.5 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-black/[0.03] disabled:opacity-40 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/[0.06]"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Main Panel ───────────────────────────────────────────────────── */

export function ToolsPanel({
  width,
  conversationIds,
  collapsed,
  onToggleCollapse,
  hasDoc,
  docId,
  convId,
}: Props) {
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [collapsedNotes, setCollapsedNotes] = useState<Set<string>>(new Set());
  const abortRef = useRef<Map<string, AbortController>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const outputsRef = useRef<Output[]>([]);
  outputsRef.current = outputs;

  // load this conversation's studio outputs from the backend
  useEffect(() => {
    if (!convId) {
      setOutputs([]);
      return;
    }
    listStudies(convId)
      .then((list) =>
        setOutputs(
          list.map((s, i) => ({
            id: s.id,
            label: s.label,
            icon: TOOLS.find((t) => t.label === s.label)?.icon ?? Zap,
            color: s.color ?? "#f2f2e8",
            status: "done",
            expanded: true,
            content: (s.content ?? "").trim(),
            structured: (s.structured as Output["structured"]) ?? undefined,
            ts: Date.now() - (list.length - 1 - i) * 1000,
          }))
        )
      )
      .catch(() => {});
  }, [convId]);

  // load this document's notes into the same outputs list
  const loadNotes = useCallback(async () => {
    if (!docId) {
      setNotes([]);
      return;
    }
    try {
      const data = await listNotes(docId);
      setNotes(data);
    } catch {
      /* ignore */
    }
  }, [docId]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // persist finished outputs to the backend (debounced)
  useEffect(() => {
    if (!convId) return;
    const t = window.setTimeout(() => {
      const done = outputsRef.current
        .filter((o) => o.status === "done" && o.content.trim().length > 0)
        .map((o) => ({
          id: o.id,
          label: o.label,
          color: o.color,
          content: o.content,
          structured: o.structured ?? null,
        }));
      syncStudies(convId, done).catch(() => {});
    }, 700);
    return () => window.clearTimeout(t);
  }, [outputs, convId]);

  const items = useMemo(() => {
    return [
      ...outputs.map((o) => ({ kind: "output" as const, o, ts: o.ts })),
      ...notes.map((n) => ({ kind: "note" as const, n, ts: n.updated_at })),
    ].sort((a, b) => b.ts - a.ts);
  }, [outputs, notes]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [outputs.length, notes.length]);

  const runTool = useCallback(
    async (t: Tool) => {
      if (!hasDoc) return;
      if (conversationIds.size !== 1) {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
        setOutputs((prev) => [
          {
            id,
            label: t.label,
            icon: t.icon,
            color: t.color,
            status: "error",
            expanded: true,
            content: "",
            error:
              conversationIds.size === 0
                ? "请先在对话来源里勾选一份文档。"
                : "学习工具一次聚焦一份文档，请先取消勾选其他文档（来源里只留一份）。",
            ts: Date.now(),
          },
          ...prev,
        ]);
        return;
      }
      const ids = Array.from(conversationIds);
      if (ids.length === 0) return;

      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const ctrl = new AbortController();
      abortRef.current.set(id, ctrl);

      let structured: MindMapNode | QuizQuestion[] | null | undefined;

      setOutputs((prev) => [
        {
          id,
          label: t.label,
          icon: t.icon,
          color: t.color,
          status: "running",
          expanded: true,
          content: "",
          ts: Date.now(),
        },
        ...prev,
      ]);

      try {
        await chatStream({
          message: t.prompt,
          history: [],
          doc_id: null,
          doc_ids: ids,
          signal: ctrl.signal,
          onEvent: (ev) => {
            if (ev.type === "delta") {
              setOutputs((prev) =>
                prev.map((o) =>
                  o.id === id ? { ...o, content: o.content + ev.text } : o
                )
              );
            } else if (ev.type === "done") {
              structured = ev.structured as MindMapNode | QuizQuestion[] | null | undefined;
            }
          },
        });
        setOutputs((prev) =>
          prev.map((o) =>
            o.id === id ? { ...o, status: "done", structured: structured ?? o.structured } : o
          )
        );
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setOutputs((prev) =>
            prev.map((o) => (o.id === id ? { ...o, status: "done" } : o))
          );
        } else {
          setOutputs((prev) =>
            prev.map((o) =>
              o.id === id ? { ...o, status: "error", error: "Request failed" } : o
            )
          );
        }
      } finally {
        abortRef.current.delete(id);
      }
    },
    [conversationIds, hasDoc]
  );

  const dismiss = useCallback((id: string) => {
    abortRef.current.get(id)?.abort();
    setOutputs((prev) => prev.filter((o) => o.id !== id));
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setOutputs((prev) =>
      prev.map((o) => (o.id === id ? { ...o, expanded: !o.expanded } : o))
    );
  }, []);

  const toggleNote = useCallback((id: string) => {
    setCollapsedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* ── note actions ───────────────────────────────────────────────── */

  const create = async () => {
    if (!docId) return;
    try {
      const { id } = await createNote(docId, "");
      setEditingId(id);
      setDraft("");
      loadNotes();
    } catch {
      /* ignore */
    }
  };

  const save = async (id: string) => {
    try {
      await updateNote(id, draft);
      setEditingId(null);
      loadNotes();
    } catch {
      /* ignore */
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteNote(id);
      if (editingId === id) setEditingId(null);
      loadNotes();
    } catch {
      /* ignore */
    }
  };

  const saveOutputToNotes = async (content: string) => {
    if (!docId) return;
    try {
      await createNote(docId, content);
      loadNotes();
    } catch {
      /* ignore */
    }
  };

  if (collapsed) {
    return (
      <aside className="mb-view mb-tools flex h-full w-12 shrink-0 flex-col items-center rounded-[20px] bg-[var(--card)] py-3">
        <button
          onClick={onToggleCollapse}
          className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
          title="Expand studio"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="mb-view mb-tools flex h-full shrink-0 flex-col overflow-hidden rounded-[20px] bg-[var(--card)]"
      style={{ width }}
    >
      <div className="mb-head flex h-12 shrink-0 items-center gap-2 border-b border-black/[0.05] px-4 dark:border-white/10">
        <h2 className="text-[15px] text-zinc-800 dark:text-zinc-100">Studio</h2>
        <button
          onClick={onToggleCollapse}
          className="ml-auto rounded-full p-2 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
          title="Collapse studio"
        >
          <PanelRight className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      <div className="shrink-0 px-3 pt-3">
        <div className="grid grid-cols-2 gap-1.5">
          {TOOLS.map((t) => (
            <button
              key={t.label}
              onClick={() => runTool(t)}
              disabled={!hasDoc}
              title={t.prompt}
              style={{ "--tool-bg": t.color } as CSSProperties}
              className={`toolbox group flex items-center gap-2.5 rounded-[14px] px-3 py-4 text-left transition-all disabled:opacity-40 ${hasDoc ? "" : "toolbox-muted"}`}
            >
              <t.icon className="h-4 w-4 shrink-0 text-zinc-700" strokeWidth={2} />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-700">
                {t.label}
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
            </button>
          ))}
          <button
            onClick={create}
            disabled={!docId}
            title="新建笔记（需先勾选一份文档）"
            style={{ "--tool-bg": NOTE_COLOR } as CSSProperties}
            className={`toolbox group flex items-center gap-2.5 rounded-[14px] px-3 py-4 text-left transition-all disabled:opacity-40 ${docId ? "" : "toolbox-muted"}`}
          >
            <PenLine className="h-4 w-4 shrink-0 text-zinc-700" strokeWidth={2} />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-700">
              Note
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="mt-4 border-t border-black/[0.05] pt-3 dark:border-white/10">
          <div className="mb-2.5 flex items-center justify-between px-1">
            <span className="text-[12px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500">
              产出 · Outputs
            </span>
          </div>

          {items.length === 0 ? (
            <div className="px-1 pt-8 text-center">
              <p className="text-xs leading-5 text-zinc-400 dark:text-zinc-500">
                {hasDoc ? "Ready to generate! Pick a tool above." : "Select a document to unlock Studio tools."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {items.map((it) =>
                it.kind === "output" ? (
                  <OutputCard
                    key={it.o.id}
                    o={it.o}
                    docId={docId}
                    onToggle={() => toggleExpand(it.o.id)}
                    onStop={() => abortRef.current.get(it.o.id)?.abort()}
                    onSaveToNotes={saveOutputToNotes}
                    onDismiss={() => dismiss(it.o.id)}
                  />
                ) : (
                  <NoteCard
                    key={it.n.id}
                    n={it.n}
                    expanded={!collapsedNotes.has(it.n.id)}
                    editing={editingId === it.n.id}
                    draft={draft}
                    onToggle={() => toggleNote(it.n.id)}
                    onDraft={setDraft}
                    onStartEdit={() => {
                      setEditingId(it.n.id);
                      setDraft(it.n.content);
                      setCollapsedNotes((prev) => {
                        const next = new Set(prev);
                        next.delete(it.n.id);
                        return next;
                      });
                    }}
                    onCancelEdit={() => setEditingId(null)}
                    onSave={() => save(it.n.id)}
                    onRemove={() => remove(it.n.id)}
                  />
                )
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

/* ── Output card (tool results, same visual language as notes) ───── */

function OutputCard({
  o,
  docId,
  onToggle,
  onStop,
  onSaveToNotes,
  onDismiss,
}: {
  o: Output;
  docId?: string | null;
  onToggle: () => void;
  onStop: () => void;
  onSaveToNotes: (content: string) => void;
  onDismiss: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const isMindMap =
    o.structured &&
    typeof o.structured === "object" &&
    "label" in o.structured &&
    !Array.isArray(o.structured);
  const isQuiz =
    Array.isArray(o.structured) && o.structured.length > 0 && "q" in o.structured[0];

  const handleSave = async () => {
    await onSaveToNotes(o.content);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="animate-rise group overflow-hidden rounded-[14px] border border-black/[0.05] bg-white shadow-sm dark:border-white/10 dark:bg-[#1f2327]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={o.expanded ? "Collapse" : "Expand"}
        >
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: o.color }}
          >
            <o.icon className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-700 dark:text-zinc-200">
            {o.label}
          </span>
          {o.status === "running" && (
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-400">
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
              Generating
            </span>
          )}
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${o.expanded ? "" : "-rotate-90"}`}
            strokeWidth={2}
          />
        </button>
        {o.status === "running" && (
          <button
            onClick={onStop}
            className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            title="Stop"
          >
            <Square className="h-3.5 w-3.5 fill-current" strokeWidth={2} />
          </button>
        )}
        {o.status === "done" && docId && (
          <button
            onClick={handleSave}
            className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            title="保存为笔记"
          >
            {saved ? (
              <CircleCheck className="h-3.5 w-3.5 text-emerald-500" strokeWidth={2} />
            ) : (
              <Save className="h-3.5 w-3.5" strokeWidth={2} />
            )}
          </button>
        )}
        <button
          onClick={onDismiss}
          className="shrink-0 rounded-md p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-black/[0.04] hover:text-zinc-600 group-hover:opacity-100 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
          title="Remove"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      {o.expanded && (
        <div className="border-t border-black/[0.04] px-4 py-3 dark:border-white/5">
          {o.status === "error" ? (
            <p className="text-sm text-red-500">{o.error}</p>
          ) : isMindMap ? (
            <MindMapTree node={o.structured as MindMapNode} />
          ) : isQuiz ? (
            <QuizCards questions={o.structured as QuizQuestion[]} />
          ) : o.content.trim() ? (
            <OutputMarkdown content={o.content} />
          ) : (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">Waiting…</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Note card (same visual language as tool outputs) ─────────────── */

function NoteCard({
  n,
  expanded,
  editing,
  draft,
  onToggle,
  onDraft,
  onStartEdit,
  onCancelEdit,
  onSave,
  onRemove,
}: {
  n: Note;
  expanded: boolean;
  editing: boolean;
  draft: string;
  onToggle: () => void;
  onDraft: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const showBody = expanded || editing;
  return (
    <div className="animate-rise group overflow-hidden rounded-[14px] border border-black/[0.05] bg-white shadow-sm dark:border-white/10 dark:bg-[#1f2327]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={expanded ? "Collapse" : "Expand"}
        >
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: NOTE_COLOR }}
          >
            <PenLine className="h-3.5 w-3.5 text-zinc-600 dark:text-zinc-300" strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-700 dark:text-zinc-200">
            笔记
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${expanded ? "" : "-rotate-90"}`}
            strokeWidth={2}
          />
        </button>
        {!editing && (
          <>
            <button
              onClick={onStartEdit}
              className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
              title="编辑"
            >
              <PenLine className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              onClick={onRemove}
              className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-red-500 dark:hover:bg-white/[0.06]"
              title="删除"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </>
        )}
      </div>
      {showBody && (
        <div className="border-t border-black/[0.04] px-4 py-3 dark:border-white/5">
          {editing ? (
            <>
              <textarea
                value={draft}
                onChange={(e) => onDraft(e.target.value)}
                className="w-full resize-none rounded-lg border border-black/[0.08] bg-[#fbfbfd] px-2.5 py-2 text-[13px] leading-6 text-zinc-800 focus:outline-none focus:ring-1 focus:ring-[#0b57d0] dark:border-white/10 dark:bg-[#1a1d22] dark:text-zinc-200 dark:focus:ring-[#a8c7fa]"
                rows={4}
                autoFocus
                placeholder="写点什么…"
              />
              <div className="mt-1.5 flex justify-end gap-1.5">
                <button
                  onClick={onCancelEdit}
                  className="rounded-lg px-2.5 py-1 text-[12px] text-zinc-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                >
                  Cancel
                </button>
                <button
                  onClick={onSave}
                  className="rounded-lg bg-[#0b57d0] px-3 py-1 text-[12px] font-medium text-white hover:bg-[#0a4fc4] dark:bg-[#a8c7fa] dark:text-[#1a1d22] dark:hover:bg-[#93b8e8]"
                >
                  Save
                </button>
              </div>
            </>
          ) : n.content.trim() ? (
            <OutputMarkdown content={n.content} />
          ) : (
            <p className="italic text-[13px] text-zinc-400 dark:text-zinc-500">
              Empty note
            </p>
          )}
        </div>
      )}
    </div>
  );
}