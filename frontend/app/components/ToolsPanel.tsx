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
import { useI18n } from "../lib/i18n";
import type { Citation } from "../lib/types";

type Tool = {
  label: string;
  op: string;
  prompt: string;
  icon: typeof Zap;
  color: string;
};

const TOOLS: Tool[] = [
  {
    label: "Fast Track",
    op: "study_plan",
    prompt: "Give me a crash course on this subject, section by section",
    icon: Zap,
    color: "#edeffa",
  },
  {
    label: "Key Points",
    op: "key_points",
    prompt: "Highlight the key points of this course for me",
    icon: ListChecks,
    color: "#f2f2e8",
  },
  {
    label: "Mind Map",
    op: "mind_map",
    prompt: "思维导图",
    icon: Brain,
    color: "#e8f0fe",
  },
  {
    label: "Quiz",
    op: "quiz",
    prompt: "选择题",
    icon: CircleCheck,
    color: "#e1f5e4",
  },
  {
    label: "Chapters",
    op: "chapters",
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
  citations?: Citation[];
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
  onCite: (citation: Citation) => void;
  onAskNode?: (label: string) => void;
};

function toCiteMarkdown(content: string): string {
  // 密集编号：[source:N] → [d+1](#cite-d)，d 按首次出现顺序分配，与 citations 密集顺序一致
  const dense = new Map<number, number>();
  return content.replace(/\[source:(\d+)\]/g, (_m, idx: string) => {
    const n = Number(idx);
    let d = dense.get(n);
    if (d === undefined) {
      d = dense.size;
      dense.set(n, d);
    }
    return `[${d + 1}](#cite-${d})`;
  });
}

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

function OutputMarkdown({
  content,
  citations,
  onCite,
}: {
  content: string;
  citations?: Citation[];
  onCite?: (c: Citation) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a: ({ href, children, ...rest }: any) => {
      if (typeof href === "string" && href.startsWith("#cite-")) {
        const n = parseInt(href.slice(6), 10);
        const c = citations?.[n];
        if (c && onCite) {
          return <CitationLink n={n} onCite={() => onCite(c)} />;
        }
        return <span>[{n + 1}]</span>;
      }
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      );
    },
  };
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
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {toCiteMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}

/* ── Mind Map ─────────────────────────────────────────────────────── */

type Markmap = import("markmap-view").Markmap;
type MarkmapINode = import("markmap-common").INode;

function stripTags(html: string): string {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el.textContent?.trim() ?? "";
}

function toMarkmapData(n: MindMapNode, chapter?: string): import("markmap-common").IPureNode {
  const text = n.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const isChapter = /第\s*\d+\s*章/.test(n.label);
  const c = chapter ?? (isChapter ? n.label : undefined);
  return {
    content: text,
    payload: { label: n.label, chapter: c ?? "" },
    children: (n.children ?? []).map((child) => toMarkmapData(child, c)),
  };
}

function MindMapCanvas({
  node,
  onAsk,
  fill = false,
}: {
  node: MindMapNode;
  onAsk?: (label: string) => void;
  fill?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<Markmap | null>(null);
  const onAskRef = useRef(onAsk);
  onAskRef.current = onAsk;

  useEffect(() => {
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    if (!wrap || !svg) return;
    let mm: Markmap | null = null;
    let destroyed = false;

    const data = toMarkmapData(node);
    const mmPromise = import("markmap-view").then(({ Markmap }) => {
      if (destroyed) return null;
      mm = Markmap.create(svg, {
        duration: 400,
        initialExpandLevel: -1,
        maxWidth: 280,
        spacingHorizontal: 70,
        spacingVertical: 10,
        paddingX: 14,
        pan: true,
        zoom: true,
        scrollForPan: false,
        autoFit: true,
      }, data);
      mmRef.current = mm;
      return mm;
    });

    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const g = target?.closest?.("g.markmap-node") as SVGGElement | null;
      if (!g) return;
      const data = (g as unknown as { __data__?: MarkmapINode }).__data__;
      if (!data) return;
      if (data.children && data.children.length) {
        mmRef.current?.toggleNode(data);
      } else {
        const label = data.payload?.label as string | undefined;
        const chapter = data.payload?.chapter as string | undefined;
        const content = label ?? stripTags(data.content);
        if (!content) return;
        const question = chapter && chapter !== content
          ? `详细讲讲"${content}"（${chapter}）`
          : `详细讲讲"${content}"`;
        onAskRef.current?.(question);
      }
    };
    wrap.addEventListener("click", onClick);

    return () => {
      destroyed = true;
      wrap.removeEventListener("click", onClick);
      mmPromise.then((m) => m?.destroy());
      mmRef.current = null;
    };
  }, [node]);

  return (
    <div
      ref={wrapRef}
      className={`relative w-full touch-none select-none overflow-hidden ${
        fill
          ? "h-full"
          : "h-[65vh] min-h-[360px] rounded-xl border border-black/[0.05] bg-white/60 dark:border-white/[0.06] dark:bg-white/[0.02]"
      }`}
    >
      <svg ref={svgRef} className="absolute inset-0 h-full w-full" />
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
  onCite,
  onAskNode,
}: Props) {
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [collapsedNotes, setCollapsedNotes] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<"output" | "note" | null>(null);
  const { t } = useI18n();
  const abortRef = useRef<Map<string, AbortController>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const outputsRef = useRef<Output[]>([]);
  outputsRef.current = outputs;
  const hydratedRef = useRef(false);

  // load this conversation's studio outputs from the backend
  useEffect(() => {
    if (!convId) {
      setOutputs([]);
      hydratedRef.current = false;
      return;
    }
    hydratedRef.current = false;
    listStudies(convId)
      .then((list) => {
        hydratedRef.current = true;
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
            citations: (s.citations ?? []) as Citation[],
            ts: Date.now() - (list.length - 1 - i) * 1000,
          }))
        );
      })
      .catch(() => {
        hydratedRef.current = true;
      });
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
  // 只在 listStudies 水合完成后才允许写回，避免用空数组覆盖数据库（删除竞态）
  useEffect(() => {
    if (!convId || !hydratedRef.current) return;
    const t = window.setTimeout(() => {
      const done = outputsRef.current
        .filter(
          (o) =>
            o.status === "done" &&
            (o.content.trim().length > 0 || o.structured != null)
        )
        .map((o) => ({
          id: o.id,
          label: o.label,
          color: o.color,
          content: o.content,
          structured: o.structured ?? null,
          citations: o.citations ?? [],
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
      let citations: Citation[] | undefined;

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
          op: t.op,
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
              citations = ev.citations;
            }
          },
        });
        setOutputs((prev) =>
          prev.map((o) =>
            o.id === id
              ? { ...o, status: "done", structured: structured ?? o.structured, citations: citations ?? o.citations }
              : o
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
      setActiveId(id);
      setActiveKind("note");
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

  const activeItem = activeId
    ? activeKind === "note"
      ? items.find((it) => it.kind === "note" && it.n.id === activeId)
      : items.find((it) => it.kind === "output" && it.o.id === activeId)
    : null;

  const exitPreview = () => {
    setActiveId(null);
    setActiveKind(null);
  };

  const isFullPreview = !!(
    activeItem &&
    activeItem.kind === "output" &&
    isMindMapOutput(activeItem.o)
  );

  return (
    <aside
      className="mb-view mb-tools flex h-full shrink-0 flex-col overflow-hidden rounded-[20px] bg-[var(--card)]"
      style={{ width }}
    >
      <div className="mb-head flex h-12 shrink-0 items-center gap-2 border-b border-black/[0.05] px-4 dark:border-white/10">
        <h2 className="text-[15px] text-zinc-800 dark:text-zinc-100">{t("ui.studio")}</h2>
        {activeItem ? (
          <button
            onClick={exitPreview}
            className="ml-auto rounded-full p-2 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            title="Back to outputs"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2} />
          </button>
        ) : (
          <button
            onClick={onToggleCollapse}
            className="ml-auto rounded-full p-2 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            title="Collapse studio"
          >
            <PanelRight className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>

      {activeItem ? (
        /* ── preview view: full-height single item ── */
        <div className={`min-h-0 flex-1 ${isFullPreview ? "overflow-hidden" : "overflow-y-auto"}`}>
{activeItem.kind === "note" ? (
          <div className="flex h-full flex-col p-4">
            <NoteDetail
              n={activeItem.n}
              editing={editingId === activeItem.n.id}
              draft={draft}
              onDraft={setDraft}
              onStartEdit={() => {
                setEditingId(activeItem.n.id);
                setDraft(activeItem.n.content);
              }}
              onCancelEdit={() => setEditingId(null)}
              onSave={() => save(activeItem.n.id)}
              onRemove={() => {
                remove(activeItem.n.id);
                exitPreview();
              }}
            />
          </div>
        ) : isMindMapOutput(activeItem.o) || isQuizOutput(activeItem.o) ? (
          <div className="h-full">
            <OutputBody
              o={activeItem.o}
              onCite={onCite}
              onAskNode={onAskNode}
              fill
            />
          </div>
        ) : (
          <OutputDetail
            o={activeItem.o}
            docId={docId}
            onStop={() => abortRef.current.get(activeItem.o.id)?.abort()}
            onSaveToNotes={saveOutputToNotes}
            onDismiss={() => {
              dismiss(activeItem.o.id);
              exitPreview();
            }}
            onCite={onCite}
            onAskNode={onAskNode}
          />
        )}
        </div>
      ) : (
        <>
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
            title={t("note.newHint")}
            style={{ "--tool-bg": NOTE_COLOR } as CSSProperties}
            className={`toolbox group flex items-center gap-2.5 rounded-[14px] px-3 py-4 text-left transition-all disabled:opacity-40 ${docId ? "" : "toolbox-muted"}`}
          >
            <PenLine className="h-4 w-4 shrink-0 text-zinc-700" strokeWidth={2} />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-700">
              {t("ui.note")}
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="mt-4 border-t border-black/[0.05] pt-3 dark:border-white/10">
          <div className="mb-2.5 flex items-center justify-between px-1">
            <span className="text-[12px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500">
              {t("ui.outputs")}
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
                    onOpen={() => {
                      setActiveId(it.o.id);
                      setActiveKind("output");
                    }}
                    onStop={() => abortRef.current.get(it.o.id)?.abort()}
                    onSaveToNotes={saveOutputToNotes}
                    onDismiss={() => dismiss(it.o.id)}
                    onCite={onCite}
                    onAskNode={onAskNode}
                  />
                ) : (
                  <NoteCard
                    key={it.n.id}
                    n={it.n}
                    expanded={editingId === it.n.id}
                    editing={editingId === it.n.id}
                    draft={draft}
                    onToggle={() => toggleNote(it.n.id)}
                    onOpen={() => {
                      setActiveId(it.n.id);
                      setActiveKind("note");
                    }}
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
        </>
      )}
    </aside>
  );
}

/* ── Output body (shared between card and full preview) ──────────── */

function isMindMapOutput(o: Output): boolean {
  return !!(
    o.structured &&
    typeof o.structured === "object" &&
    "label" in o.structured &&
    !Array.isArray(o.structured)
  );
}

function isQuizOutput(o: Output): boolean {
  return (
    Array.isArray(o.structured) &&
    o.structured.length > 0 &&
    typeof o.structured[0] === "object" &&
    o.structured[0] !== null &&
    "q" in o.structured[0]
  );
}

function OutputBody({
  o,
  onCite,
  onAskNode,
  fill = false,
}: {
  o: Output;
  onCite: (c: Citation) => void;
  onAskNode?: (label: string) => void;
  fill?: boolean;
}) {
  const isMindMap = isMindMapOutput(o);
  const isQuiz = isQuizOutput(o);

  if (o.status === "error") return <p className="text-sm text-red-500">{o.error}</p>;
  if (isMindMap)
    return (
      <MindMapCanvas
        node={o.structured as MindMapNode}
        onAsk={onAskNode}
        fill={fill}
      />
    );
  if (isQuiz) return <QuizCards questions={o.structured as QuizQuestion[]} />;
  if (o.content.trim()) {
    return <OutputMarkdown content={o.content} citations={o.citations} onCite={onCite} />;
  }
  if (o.status === "running") {
    return (
      <p className="flex items-center gap-2 text-[13px] text-zinc-400 dark:text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        Generating…
      </p>
    );
  }
  return <p className="text-sm text-zinc-400 dark:text-zinc-500">Waiting…</p>;
}

/* ── Output card (tool results, same visual language as notes) ───── */

function OutputCard({
  o,
  docId,
  onToggle,
  onOpen,
  onStop,
  onSaveToNotes,
  onDismiss,
  onCite,
  onAskNode,
}: {
  o: Output;
  docId?: string | null;
  onToggle: () => void;
  onOpen: () => void;
  onStop: () => void;
  onSaveToNotes: (content: string) => void;
  onDismiss: () => void;
  onCite: (c: Citation) => void;
  onAskNode?: (label: string) => void;
}) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await onSaveToNotes(o.content);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // running 态直接内联展开（无需进预览），done/error 点击进预览
  const inline = o.status === "running";
  const isMindMap =
    o.structured &&
    typeof o.structured === "object" &&
    "label" in o.structured &&
    !Array.isArray(o.structured);

  return (
    <div className="animate-rise group overflow-hidden rounded-[14px] border border-black/[0.05] bg-white shadow-sm dark:border-white/10 dark:bg-[#1f2327]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={inline ? onToggle : onOpen}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={inline ? o.expanded ? t("ui.collapse") : t("ui.expand") : t("ui.openPreview")}
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
              {t("chat.thinking")}
            </span>
          )}
          {!inline && (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" strokeWidth={2} />
          )}
          {inline && (
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${o.expanded ? "" : "-rotate-90"}`}
              strokeWidth={2}
            />
          )}
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
            title={t("note.save")}
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
      {inline && o.expanded && (
        <div className="border-t border-black/[0.04] px-4 py-3 dark:border-white/5">
          <OutputBody o={o} onCite={onCite} onAskNode={onAskNode} />
        </div>
      )}
      {o.status === "error" && (
        <div className="border-t border-black/[0.04] px-4 py-3 dark:border-white/5">
          <p className="text-sm text-red-500">{o.error}</p>
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
  onOpen,
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
  onOpen: () => void;
  onDraft: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const showBody = expanded || editing;
  return (
    <div className="animate-rise group overflow-hidden rounded-[14px] border border-black/[0.05] bg-white shadow-sm dark:border-white/10 dark:bg-[#1f2327]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={editing ? onToggle : onOpen}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title="Open preview"
        >
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: NOTE_COLOR }}
          >
            <PenLine className="h-3.5 w-3.5 text-zinc-600 dark:text-zinc-300" strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-700 dark:text-zinc-200">
            {t("note.title")}
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" strokeWidth={2} />
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
                placeholder={t("note.placeholder")}
              />
              <div className="mt-1.5 flex justify-end gap-1.5">
                <button
                  onClick={onCancelEdit}
                  className="rounded-lg px-2.5 py-1 text-[12px] text-zinc-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                >
                  {t("ui.cancel")}
                </button>
                <button
                  onClick={onSave}
                  className="rounded-lg bg-[#0b57d0] px-3 py-1 text-[12px] font-medium text-white hover:bg-[#0a4fc4] dark:bg-[#a8c7fa] dark:text-[#1a1d22] dark:hover:bg-[#93b8e8]"
                >
                  {t("ui.save")}
                </button>
              </div>
            </>
          ) : n.content.trim() ? (
            <OutputMarkdown content={n.content} />
          ) : (
            <p className="italic text-[13px] text-zinc-400 dark:text-zinc-500">
              {t("note.empty")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Full-height preview (list → preview, like sources panel) ─────── */

function OutputDetail({
  o,
  docId,
  onStop,
  onSaveToNotes,
  onDismiss,
  onCite,
  onAskNode,
}: {
  o: Output;
  docId?: string | null;
  onStop: () => void;
  onSaveToNotes: (content: string) => void;
  onDismiss: () => void;
  onCite: (c: Citation) => void;
  onAskNode?: (label: string) => void;
}) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);
  const handleSave = async () => {
    await onSaveToNotes(o.content);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: o.color }}
        >
          <o.icon className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">
            {o.label}
          </p>
          {o.status === "running" && (
            <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
              Generating
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {o.status === "running" && (
            <button
              onClick={onStop}
              className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
              title="Stop"
            >
              <Square className="h-4 w-4 fill-current" strokeWidth={2} />
            </button>
          )}
          {o.status === "done" && docId && (
            <button
              onClick={handleSave}
              className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
              title={t("note.save")}
            >
              {saved ? (
                <CircleCheck className="h-4 w-4 text-emerald-500" strokeWidth={2} />
              ) : (
                <Save className="h-4 w-4" strokeWidth={2} />
              )}
            </button>
          )}
          <button
            onClick={onDismiss}
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
title={t("ui.delete")}
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="border-t border-black/[0.05] pt-4 dark:border-white/10">
        <OutputBody o={o} onCite={onCite} onAskNode={onAskNode} />
      </div>
    </div>
  );
}

function NoteDetail({
  n,
  editing,
  draft,
  onDraft,
  onStartEdit,
  onCancelEdit,
  onSave,
  onRemove,
}: {
  n: Note;
  editing: boolean;
  draft: string;
  onDraft: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: NOTE_COLOR }}
        >
          <PenLine className="h-5 w-5 text-zinc-600 dark:text-zinc-300" strokeWidth={2} />
        </span>
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-zinc-800 dark:text-zinc-100">
          {t("note.title")}
        </p>
        <div className="flex shrink-0 items-center gap-0.5">
          {!editing && (
            <button
              onClick={onStartEdit}
              className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
              title="编辑"
            >
              <PenLine className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
          <button
            onClick={onRemove}
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-red-500 dark:hover:bg-white/[0.06]"
            title="删除"
          >
            <Trash2 className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="border-t border-black/[0.05] pt-4 dark:border-white/10">
        {editing ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
              className="w-full resize-y rounded-lg border border-black/[0.08] bg-[#fbfbfd] px-3 py-2.5 text-[13px] leading-6 text-zinc-800 focus:outline-none focus:ring-1 focus:ring-[#0b57d0] dark:border-white/10 dark:bg-[#1a1d22] dark:text-zinc-200 dark:focus:ring-[#a8c7fa]"
              rows={10}
              autoFocus
              placeholder={t("note.placeholder")}
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <button
                onClick={onCancelEdit}
                className="rounded-lg px-3 py-1.5 text-[12px] text-zinc-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
              >
                Cancel
              </button>
              <button
                onClick={onSave}
                className="rounded-lg bg-[#0b57d0] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#0a4fc4] dark:bg-[#a8c7fa] dark:text-[#1a1d22] dark:hover:bg-[#93b8e8]"
              >
                Save
              </button>
            </div>
          </>
        ) : n.content.trim() ? (
          <OutputMarkdown content={n.content} />
        ) : (
          <p className="italic text-[13px] text-zinc-400 dark:text-zinc-500">{t("note.empty")}</p>
        )}
      </div>
    </div>
  );
}