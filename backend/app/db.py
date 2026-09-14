import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path

from . import config

_lock = threading.Lock()
_local = threading.local()


def get_conn() -> sqlite3.Connection:
    """每线程一个连接：写操作仍由 _lock 串行化，读操作用本线程自己的连接。
    配合 WAL 模式，后台重索引写库时主线程读不会报 database is locked。"""
    conn = getattr(_local, "conn", None)
    if conn is None:
        Path(config.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(config.DB_PATH, check_same_thread=False, timeout=30.0)
        conn.row_factory = sqlite3.Row
        _init(conn)
        _local.conn = conn
    return conn


def _init(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            char_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'ready',
            created_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_id TEXT NOT NULL,
            idx INTEGER NOT NULL,
            path TEXT NOT NULL DEFAULT '[]',
            text TEXT NOT NULL,
            char_start INTEGER NOT NULL DEFAULT 0,
            char_end INTEGER NOT NULL DEFAULT 0,
            embedding TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            doc_id TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notes_doc ON notes(doc_id);
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '新对话',
            doc_ids TEXT NOT NULL DEFAULT '[]',
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS conversation_messages (
            conv_id TEXT NOT NULL,
            idx INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            citations TEXT NOT NULL DEFAULT '[]',
            sources TEXT NOT NULL DEFAULT '[]',
            suggestions TEXT NOT NULL DEFAULT '[]',
            error INTEGER NOT NULL DEFAULT 0,
            created_at REAL NOT NULL,
            PRIMARY KEY (conv_id, idx)
        );
        CREATE INDEX IF NOT EXISTS idx_convmsg ON conversation_messages(conv_id);
        CREATE TABLE IF NOT EXISTS studies (
            id TEXT PRIMARY KEY,
            conv_id TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT 'Studio',
            color TEXT NOT NULL DEFAULT '#f2f2e8',
            content TEXT NOT NULL DEFAULT '',
            structured TEXT,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_studies_conv ON studies(conv_id);
        """
    )
    cols = {r[1] for r in conn.execute("PRAGMA table_info(documents)")}
    if "status" not in cols:
        conn.execute(
            "ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'"
        )
    conn.commit()


def insert_document(name: str, content: str, status: str = "processing") -> str:
    doc_id = uuid.uuid4().hex[:16]
    with _lock:
        conn = get_conn()
        conn.execute(
            "INSERT INTO documents (id, name, content, char_count, status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (doc_id, name, content, len(content), status, time.time()),
        )
        conn.commit()
    return doc_id


def set_doc_status(doc_id: str, status: str) -> None:
    with _lock:
        conn = get_conn()
        conn.execute("UPDATE documents SET status = ? WHERE id = ?", (status, doc_id))
        conn.commit()


def reconcile_stale_statuses() -> None:
    """Startup recovery: docs left as 'processing' after a crash become
    'ready' only if fully indexed, otherwise 'error'."""
    for d in list_documents():
        if d["status"] != "processing":
            continue
        ready = d["chunk_count"] > 0 and d["indexed_chunks"] == d["chunk_count"]
        set_doc_status(d["id"], "ready" if ready else "error")


def insert_chunks(doc_id: str, chunks: list[dict], embeddings: list[list[float] | None]) -> None:
    if not chunks:
        return
    with _lock:
        conn = get_conn()
        rows = [
            (
                doc_id,
                c["idx"],
                json.dumps(c["path"], ensure_ascii=False),
                c["text"],
                c["char_start"],
                c["char_end"],
                json.dumps(emb) if emb is not None else None,
            )
            for c, emb in zip(chunks, embeddings)
            if emb is not None
        ]
        conn.executemany(
            "INSERT INTO chunks (doc_id, idx, path, text, char_start, char_end, embedding) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        conn.commit()


def replace_document(
    doc_id: str,
    content: str,
    chunks: list[dict],
    embeddings: list[list[float] | None],
) -> None:
    """Replace a document's content and chunks in place (re-index)."""
    with _lock:
        conn = get_conn()
        conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
        conn.execute(
            "UPDATE documents SET content = ?, char_count = ? WHERE id = ?",
            (content, len(content), doc_id),
        )
        rows = [
            (
                doc_id,
                c["idx"],
                json.dumps(c["path"], ensure_ascii=False),
                c["text"],
                c["char_start"],
                c["char_end"],
                json.dumps(emb) if emb is not None else None,
            )
            for c, emb in zip(chunks, embeddings)
            if emb is not None
        ]
        if rows:
            conn.executemany(
                "INSERT INTO chunks (doc_id, idx, path, text, char_start, char_end, embedding) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
        conn.commit()


def list_documents() -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT d.id, d.name, d.char_count, d.status, d.created_at,
               COUNT(c.id) AS chunk_count,
               SUM(CASE WHEN c.embedding IS NOT NULL THEN 1 ELSE 0 END) AS indexed_chunks
        FROM documents d
        LEFT JOIN chunks c ON c.doc_id = d.id
        GROUP BY d.id
        ORDER BY d.created_at ASC
        """
    ).fetchall()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "char_count": r["char_count"],
            "status": r["status"],
            "created_at": r["created_at"],
            "chunk_count": r["chunk_count"],
            "indexed_chunks": r["indexed_chunks"] or 0,
        }
        for r in rows
    ]


def get_document(doc_id: str) -> dict | None:
    conn = get_conn()
    row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if row is None:
        return None
    return dict(row)


def get_chunks(doc_id: str) -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT id, idx, path, text, char_start, char_end FROM chunks WHERE doc_id = ? ORDER BY idx",
        (doc_id,),
    ).fetchall()
    return [
        {
            "id": r["id"],
            "idx": r["idx"],
            "path": json.loads(r["path"]),
            "text": r["text"],
            "char_start": r["char_start"],
            "char_end": r["char_end"],
        }
        for r in rows
    ]


def delete_document(doc_id: str) -> None:
    with _lock:
        conn = get_conn()
        conn.execute("DELETE FROM notes WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        conn.commit()


def rename_document(doc_id: str, name: str) -> None:
    with _lock:
        conn = get_conn()
        conn.execute("UPDATE documents SET name = ? WHERE id = ?", (name, doc_id))
        conn.commit()


def get_indexed_chunks() -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT c.id, c.doc_id, c.path, c.text, c.embedding,
               d.name AS doc_name
        FROM chunks c
        JOIN documents d ON d.id = c.doc_id
        WHERE c.embedding IS NOT NULL
        ORDER BY c.id
        """
    ).fetchall()
    index = {}
    for r in rows:
        index[r["doc_id"]] = r["doc_name"]
    return [
        {
            "id": r["id"],
            "doc_id": r["doc_id"],
            "doc_name": r["doc_name"],
            "path": json.loads(r["path"]),
            "text": r["text"],
            "embedding": json.loads(r["embedding"]),
        }
        for r in rows
    ]


# ── notes ──────────────────────────────────────────────────────────────

def insert_note(doc_id: str, content: str = "") -> str:
    note_id = uuid.uuid4().hex[:16]
    with _lock:
        conn = get_conn()
        conn.execute(
            "INSERT INTO notes (id, doc_id, content, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (note_id, doc_id, content, time.time(), time.time()),
        )
        conn.commit()
    return note_id


def list_notes(doc_id: str) -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT id, doc_id, content, created_at, updated_at "
        "FROM notes WHERE doc_id = ? ORDER BY updated_at DESC",
        (doc_id,),
    ).fetchall()
    return [
        {
            "id": r["id"],
            "doc_id": r["doc_id"],
            "content": r["content"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        }
        for r in rows
    ]


def get_note(note_id: str) -> dict | None:
    conn = get_conn()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    return dict(row) if row else None


def update_note(note_id: str, content: str) -> bool:
    with _lock:
        conn = get_conn()
        cur = conn.execute(
            "UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
            (content, time.time(), note_id),
        )
        conn.commit()
        return cur.rowcount > 0


def delete_note(note_id: str) -> bool:
    with _lock:
        conn = get_conn()
        cur = conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        conn.commit()
        return cur.rowcount > 0


# ── conversations / messages ──────────────────────────────────────────

def create_conversation(title: str = "新对话") -> str:
    conv_id = uuid.uuid4().hex[:16]
    now = time.time()
    with _lock:
        conn = get_conn()
        conn.execute(
            "INSERT INTO conversations (id, title, doc_ids, created_at, updated_at) "
            "VALUES (?, ?, '[]', ?, ?)",
            (conv_id, title, now, now),
        )
        conn.commit()
    return conv_id


def list_conversations() -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT c.id, c.title, c.created_at, c.updated_at,
               (SELECT COUNT(*) FROM conversation_messages m
                 WHERE m.conv_id = c.id) AS message_count,
               (SELECT content FROM conversation_messages m
                 WHERE m.conv_id = c.id AND m.role = 'user'
                 ORDER BY m.idx DESC LIMIT 1) AS last_user
        FROM conversations c
        ORDER BY c.updated_at DESC
        """
    ).fetchall()
    return [dict(r) for r in rows]


def get_conversation(conv_id: str) -> dict | None:
    conn = get_conn()
    row = conn.execute(
        "SELECT id, title, doc_ids, created_at, updated_at FROM conversations WHERE id = ?",
        (conv_id,),
    ).fetchone()
    if row is None:
        return None
    msgs = conn.execute(
        "SELECT idx, role, content, citations, sources, suggestions, error "
        "FROM conversation_messages WHERE conv_id = ? ORDER BY idx",
        (conv_id,),
    ).fetchall()
    out = dict(row)
    out["messages"] = [
        {
            "id": f"m{r['idx']}",
            "role": r["role"],
            "content": r["content"],
            "citations": json.loads(r["citations"] or "[]"),
            "sources": json.loads(r["sources"] or "[]"),
            "suggestions": json.loads(r["suggestions"] or "[]"),
            "error": bool(r["error"]),
        }
        for r in msgs
    ]
    try:
        out["doc_ids"] = json.loads(out["doc_ids"] or "[]")
    except (json.JSONDecodeError, ValueError):
        out["doc_ids"] = []
    return out


def update_conversation(
    conv_id: str,
    *,
    title: str | None = None,
    doc_ids: list[str] | None = None,
    messages: list[dict] | None = None,
) -> bool:
    """全量同步一个会话：改名 / 更新所选文档 / 整批替换消息。存在返回 True，不存在返回 False。"""
    with _lock:
        conn = get_conn()
        if conn.execute(
            "SELECT 1 FROM conversations WHERE id = ?", (conv_id,)
        ).fetchone() is None:
            return False
        if title is not None:
            conn.execute("UPDATE conversations SET title = ? WHERE id = ?", (title, conv_id))
        if doc_ids is not None:
            conn.execute(
                "UPDATE conversations SET doc_ids = ? WHERE id = ?",
                (json.dumps(doc_ids, ensure_ascii=False), conv_id),
            )
        if messages is not None:
            conn.execute("DELETE FROM conversation_messages WHERE conv_id = ?", (conv_id,))
            now = time.time()
            conn.executemany(
                "INSERT INTO conversation_messages "
                "(conv_id, idx, role, content, citations, sources, suggestions, error, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        conv_id,
                        i,
                        m.get("role", "assistant"),
                        m.get("content", "") or "",
                        json.dumps(m.get("citations") or [], ensure_ascii=False),
                        json.dumps(m.get("sources") or [], ensure_ascii=False),
                        json.dumps(m.get("suggestions") or [], ensure_ascii=False),
                        1 if m.get("error") else 0,
                        now,
                    )
                    for i, m in enumerate(messages)
                    if isinstance(m, dict) and m.get("role") in {"user", "assistant"}
                ],
            )
        conn.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?", (time.time(), conv_id)
        )
        conn.commit()
    return True


def delete_conversation(conv_id: str) -> bool:
    with _lock:
        conn = get_conn()
        conn.execute("DELETE FROM conversation_messages WHERE conv_id = ?", (conv_id,))
        conn.execute("DELETE FROM studies WHERE conv_id = ?", (conv_id,))
        cur = conn.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
        conn.commit()
        return cur.rowcount > 0


# ── studies（Studio 工具产出）─────────────────────────────────────────

def replace_studies(conv_id: str, studies: list[dict]) -> None:
    with _lock:
        conn = get_conn()
        conn.execute("DELETE FROM studies WHERE conv_id = ?", (conv_id,))
        now = time.time()
        conn.executemany(
            "INSERT INTO studies (id, conv_id, label, color, content, structured, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    str(s.get("id", "")),
                    conv_id,
                    s.get("label", "Studio"),
                    s.get("color", "#f2f2e8"),
                    s.get("content", "") or "",
                    json.dumps(s.get("structured"), ensure_ascii=False),
                    s.get("created_at", now) or now,
                )
                for s in studies
                if isinstance(s, dict) and s.get("id")
            ],
        )
        conn.commit()


def list_studies(conv_id: str) -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT id, label, color, content, structured, created_at "
        "FROM studies WHERE conv_id = ? ORDER BY created_at DESC",
        (conv_id,),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["structured"] = json.loads(d["structured"])
        except (json.JSONDecodeError, ValueError, TypeError):
            d["structured"] = None
        out.append(d)
    return out