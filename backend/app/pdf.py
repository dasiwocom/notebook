import json
import re
import threading
from bisect import bisect_left
from pathlib import Path

import pymupdf

from . import config

_lock = threading.Lock()

_WS = re.compile(r"\s+")


def _norm(s: str) -> str:
    return _WS.sub("", s)


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r"[。！？；.!?;…\n]+", text)
    return [p.strip() for p in parts if len(p.strip()) >= 6]


def _bigrams(s: str) -> set[str]:
    s = _norm(s.lower())
    return {s[i : i + 2] for i in range(max(0, len(s) - 1))}


def _score(query: str, sentence: str) -> float:
    qb = _bigrams(query)
    sb = _bigrams(sentence)
    if not qb or not sb:
        return 0.0
    return len(qb & sb) / len(qb)


def highlight_boxes(
    doc_id: str, page_no: int, query: str, snippet: str
) -> list[dict]:
    """Locate query-related sentences of the cited snippet on a page, return normalized rects.
    Uses embedded-text word boxes, falling back to OCR line boxes when the text layer is absent."""
    path = raw_path(doc_id)
    if not path.exists():
        raise FileNotFoundError(doc_id)
    with pymupdf.open(path) as doc:
        if page_no < 1 or page_no > doc.page_count:
            raise IndexError(page_no)
        page = doc[page_no - 1]
        pr = page.rect
        words = page.get_text("words")
        page_text = page.get_text("text", sort=True)
    cands = _pick_sentences(query, snippet, page_text, words)

    boxes: list[dict] = []
    if words and cands:
        boxes = _locate_in_words(words, pr, cands)
    from . import ocr

    if ocr.has_cache(doc_id, page_no):
        boxes += _locate_in_ocr(doc_id, page_no, cands)
    return _dedupe_boxes(boxes)[:20]


def _pick_sentences(
    query: str, snippet: str, page_text: str, words: list
) -> list[str]:
    source = (snippet if snippet.strip() else page_text).strip()
    if not source and words:
        source = " ".join(w[4] for w in words)
    cands = _split_sentences(source)
    cands = [
        s
        for s in cands
        if not re.match(r"^#{1,2}\s*第\s*\d+\s*页", s.strip())
    ]
    if query:
        scored = sorted(((_score(query, s), s) for s in cands), reverse=True)
        pos = [s for sc, s in scored if sc > 0]
        cands = pos if pos else [s for sc, s in scored][:10]
    elif len(cands) > 10:
        cands = cands[:10]
    return cands


def _locate_in_words(
    words: list, pr, cands: list[str]
) -> list[dict]:
    page_norm = "".join(w[4] for w in words)
    offsets = [0]
    for w in words:
        offsets.append(offsets[-1] + len(w[4]))
    raw: list[tuple[float, float, float, float]] = []
    for s in cands:
        sn = _norm(s)
        idx = page_norm.find(sn)
        if idx < 0:
            continue
        end = idx + len(sn)
        ws = bisect_left(offsets, idx + 1) - 1
        we = min(bisect_left(offsets, end), len(words)) - 1
        if ws < 0 or we < ws or we >= len(words):
            continue
        x0 = min(words[k][0] for k in range(ws, we + 1))
        y0 = min(words[k][1] for k in range(ws, we + 1))
        x1 = max(words[k][2] for k in range(ws, we + 1))
        y1 = max(words[k][3] for k in range(ws, we + 1))
        raw.append((x0 / pr.width, y0 / pr.height, x1 / pr.width, y1 / pr.height))
    return [{"x": round(a, 4), "y": round(b, 4), "w": round(c - a, 4), "h": round(d - b, 4)} for (a, b, c, d) in raw]


def _locate_in_ocr(doc_id: str, page_no: int, cands: list[str]) -> list[dict]:
    from . import ocr

    data = ocr.ocr_page(doc_id, page_no)
    lines = data.get("lines") or []
    if not lines:
        return []
    nnorm = ""
    line_idx: list[int] = []
    for li, ln in enumerate(lines):
        ln_norm = _norm(ln["text"])
        nnorm += ln_norm
        line_idx.extend([li] * len(ln_norm))
    boxes: list[dict] = []
    for s in cands:
        sn = _norm(s)
        idx = nnorm.find(sn)
        if idx < 0:
            continue
        sel = sorted(set(line_idx[idx : idx + len(sn)]))
        if not sel:
            continue
        x0 = min(lines[k]["x"] for k in sel)
        y0 = min(lines[k]["y"] for k in sel)
        x1 = max(lines[k]["x"] + lines[k]["w"] for k in sel)
        y1 = max(lines[k]["y"] + lines[k]["h"] for k in sel)
        boxes.append(
            {"x": round(x0, 4), "y": round(y0, 4), "w": round(x1 - x0, 4), "h": round(y1 - y0, 4)}
        )
    return boxes


