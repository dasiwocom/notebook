import json
import re
import threading
from typing import AsyncIterator

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from . import chat, chunker, config, db, pdf, settings
from .embeddings import embed_texts
from .retriever import retriever

app = FastAPI(title="notebook", version="0.1.0")


@app.on_event("startup")
def _startup() -> None:
    settings.ensure_file()
    db.reconcile_stale_statuses()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    history: list[dict] | None = None
    doc_id: str | None = None
    doc_ids: list[str] | None = None


class RenameRequest(BaseModel):
    name: str


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/documents")
def list_documents() -> list[dict]:
    return db.list_documents()


@app.get("/api/documents/{doc_id}")
def get_document(doc_id: str) -> dict:
    doc = db.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="document not found")
    doc["chunks"] = db.get_chunks(doc_id)
    return doc


@app.post("/api/documents")
async def upload_document(file: UploadFile = File(...)) -> dict:
    name = file.filename or "untitled"
    raw = await file.read()
    lower = name.lower()

    content = ""
    if lower.endswith(".pdf"):
        try:
            content, _ = pdf.extract_text_with_flag(raw)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    elif lower.endswith(".md"):
        content = raw.decode("utf-8", errors="replace")
    else:
        raise HTTPException(status_code=400, detail="仅支持 .md 和 .pdf 文件")

    # Async-first: accept the file, return immediately, index in background.
    doc_id = db.insert_document(name, content, status="processing")
    if lower.endswith(".pdf"):
        pdf.save_raw(doc_id, raw)
    _start_reindex(doc_id)
    return {
        "id": doc_id,
        "name": name,
        "chunk_count": 0,
        "status": "processing",
        "warning": None,
    }


@app.get("/api/documents/{doc_id}/pages")
def document_pages(doc_id: str) -> dict:
    if db.get_document(doc_id) is None:
        raise HTTPException(status_code=404, detail="document not found")
    return {"count": pdf.page_count(doc_id)}


@app.get("/api/documents/{doc_id}/pages/{page_no}")
def document_page_image(doc_id: str, page_no: int) -> Response:
    if db.get_document(doc_id) is None:
        raise HTTPException(status_code=404, detail="document not found")
    try:
        data = pdf.render_page_image(doc_id, page_no)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="pdf file not found")
    except IndexError:
        raise HTTPException(status_code=404, detail="page out of range")
    return Response(content=data, media_type="image/png")


@app.get("/api/documents/{doc_id}/pages/{page_no}/highlights")
def document_page_highlights(
    doc_id: str, page_no: int, q: str = "", snippet: str = ""
) -> dict:
    if db.get_document(doc_id) is None:
        raise HTTPException(status_code=404, detail="document not found")
    try:
        boxes = pdf.highlight_boxes(doc_id, page_no, q, snippet)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="pdf file not found")
    except IndexError:
        raise HTTPException(status_code=404, detail="page out of range")
    return {"highlights": boxes}


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str) -> dict:
    if db.get_document(doc_id) is None:
        raise HTTPException(status_code=404, detail="document not found")
    db.delete_document(doc_id)
    pdf.clear_doc(doc_id)
    retriever.reload()
    _reindex_status.pop(doc_id, None)
    return {"deleted": doc_id}


@app.patch("/api/documents/{doc_id}")
def rename_document(doc_id: str, req: RenameRequest) -> dict:
    if db.get_document(doc_id) is None:
        raise HTTPException(status_code=404, detail="document not found")
    db.rename_document(doc_id, req.name.strip() or req.name)
    return {"renamed": doc_id, "name": req.name.strip()}


_reindex_status: dict[str, dict] = {}
_partial_lock = threading.Lock()
_job_lock = threading.Lock()


def _is_blank_chunk(text: str) -> bool:
    """纯页码块（空白/分隔页只剩 '# 第 N 页'）或只含页脚页码的碎片不进入检索。"""
    body = _PAGE_MARK_ONLY_RE.sub("", text).strip()
    if not body:
        return True
    if len(body) < 24 and not re.search(r"[，。；、,.?:;]", body):
        return True
    return False


_PAGE_MARK_ONLY_RE = re.compile(r"#\s*第\s*\d+\s*页\s*")


