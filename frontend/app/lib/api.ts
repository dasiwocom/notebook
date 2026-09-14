import type {
  ChatMessage,
  ChatStreamEvent,
  Citation,
  DocumentDetail,
  DocumentInfo,
  HistoryMessage,
  UploadResponse,
} from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ??
  (typeof window === "undefined"
    ? "http://localhost:8000"
    : (window as any).electronAPI?.apiBase ??
      `http://${window.location.hostname}:8000`);

export { API_BASE };

const TOKEN =
  typeof window === "undefined"
    ? process.env.NEXT_PUBLIC_API_TOKEN
    : (window as any).electronAPI?.token ?? process.env.NEXT_PUBLIC_API_TOKEN;

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...(extra ?? {}) };
  if (TOKEN) h["Authorization"] = `Bearer ${TOKEN}`;
  return h;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: authHeaders(init?.headers as Record<string, string> | undefined),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail =
      data && typeof data.detail === "string" ? data.detail : res.statusText;
    throw new Error(detail);
  }
  return data as T;
}

export function listDocuments(): Promise<DocumentInfo[]> {
  return request<DocumentInfo[]>("/api/documents");
}

export function uploadDocument(
  file: File,
  onProgress?: (pct: number) => void
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/documents`);
    if (TOKEN) xhr.setRequestHeader("Authorization", `Bearer ${TOKEN}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      let data: UploadResponse | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as UploadResponse);
      } else {
        reject(
          new Error((data && (data as any).detail) || `HTTP ${xhr.status}`)
        );
      }
    };
    xhr.onerror = () => reject(new Error("Network error, upload failed"));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export function deleteDocument(id: string): Promise<{ deleted: string }> {
  return request<{ deleted: string }>(`/api/documents/${id}`, {
    method: "DELETE",
  });
}

export function reindexDocument(id: string): Promise<{ started: boolean }> {
  return request<{ started: boolean }>(`/api/documents/${id}/reindex`, {
    method: "POST",
  });
}

export function renameDocument(id: string, name: string): Promise<{ renamed: string }> {
  return request<{ renamed: string }>(`/api/documents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function getDocument(id: string): Promise<DocumentDetail> {
  return request<DocumentDetail>(`/api/documents/${id}`);
}

export type AppSettings = Record<string, string | number | boolean | null>;

export function getSettings(): Promise<AppSettings> {
  return request<AppSettings>("/api/settings");
}

export function saveSettings(patch: Record<string, unknown>): Promise<AppSettings> {
  return request<AppSettings>("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function testSettings(kind: "llm" | "embedding"): Promise<{
  ok: boolean;
  message: string;
}> {
  return request(`/api/settings/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
  });
}

export type ChatStreamOptions = {
  message: string;
  history: HistoryMessage[];
  doc_id: string | null;
  doc_ids?: string[] | null;
  op?: string | null;
  signal?: AbortSignal;
  onEvent: (ev: ChatStreamEvent) => void;
};

export async function chatStream(
  opts: ChatStreamOptions
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      message: opts.message,
      history: opts.history,
      doc_id: opts.doc_id,
      doc_ids: opts.doc_ids ?? null,
      op: opts.op ?? null,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let detail = `HTTP ${res.status}`;
    try {
      const data = JSON.parse(text);
      if (typeof data.detail === "string") detail = data.detail;
    } catch {
      if (text) detail = text;
    }
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const ev = JSON.parse(line) as ChatStreamEvent;
        opts.onEvent(ev);
      } catch {
        /* skip malformed line */
      }
    }
  }
}

// Re-exported helpers are used elsewhere
export type { ChatMessage };

export type Note = {
  id: string;
  doc_id: string;
  content: string;
  created_at: number;
  updated_at: number;
};

export function listNotes(docId: string): Promise<Note[]> {
  return request<Note[]>(`/api/notes?doc_id=${encodeURIComponent(docId)}`);
}

export function createNote(docId: string, content = ""): Promise<{ id: string }> {
  return request<{ id: string }>("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc_id: docId, content }),
  });
}

export function updateNote(noteId: string, content: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/notes/${noteId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export function deleteNote(noteId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/notes/${noteId}`, { method: "DELETE" });
}

export type ConversationInfo = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  last_user?: string | null;
};

export type PersistentMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: unknown[];
  sources?: unknown[];
  suggestions?: string[];
  error?: boolean;
};

export type LoadedMessage = PersistentMessage & { id: string };

export type ConversationDetail = {
  id: string;
  title: string;
  doc_ids: string[];
  messages: LoadedMessage[];
};

export function listConversations(): Promise<ConversationInfo[]> {
  return request<ConversationInfo[]>("/api/conversations");
}

export function createConversation(): Promise<{ id: string }> {
  return request<{ id: string }>("/api/conversations", { method: "POST" });
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/api/conversations/${id}`);
}

export function deleteConversation(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/conversations/${id}`, { method: "DELETE" });
}

export function syncConversation(
  id: string,
  patch: {
    title?: string;
    doc_ids?: string[];
    messages?: PersistentMessage[];
  }
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/conversations/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export type StudyRecord = {
  id: string;
  label: string;
  color?: string;
  content: string;
  structured?: unknown | null;
  citations?: Citation[];
  created_at?: number;
  expanded?: boolean;
};

export function listStudies(convId: string): Promise<StudyRecord[]> {
  return request<StudyRecord[]>(`/api/conversations/${convId}/studies`);
}

export function syncStudies(
  convId: string,
  studies: StudyRecord[]
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/conversations/${convId}/studies`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studies }),
  });
}