def _dedupe_boxes(boxes: list[dict]) -> list[dict]:
    out: list[dict] = []
    for b in boxes:
        dup = False
        for o in out:
            ox = min(b["x"] + b["w"], o["x"] + o["w"]) - max(b["x"], o["x"])
            oy = min(b["y"] + b["h"], o["y"] + o["h"]) - max(b["y"], o["y"])
            if (
                ox > 0
                and oy > 0
                and ox / min(b["w"], o["w"]) > 0.7
                and oy / min(b["h"], o["h"]) > 0.7
            ):
                dup = True
                break
        if not dup:
            out.append(b)
    return out


def extract_text(raw: bytes) -> str:
    return extract_text_with_flag(raw)[0]


def extract_text_with_flag(raw: bytes) -> tuple[str, bool]:
    """Extract embedded text; returns (content, scanned_flag).
    scanned is True when the PDF has almost no text layer (image-only pages)."""
    try:
        with pymupdf.open(stream=raw, filetype="pdf") as doc:
            content = _extract_from_doc(doc)
    except Exception as exc:
        raise ValueError(f"无法解析 PDF：{exc}") from exc
    body = _HDR_LINE_RE.sub("", content).strip()
    return content, len(body) < config.OCR_MIN_BODY_CHARS


_HDR_LINE_RE = re.compile(r"^#{1,2}\s*第\s*\d+\s*页\s*$", re.M)


def _extract_from_doc(doc) -> str:
    parts: list[str] = []
    for i in range(doc.page_count):
        try:
            t = doc[i].get_text("text", sort=True).strip()
        except Exception:
            t = ""
        parts.append(f"\n\n## 第 {i + 1} 页\n\n{t}")
    return "".join(parts).strip()


def extract_document_text(
    doc_id: str, *, prefer_ocr: bool = False, progress=None
) -> tuple[str, bool]:
    """Extract text for a saved document. Returns (text, used_ocr).
    Falls back to OCR when the PDF has almost no embedded text."""
    path = raw_path(doc_id)
    if not path.exists():
        raise FileNotFoundError(doc_id)
    with pymupdf.open(path) as doc:
        embedded = _extract_from_doc(doc)
    body = _HDR_LINE_RE.sub("", embedded).strip()
    if not prefer_ocr and len(body) >= config.OCR_MIN_BODY_CHARS:
        return embedded, False
    from . import ocr

    return ocr.extract_ocr(doc_id, progress=progress), True


def raw_path(doc_id: str) -> Path:
    return config.PDF_DATA_DIR / f"{doc_id}.pdf"


def _meta_path(doc_id: str) -> Path:
    return config.PDF_DATA_DIR / f"{doc_id}.json"


def save_raw(doc_id: str, raw: bytes) -> None:
    config.PDF_DATA_DIR.mkdir(parents=True, exist_ok=True)
    raw_path(doc_id).write_bytes(raw)


def page_count(doc_id: str) -> int:
    meta = _meta_path(doc_id)
    if meta.exists():
        try:
            return int(json.loads(meta.read_text()).get("count", 0))
        except Exception:
            pass
    path = raw_path(doc_id)
    if not path.exists():
        return 0
    with pymupdf.open(path) as doc:
        count = doc.page_count
    try:
        meta.parent.mkdir(parents=True, exist_ok=True)
        meta.write_text(json.dumps({"count": count}))
    except Exception:
        pass
    return count


def render_page_image(doc_id: str, page_no: int) -> bytes:
    cache = config.PDF_PAGES_DIR / doc_id / f"{page_no}.png"
    if cache.exists():
        return cache.read_bytes()
    path = raw_path(doc_id)
    if not path.exists():
        raise FileNotFoundError(doc_id)
    with pymupdf.open(path) as doc:
        if page_no < 1 or page_no > doc.page_count:
            raise IndexError(page_no)
        pix = doc[page_no - 1].get_pixmap(
            dpi=config.PDF_PAGE_DPI, alpha=False, annots=True
        )
        data = pix.tobytes("png")
    with _lock:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(data)
    return data


def clear_doc(doc_id: str) -> None:
    raw_path(doc_id).unlink(missing_ok=True)
    _meta_path(doc_id).unlink(missing_ok=True)
    pages = config.PDF_PAGES_DIR / doc_id
    if pages.exists():
        for f in pages.glob("*.png"):
            f.unlink(missing_ok=True)
        try:
            pages.rmdir()
        except OSError:
            pass
    from . import ocr

    ocr.clear_doc(doc_id)