def _build_index(doc_id: str) -> None:
    from . import ocr

    content = ocr.extract_ocr(doc_id)
    chunks = chunker.chunk_markdown(
        content, max_chars=config.CHUNK_SIZE, overlap=config.CHUNK_OVERLAP
    )
    embeddings = embed_texts([c["text"] for c in chunks])
    embeddings = [
        None if _is_blank_chunk(c["text"]) else e for c, e in zip(chunks, embeddings)
    ]
    db.replace_document(doc_id, content, chunks, embeddings)
    retriever.reload()


def _run_reindex(doc_id: str) -> None:
    # Serialize heavy background work (OCR + embedding) so concurrent
    # uploads never saturate the machine.
    with _job_lock:
        _run_reindex_locked(doc_id)


def _run_reindex_locked(doc_id: str) -> None:
    every = config.OCR_PARTIAL_EVERY
    state = {"building": False, "last": 0}
    try:
        doc = db.get_document(doc_id)
        if doc is None:
            return
        is_pdf = doc["name"].lower().endswith(".pdf")
        total = pdf.page_count(doc_id) if is_pdf else 1
        _reindex_status[doc_id]["total"] = total

        def progress(n, t):
            _reindex_status[doc_id].update(
                {"page": n, "total": t, "stage": "ocr"}
            )
            do_build = False
            with _partial_lock:
                if (
                    is_pdf
                    and n < total
                    and every
                    and n >= every
                    and n - state["last"] >= every
                    and not state["building"]
                ):
                    state["building"] = True
                    do_build = True
            if do_build:
                try:
                    _build_index(doc_id)
                except Exception:
                    pass
                finally:
                    with _partial_lock:
                        state["building"] = False
                        state["last"] = n

        if is_pdf:
            content, used_ocr = pdf.extract_document_text(doc_id, progress=progress)
        else:
            content = doc["content"]
            used_ocr = False

        _reindex_status[doc_id]["stage"] = "embed"
        chunks = chunker.chunk_markdown(
            content, max_chars=config.CHUNK_SIZE, overlap=config.CHUNK_OVERLAP
        )
        embeddings: list[list[float] | None] = []
        warning = None
        try:
            raw_embeddings = embed_texts([c["text"] for c in chunks])
            embeddings = [
                None if _is_blank_chunk(c["text"]) else e
                for c, e in zip(chunks, raw_embeddings)
            ]
        except Exception as exc:
            warning = str(exc)
            embeddings = [None] * len(chunks)
        db.replace_document(doc_id, content, chunks, embeddings)
        retriever.reload()
        db.set_doc_status(doc_id, "ready")
        _reindex_status[doc_id].update(
            {
                "state": "done",
                "chunk_count": len(chunks),
                "chars": len(content),
                "used_ocr": used_ocr,
                "stage": None,
                "warning": warning,
            }
        )
    except Exception as exc:
        db.set_doc_status(doc_id, "error")
        _reindex_status[doc_id].update({"state": "error", "error": str(exc)})


def _start_reindex(doc_id: str) -> bool:
    if _reindex_status.get(doc_id, {}).get("state") == "running":
        return False
    _reindex_status[doc_id] = {
        "state": "running",
        "stage": "ocr",
        "page": 0,
        "total": 0,
        "used_ocr": None,
        "error": None,
    }
    db.set_doc_status(doc_id, "processing")
    threading.Thread(target=_run_reindex, args=(doc_id,), daemon=True).start()
    return True


@app.post("/api/documents/{doc_id}/reindex")
def reindex_document(doc_id: str) -> dict:
    if db.get_document(doc_id) is None:
        raise HTTPException(status_code=404, detail="document not found")
    return {"started": _start_reindex(doc_id)}


@app.get("/api/documents/{doc_id}/reindex")
def reindex_status(doc_id: str) -> dict:
    return _reindex_status.get(doc_id, {"state": "idle", "page": 0, "total": 0})


@app.post("/api/chat")
async def chat_with_sources(req: ChatRequest):
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="empty message")

    async def ndjson_stream() -> AsyncIterator[str]:
        for event in chat.answer_stream(
            message, history=req.history, doc_id=req.doc_id, doc_ids=req.doc_ids
        ):
            yield json.dumps(event, ensure_ascii=False) + "\n"

    from starlette.responses import StreamingResponse

    return StreamingResponse(
        ndjson_stream(), media_type="application/x-ndjson"
    )


@app.get("/api/settings")
def get_settings() -> dict:
    """当前生效配置（API key 只给“是否已配置”，不回传原文）。"""
    return settings.effective()


