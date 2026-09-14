export type DocumentStatus = "processing" | "ready" | "error";

export type DocumentInfo = {
  id: string;
  name: string;
  char_count: number;
  status: DocumentStatus;
  created_at: number;
  chunk_count: number;
  indexed_chunks: number;
};

export type Citation = {
  chunk_id: number;
  doc_id: string;
  doc_name: string;
  section: string;
  snippet: string;
  score: number;
  verified?: boolean;
};

export type Source = {
  doc_name: string;
  section: string;
  score: number;
};

export type ChatResponse = {
  answer: string;
  citations: Citation[];
  sources: Source[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  sources: Source[];
  suggestions?: string[];
  error?: boolean;
};

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      citations: Citation[];
      sources: Source[];
      suggestions: string[];
      structured?: Record<string, unknown> | unknown[] | null;
    }
  | { type: "error"; text: string };

export type HistoryMessage = { role: "user" | "assistant"; content: string };

export type UploadResponse = {
  id: string;
  name: string;
  chunk_count: number;
  status: DocumentStatus;
  warning?: string;
};

export type DocumentChunk = {
  id: number;
  idx: number;
  path: string[];
  text: string;
  char_start: number;
  char_end: number;
};

export type DocumentDetail = DocumentInfo & {
  content: string;
  chunks: DocumentChunk[];
};