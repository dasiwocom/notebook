"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  ArrowUpDown,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  Loader2,
  Minimize2,
  Minus,
  NotebookText,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Type,
  X,
} from "lucide-react";
import type { DocumentDetail, DocumentInfo } from "../lib/types";

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/gm;
const FENCE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;

function buildOutline(content: string): { level: number; text: string }[] {
  const list: { level: number; text: string }[] = [];
  const withoutFences = content.replace(FENCE_RE, "");
  HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADING_RE.exec(withoutFences)) !== null) {
    list.push({ level: m[1].length, text: m[2].replace(/[*`]/g, "").trim() });
  }
  return list;
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

function PreviewMarkdown({
  content,
  flashIdx,
}: {
  content: string;
  flashIdx: number;
}) {
  let n = 0;
  const components: Record<string, (props: any) => ReactNode> = {};
  for (const tag of HEADING_TAGS) {
    components[tag] = ({ children, ...rest }) => {
      const id = `bs-sec-${n++}`;
      const idx = parseInt(id.slice(7), 10);
      const El: any = tag;
      return (
        <El
          id={id}
          className={`scroll-mt-5 transition-colors ${
            flashIdx === idx
              ? "rounded-lg -mx-1 bg-amber-100/80 px-1 dark:bg-amber-900/40"
              : ""
          }`}
          {...rest}
        >
          {children}
        </El>
      );
    };
  }
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}

export type HighlightReq = {
  section: string;
  nonce: number;
  doc_id?: string;
  query?: string;
  snippet?: string;
};

const isPdfName = (name: string) => name.toLowerCase().endsWith(".pdf");

function pageImageUrl(docId: string, n: number) {
  return `http://${apiHost()}:8000/api/documents/${docId}/pages/${n}`;
}
function pageMetaUrl(docId: string) {
  return `http://${apiHost()}:8000/api/documents/${docId}/pages`;
}
function pageHighlightUrl(docId: string, n: number) {
  return `http://${apiHost()}:8000/api/documents/${docId}/pages/${n}/highlights`;
}
function apiHost() {
  return globalThis.location?.hostname ?? "localhost";
}

type SortKey = "recent" | "name" | "char";

const SORT_OPTIONS: { key: SortKey; label: string; icon: typeof Clock3 }[] = [
  { key: "recent", label: "Recent", icon: Clock3 },
  { key: "name", label: "Name", icon: Type },
  { key: "char", label: "Characters", icon: FileText },
];

export function DocumentPanel({
  documents,
  doc,
  highlight,
  selectedId,
  conversationIds,
  uploading,
  uploadPct,
  width,
  collapsed,
  onOpen,
  onBack,
  onToggleCollapse,
  onToggleConversation,
  onToggleAllConversation,
  onUpload,
  onDelete,
  onReindexed,
}: {
  documents: DocumentInfo[];
  doc: DocumentDetail | null;
  highlight: HighlightReq | null;
  selectedId: string | null;
  conversationIds: ReadonlySet<string>;
  uploading: boolean;
  uploadPct: number;
  width: number;
  collapsed: boolean;
  onOpen: (id: string) => void;
  onBack: () => void;
  onToggleCollapse: () => void;
  onToggleConversation: (id: string) => void;
  onToggleAllConversation: () => void;
  onUpload: (files: File[]) => void;
  onDelete: (id: string) => void;
  onReindexed?: () => void;
}) {
  /* ── preview state ── */
  const [active, setActive] = useState<number>(-1);
  const [flashIdx, setFlashIdx] = useState<number>(-1);
  const [pageCount, setPageCount] = useState<number>(0);
  const [flashPage, setFlashPage] = useState<number>(-1);
  const [hl, setHl] = useState<{
    page: number;
    rects: { x: number; y: number; w: number; h: number }[];
  } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  /* ── list state ── */
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [filter, setFilter] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const showList = !doc;

  const outline = useMemo(() => (doc ? buildOutline(doc.content) : []), [doc]);
  const isPdf = useMemo(
    () => (doc ? isPdfName(doc.name) : false),
    [doc?.id, doc?.name]
  );

  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let arr = documents;
    if (q) arr = arr.filter((d) => d.name.toLowerCase().includes(q));
    return [...arr].sort((a, b) => {
      if (sortBy === "recent") return b.created_at - a.created_at;
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return b.char_count - a.char_count;
    });
  }, [documents, filter, sortBy]);

  const allSelected =
    documents.length > 0 && documents.every((d) => conversationIds.has(d.id));
  const someSelected =
    !allSelected && documents.some((d) => conversationIds.has(d.id));

  /* ── preview effects ── */

  useEffect(() => {
    if (!isPdf || !doc || doc.status !== "ready") {
      setPageCount(0);
      return;
    }
    let live = true;
    fetch(pageMetaUrl(doc.id))
      .then((r) => r.json())
      .then((d) => {
        if (live) setPageCount(Number(d.count) || 0);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [isPdf, doc?.id, doc?.status]);

  // scroll-spy
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !doc) return;
    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const heads = Array.from(
          el.querySelectorAll("h1, h2, h3, h4, h5, h6")
        ) as HTMLElement[];
        const cutoff = el.scrollTop + 88;
        let current = -1;
        for (let i = 0; i < heads.length; i++) {
          if (el.offsetTop + heads[i].offsetTop <= cutoff) current = i;
          else break;
        }
        setActive(current);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, [doc]);

  // jump & flash from citation click
  useEffect(() => {
    if (!highlight || !doc) return;
    if (highlight.doc_id && highlight.doc_id !== doc.id) return;
    const leaf = highlight.section.split(">").pop()?.trim();
    const el = contentRef.current;
    if (!el || !leaf) return;
    const heads = Array.from(
      el.querySelectorAll("h1, h2, h3, h4, h5, h6")
    ) as HTMLElement[];
    let idx = heads.findIndex((h) => {
      const t = (h.textContent || "").trim();
      return t === leaf || t.startsWith(leaf) || leaf.startsWith(t);
    });
    if (idx < 0) idx = 0;
    const target = heads[idx];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(idx);
    setFlashIdx(idx);
    const timer = window.setTimeout(() => setFlashIdx(-1), 2600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, doc?.id]);

  // PDF: citation -> page image jump & flash + text highlight overlay
  useEffect(() => {
    if (!isPdf || !highlight || !doc || pageCount === 0) return;
    const m = highlight.section.match(/第\s*(\d+)\s*页/);
    if (!m) return;
    const pg = parseInt(m[1], 10);
    if (pg < 1 || pg > pageCount) return;
    if (highlight.doc_id && highlight.doc_id !== doc.id) return;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`bs-page-${pg}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        setFlashPage(pg);
      }
    });
    const timer = window.setTimeout(() => setFlashPage(-1), 2600);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [highlight, doc?.id, isPdf, pageCount]);

  // fetch highlight regions and overlay them on the page image
  useEffect(() => {
    if (!isPdf || !highlight || !doc || pageCount === 0) return;
    const m = highlight.section.match(/第\s*(\d+)\s*页/);
    if (!m) return;
    const pg = parseInt(m[1], 10);
    if (pg < 1 || pg > pageCount) return;
    if (highlight.doc_id && highlight.doc_id !== doc.id) return;
    const query = highlight.query ?? "";
    const snippet = highlight.snippet ?? "";
    if (!query && !snippet) return;
    let live = true;
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (snippet) params.set("snippet", snippet);
    fetch(`${pageHighlightUrl(doc.id, pg)}?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        const rects = Array.isArray(d.highlights) ? d.highlights : [];
        if (rects.length > 0) setHl({ page: pg, rects });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, doc?.id, isPdf, pageCount]);

  /* ── sort close on outside click ── */
  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node))
        setSortOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sortOpen]);

  const retry = useCallback(async () => {
    if (!doc || retrying) return;
    setRetrying(true);
    try {
      await fetch(
        `http://${apiHost()}:8000/api/documents/${doc.id}/reindex`,
        { method: "POST" }
      );
      onReindexed?.();
    } catch {
      /* ignore */
    } finally {
      setRetrying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, retrying, onReindexed]);

  /* ── collapsed rail ── */
  if (collapsed) {
    return (
      <aside className="mb-view mb-doc hidden h-full w-12 shrink-0 flex-col items-center rounded-[20px] bg-[var(--card)] py-3 dark:bg-[#1f2327] min-[1200px]:flex">
        <button
          onClick={onToggleCollapse}
          className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
          title="Expand sources"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2} />
        </button>
      </aside>
    );
  }

  /* ── empty list ── */
  const listEmpty = sorted.length === 0;

  return (
    <aside
      className="mb-view mb-doc relative hidden h-full shrink-0 flex-col overflow-hidden rounded-[20px] bg-[var(--card)] dark:bg-[#1f2327] min-[1200px]:flex"
      style={{ width }}
    >
      {/* ── top bar ── */}
      <div className="mb-head flex h-12 shrink-0 items-center gap-2 border-b border-black/[0.05] px-4 dark:border-white/10">
        <h2 className="text-[15px] text-zinc-800 dark:text-zinc-100">
          Sources
        </h2>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {documents.length}
        </span>
        <button
          onClick={showList ? onToggleCollapse : onBack}
          className="ml-auto rounded-full p-2 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
          title={showList ? "Collapse sources" : "Back to documents"}
        >
          <Minimize2 className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      {/* ── list view ── */}
      {showList && (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* upload */}
          <div className="shrink-0 px-4 pt-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-black/[0.07] px-4 py-2 text-[13px] font-medium text-zinc-700 transition-all hover:bg-black/[0.04] hover:text-zinc-800 active:scale-[0.98] disabled:opacity-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100"
            >
              <Plus className="h-4 w-4" strokeWidth={2.2} />
              {uploading ? "Uploading…" : "Upload document"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.pdf,text/markdown,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) onUpload(files);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => setPasting((v) => !v)}
              disabled={uploading}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-black/[0.07] px-4 py-1.5 text-[12px] font-medium text-zinc-500 transition-all hover:bg-black/[0.04] hover:text-zinc-700 disabled:opacity-50 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            >
              <FileText className="h-3.5 w-3.5" strokeWidth={2} />
              Paste text
            </button>
            {pasting && (
              <div className="mt-2 space-y-2">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder="Paste Markdown / plain text…"
                  className="w-full resize-none rounded-xl border border-black/[0.08] bg-[#fbfbfd] px-3 py-2 text-[13px] leading-6 text-zinc-800 outline-none focus:ring-1 focus:ring-[#0b57d0] dark:border-white/10 dark:bg-[#1a1d22] dark:text-zinc-200 dark:focus:ring-[#a8c7fa]"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={() => {
                      setPasting(false);
                      setPasteText("");
                    }}
                    className="rounded-lg px-2.5 py-1 text-[12px] text-zinc-500 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      const text = pasteText.trim();
                      if (!text) return;
                      const name = `Pasted ${new Date().toISOString().slice(5, 16).replace("T", " ")}.md`;
                      const file = new File([text], name, { type: "text/markdown" });
                      onUpload([file]);
                      setPasteText("");
                      setPasting(false);
                    }}
                    disabled={!pasteText.trim()}
                    className="rounded-lg bg-[#0b57d0] px-3 py-1 text-[12px] font-medium text-white hover:bg-[#0a4fc4] disabled:opacity-40 dark:bg-[#a8c7fa] dark:text-[#1a1d22] dark:hover:bg-[#93b8e8]"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
            {uploading && (
              <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-zinc-400 transition-all duration-300"
                  style={{ width: `${Math.max(uploadPct, 4)}%` }}
                />
              </div>
            )}
          </div>

          {/* search */}
          <div className="shrink-0 px-4 pt-3">
            <div className="flex items-center gap-2 rounded-full border border-black/[0.06] bg-[#f9f9f9] px-3.5 py-1.5 dark:border-white/10 dark:bg-[#1a1d22]">
              <Search className="h-4 w-4 shrink-0 text-zinc-400" strokeWidth={2} />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search documents…"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-200"
              />
              {filter && (
                <button
                  onClick={() => setFilter("")}
                  className="shrink-0 rounded-full p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              )}
            </div>
          </div>

          {/* sort + select-all */}
          <div className="flex items-center gap-2 px-4 pb-1 pt-2.5">
            <div className="relative" ref={sortRef}>
              <button
                onClick={() => setSortOpen((o) => !o)}
                title="Sort"
                className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-black/[0.04] hover:text-zinc-600 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
              >
                <ArrowUpDown className="h-4 w-4" strokeWidth={2} />
              </button>
              {sortOpen && (
                <div className="absolute left-0 z-30 mt-2 w-40 rounded-xl border border-black/[0.08] bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#22262b]">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => {
                        setSortBy(opt.key);
                        setSortOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                        sortBy === opt.key
                          ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-[#32343e] dark:text-zinc-100"
                          : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-[#32383e]"
                      }`}
                    >
                      <opt.icon className="h-4 w-4" strokeWidth={2} />
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={onToggleAllConversation}
              className="ml-auto flex items-center gap-1.5 rounded-full pe-1 py-1 text-[12px] font-medium text-zinc-400 transition-colors hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200"
            >
              <span>Select all</span>
              <span
                className={`flex h-[18px] w-[18px] items-center justify-center border-2 transition-all ${
                  allSelected
                    ? "border-[#0b57d0] bg-[#0b57d0] text-white dark:border-[#a8c7fa] dark:bg-[#a8c7fa] dark:text-[#1a1d22]"
                    : someSelected
                      ? "border-[#0b57d0] bg-[#d7e3fc] text-[#0b57d0] dark:border-[#a8c7fa] dark:bg-[#2a3350] dark:text-[#a8c7fa]"
                      : "border-zinc-300 text-transparent hover:border-zinc-400 dark:border-zinc-600"
                }`}
              >
                {allSelected ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : someSelected ? (
                  <Minus className="h-3 w-3" strokeWidth={3} />
                ) : null}
              </span>
            </button>
          </div>

          {/* doc list */}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {listEmpty && (
              <div className="mt-6 flex flex-col items-center gap-2 px-4 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-[#32343e] dark:text-zinc-400">
                  <NotebookText className="h-5 w-5" strokeWidth={2} />
                </div>
                <p className="text-sm leading-6 text-zinc-400 dark:text-zinc-500">
                  Upload a .md / PDF
                  <br />
                  to start asking
                </p>
              </div>
            )}
            <ul className="space-y-0.5">
              {sorted.map((d) => {
                const isActive = d.id === selectedId;
                return (
                  <li
                    key={d.id}
                    onClick={() => onOpen(d.id)}
                    className={`group flex cursor-pointer items-center gap-2.5 rounded-[14px] px-3 py-2.5 transition-all ${
                      isActive
                        ? "bg-[#dde1eb] ring-1 ring-black/[0.05] dark:bg-[#37383b] dark:ring-white/10"
                        : "hover:bg-[#edeffa] dark:hover:bg-[#1a1d22]"
                    }`}
                  >
                    <NotebookText
                      className={`h-4 w-4 shrink-0 ${
                        isActive
                          ? "text-zinc-600 dark:text-zinc-300"
                          : "text-zinc-400 dark:text-zinc-500"
                      }`}
                      strokeWidth={2}
                    />
                    {d.status === "processing" && (
                      <Loader2
                        className="h-4 w-4 shrink-0 animate-spin text-amber-500"
                        strokeWidth={2}
                      />
                    )}
                    <p
                      className={`min-w-0 flex-1 truncate text-sm font-medium ${
                        isActive
                          ? "text-zinc-900 dark:text-zinc-100"
                          : "text-zinc-800 dark:text-zinc-100"
                      }`}
                    >
                      {d.name}
                    </p>
                    {d.status !== "processing" && (
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          d.status === "error"
                            ? "bg-red-400 dark:bg-red-500"
                            : d.indexed_chunks < d.chunk_count
                              ? "bg-amber-400"
                              : "bg-emerald-400"
                        }`}
                        title={
                          d.status === "error"
                            ? "Failed"
                            : d.indexed_chunks < d.chunk_count
                              ? "Indexing"
                              : "Indexed"
                        }
                      />
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(d.id);
                      }}
                      className="shrink-0 rounded-full p-1.5 text-zinc-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-[#3a3139] dark:hover:text-red-400"
                      title="Delete document"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleConversation(d.id);
                      }}
                      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center border-2 transition-all ${
                        conversationIds.has(d.id)
                          ? "border-[#0b57d0] bg-[#0b57d0] text-white dark:border-[#a8c7fa] dark:bg-[#a8c7fa] dark:text-[#1a1d22]"
                          : "border-zinc-300 text-transparent hover:border-zinc-400 dark:border-zinc-600"
                      }`}
                      title={
                        conversationIds.has(d.id)
                          ? "Remove from chat"
                          : "Add to chat"
                      }
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* ── preview view ── */}
      {!showList && doc && (
        <>
          <button
            onClick={onBack}
            className="absolute left-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/90 text-zinc-600 shadow-sm backdrop-blur min-[1200px]:hidden dark:border-white/10 dark:bg-[#22262b]/90 dark:text-zinc-300"
            title="Back to documents"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          </button>
          {!isPdf && doc.status === "ready" && (
            <>
              <div className="shrink-0 px-4 pb-1 pt-3">
                <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Outline
                </h3>
              </div>
              <div className="max-h-44 shrink-0 overflow-y-auto px-2.5 pb-2">
                {outline.length === 0 ? (
                  <p className="px-3 py-1 text-xs text-zinc-400">
                    No headings found
                  </p>
                ) : (
                  <ul className="space-y-px">
                    {outline.map((o, i) => (
                      <li key={i}>
                        <button
                          onClick={() => {
                            setActive(i);
                            document
                              .getElementById(`bs-sec-${i}`)
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                          }}
                          style={{ paddingLeft: 14 + (o.level - 1) * 14 }}
                          className={`w-full truncate rounded-full px-3.5 py-1.5 text-left text-[13px] transition-all duration-150 ${
                            active === i
                              ? "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                              : "text-zinc-500 hover:bg-black/[0.03] hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-100"
                          }`}
                        >
                          {o.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          <div
            ref={contentRef}
            className="relative min-h-0 flex-1 overflow-y-auto border-t border-black/[0.05] px-6 py-4 dark:border-white/10"
          >
            {doc.status === "processing" ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Loader2
                  className="h-6 w-6 animate-spin text-zinc-300 dark:text-zinc-600"
                  strokeWidth={2}
                />
                <p className="text-sm text-zinc-400 dark:text-zinc-500">
                  Processing your uploaded document
                  <br />
                  You can view & ask once it's ready
                </p>
              </div>
            ) : doc.status === "error" ? (
              <div className="flex h-full flex-col items-center justify-center gap-2.5 text-center">
                <p className="text-sm text-zinc-400 dark:text-zinc-500">
                  Document processing failed
                </p>
                <button
                  onClick={retry}
                  disabled={retrying}
                  className="flex items-center gap-1.5 rounded-full bg-zinc-100 px-4 py-1.5 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-200 disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`}
                    strokeWidth={2}
                  />
                  Retry
                </button>
              </div>
            ) : isPdf ? (
              <div className="space-y-4">
                {pageCount === 0 ? (
                  <p className="pt-8 text-center text-sm text-zinc-400">
                    Pages uploading — will appear shortly…
                  </p>
                ) : (
                  Array.from({ length: pageCount }, (_, i) => i + 1).map(
                    (n) => (
                      <div
                        key={n}
                        id={`bs-page-${n}`}
                        style={{ contentVisibility: "auto", containIntrinsicSize: "auto 900px" }}
                        className={`relative overflow-hidden rounded-xl transition-colors ${
                          flashPage === n
                            ? "ring-2 ring-amber-300 dark:ring-amber-500/70"
                            : ""
                        }`}
                      >
                        <img
                          src={pageImageUrl(doc.id, n)}
                          alt={`Page ${n}`}
                          loading="lazy"
                          decoding="async"
                          className="w-full rounded-xl border border-black/[0.06] bg-white dark:border-white/10"
                        />
                        {hl?.page === n &&
                          hl.rects.map((r, i) => (
                            <div
                              key={i}
                              className="pointer-events-none absolute rounded-sm border border-amber-400/70 bg-amber-300/40 dark:border-amber-500/70 dark:bg-amber-500/25"
                              style={{
                                left: `${r.x * 100}%`,
                                top: `${r.y * 100}%`,
                                width: `${r.w * 100}%`,
                                height: `${r.h * 100}%`,
                              }}
                            />
                          ))}
                      </div>
                    )
                  )
                )}
              </div>
            ) : (
              <div
                className="prose prose-sm max-w-none dark:prose-invert
            prose-headings:mb-2 prose-headings:mt-6 prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-zinc-900 prose-headings:scroll-mt-5
            prose-h1:text-[20px] prose-h2:text-[17px] prose-h3:text-[15px] prose-h4:text-[14px]
            prose-p:my-3 prose-p:text-[14px] prose-p:leading-7 prose-p:text-zinc-600
            prose-li:my-1 prose-li:leading-7 prose-li:text-zinc-600
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
                <PreviewMarkdown
                  content={doc.content}
                  flashIdx={flashIdx}
                />
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