@app.put("/api/settings")
def put_settings(patch: dict) -> dict:
    """合并覆盖设置并落盘；保存后立即生效（无需重启）。

    语义：缺省键不动；值为空字符串则删除该覆盖（回退 .env 默认）。
    keys 里出现字符串键时清空该键（用于删除 API key）。
    """
    if "values" in patch and isinstance(patch.get("values"), dict):
        patch = patch["values"]
    return settings.save(patch)


class SettingsTest(BaseModel):
    kind: str  # "llm" | "embedding"


@app.post("/api/settings/test")
def test_settings(req: SettingsTest) -> dict:
    """连通性自检：llm 调 /models（OpenAI 兼容），embedding 做一次真实嵌入。"""
    if req.kind not in {"llm", "embedding"}:
        raise HTTPException(status_code=400, detail="kind must be 'llm' or 'embedding'")
    if req.kind == "llm":
        if not chat.has_llm_key():
            return {"ok": False, "message": "未配置 API Key"}
        try:
            models = chat._get_client().models.list()
            names = [m.id for m in models.data][:6]
            return {
                "ok": True,
                "message": f"连接成功，可用模型：{'、'.join(names) or '(空列表)'}",
            }
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "message": f"连接失败：{str(exc)[:300]}"}

    provider = settings.get("EMBEDDING_PROVIDER", config.EMBEDDING_PROVIDER)
    try:
        vectors = embed_texts(["连接测试"])
        if not vectors:
            return {"ok": False, "message": "没有返回向量"}
        return {"ok": True, "message": f"连接成功，向量维度 {len(vectors[0])}（模式：{provider}）"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "message": f"连接失败：{str(exc)[:300]}"}


# ── notes ──────────────────────────────────────────────────────────────


class NoteCreate(BaseModel):
    doc_id: str
    content: str = ""


class NoteUpdate(BaseModel):
    content: str


@app.get("/api/notes")
def list_notes(doc_id: str) -> list[dict]:
    return db.list_notes(doc_id)


@app.post("/api/notes")
def create_note(req: NoteCreate) -> dict:
    note_id = db.insert_note(req.doc_id, req.content)
    return {"id": note_id}


@app.put("/api/notes/{note_id}")
def update_note(note_id: str, req: NoteUpdate) -> dict:
    if not db.get_note(note_id):
        raise HTTPException(status_code=404, detail="note not found")
    db.update_note(note_id, req.content)
    return {"ok": True}


@app.delete("/api/notes/{note_id}")
def delete_note(note_id: str) -> dict:
    if not db.delete_note(note_id):
        raise HTTPException(status_code=404, detail="note not found")
    return {"ok": True}


# ── conversations / studies ───────────────────────────────────────────


class ConvSync(BaseModel):
    title: str | None = None
    doc_ids: list[str] | None = None
    messages: list[dict] | None = None


class StudiesSync(BaseModel):
    studies: list[dict]


@app.get("/api/conversations")
def list_conversations() -> list[dict]:
    return db.list_conversations()


@app.post("/api/conversations")
def create_conversation() -> dict:
    return {"id": db.create_conversation()}


@app.get("/api/conversations/{conv_id}")
def get_conversation(conv_id: str) -> dict:
    conv = db.get_conversation(conv_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    return conv


@app.patch("/api/conversations/{conv_id}")
def rename_conversation(conv_id: str, req: RenameRequest) -> dict:
    title = req.name.strip() or "新对话"
    if not db.update_conversation(conv_id, title=title):
        raise HTTPException(status_code=404, detail="conversation not found")
    return {"ok": True}


@app.delete("/api/conversations/{conv_id}")
def delete_conversation(conv_id: str) -> dict:
    if not db.delete_conversation(conv_id):
        raise HTTPException(status_code=404, detail="conversation not found")
    return {"ok": True}


@app.put("/api/conversations/{conv_id}")
def sync_conversation(conv_id: str, req: ConvSync) -> dict:
    if not db.update_conversation(
        conv_id, title=req.title, doc_ids=req.doc_ids, messages=req.messages
    ):
        raise HTTPException(status_code=404, detail="conversation not found")
    return {"ok": True}


@app.get("/api/conversations/{conv_id}/studies")
def list_studies(conv_id: str) -> list[dict]:
    if db.get_conversation(conv_id) is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    return db.list_studies(conv_id)


@app.put("/api/conversations/{conv_id}/studies")
def sync_studies(conv_id: str, req: StudiesSync) -> dict:
    if db.get_conversation(conv_id) is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    db.replace_studies(conv_id, req.studies)
    return {"ok": True}