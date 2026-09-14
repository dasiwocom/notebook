import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pymupdf

from . import config

_engine_tls = threading.local()
_lock = threading.Lock()

_CHAPTER_RE = re.compile(
    r"^\s*第\s*[一二三四五六七八九十百零千\d]+\s*[章节讲篇]\s*[\u4e00-\u9fffA-Za-z0-9]"
)
_SECTION_RE = re.compile(r"^\s*(\d+(\.\d+)+|\d+\s+|[一二三四五六七八九十]+[、.])\s+[\u4e00-\u9fffA-Za-z]")
_JUNK_RE = re.compile(r"[=±∑∫√≈≠≥≤×÷→→∞]")


def _get_engine_tls():
    e = getattr(_engine_tls, "engine", None)
    if e is None:
        from rapidocr_onnxruntime import RapidOCR

        e = _engine_tls.engine = RapidOCR()
    return e


def _ocr_dir(doc_id: str) -> Path:
    return config.PDF_OCR_DIR / doc_id


def _page_path(doc_id: str, page_no: int) -> Path:
    return _ocr_dir(doc_id) / f"{page_no}.json"


def has_cache(doc_id: str, page_no: int) -> bool:
    return _page_path(doc_id, page_no).exists()


def ocr_page(doc_id: str, page_no: int) -> dict:
    """OCR one page (cached). Returns {"text", "lines"} with normalized line boxes."""
    cache = _page_path(doc_id, page_no)
    if cache.exists():
        try:
            return json.loads(cache.read_text(encoding="utf-8"))
        except Exception:
            pass
    return _do_page(doc_id, page_no)


def _do_page(doc_id: str, page_no: int) -> dict:
    cache = _page_path(doc_id, page_no)
    if cache.exists():
        try:
            return json.loads(cache.read_text(encoding="utf-8"))
        except Exception:
            pass
    path = _raw_path(doc_id)
    if not path.exists():
        raise FileNotFoundError(doc_id)
    with pymupdf.open(path) as doc:
        if page_no < 1 or page_no > doc.page_count:
            raise IndexError(page_no)
        pix = doc[page_no - 1].get_pixmap(dpi=config.OCR_DPI, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
        pix.height, pix.width, pix.n
    )
    res, _ = _get_engine_tls()(img)

    w, h = pix.width, pix.height
    lines: list[dict] = []
    for item in res or []:
        box, text, _score = item
        if not text or not text.strip():
            continue
        xs = [pt[0] for pt in box]
        ys = [pt[1] for pt in box]
        x0, y0 = min(xs), min(ys)
        x1, y1 = max(xs), max(ys)
        lines.append(
            {
                "text": text.strip(),
                "x": round(x0 / w, 4),
                "y": round(y0 / h, 4),
                "w": round((x1 - x0) / w, 4),
                "h": round((y1 - y0) / h, 4),
            }
        )

    lines.sort(key=lambda ln: (round(ln["y"], 3), ln["x"]))
    data = {
        "text": "\n".join(ln["text"] for ln in lines),
        "lines": lines,
    }
    with _lock:
        cache.parent.mkdir(parents=True, exist_ok=True)
        try:
            cache.write_text(
                json.dumps(data, ensure_ascii=False), encoding="utf-8"
            )
        except Exception:
            pass
    return data


def _raw_path(doc_id: str) -> Path:
    return config.PDF_DATA_DIR / f"{doc_id}.pdf"


def _is_heading(text: str) -> int | None:
    """Return markdown level for a likely heading line, else None."""
    t = text.strip()
    if not t or len(t) > 40 or _JUNK_RE.search(t):
        return None
    if t.endswith((".", ",", "，", "。", "：", ":", "；", ";", "、", "！", "？", "!")):
        return None
    if _CHAPTER_RE.match(t):
        return 1
    if _SECTION_RE.match(t):
        return 2
    return None


def _ensure_pages(doc_id: str, count: int, progress=None) -> None:
    missing = [
        n for n in range(1, count + 1) if not _page_path(doc_id, n).exists()
    ]
    if not missing:
        if progress:
            progress(count, count)
        return
    workers = max(1, min(config.OCR_WORKERS, len(missing)))
    state = {"done": 0}
    state_lock = threading.Lock()

    def run(n: int) -> None:
        try:
            _do_page(doc_id, n)
        except Exception:
            # 单页失败不中断整本书：写空缓存占位，跳过该页继续。
            try:
                cache = _page_path(doc_id, n)
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(
                    json.dumps({"text": "", "lines": []}, ensure_ascii=False),
                    encoding="utf-8",
                )
            except Exception:
                pass
        with state_lock:
            state["done"] += 1
            if progress:
                progress(state["done"], count)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(run, missing))


def extract_ocr(doc_id: str, progress=None, ocr_missing: bool = True) -> str:
    """OCR the whole PDF into markdown. Each page starts with '# 第 N 页',
    detected chapter/section headings become nested headers.
    Missing pages are OCR'd in parallel (cached per page afterwards).
    ocr_missing=False 时只读取已缓存页、不补齐缺页（供“部分索引”只嵌入已 OCR
    的前几章，避免嵌套跑全书 OCR）。"""
    count = _page_count(doc_id)
    if ocr_missing:
        _ensure_pages(doc_id, count, progress)
    parts: list[str] = []
    for n in range(1, count + 1):
        try:
            data = json.loads(_page_path(doc_id, n).read_text(encoding="utf-8"))
        except Exception:
            data = {"lines": []}
        lines = data.get("lines") or []
        rows = []
        for ln in lines:
            lvl = _is_heading(ln["text"])
            if lvl == 1:
                rows.append(f"## {ln['text'].strip()}")
            elif lvl == 2:
                rows.append(f"### {ln['text'].strip()}")
            else:
                rows.append(ln["text"].strip())
        parts.append(f"\n\n# 第 {n} 页\n\n" + "\n".join(rows))
    return "\n".join(parts).strip()


def _page_count(doc_id: str) -> int:
    from . import pdf

    return pdf.page_count(doc_id)


def clear_doc(doc_id: str) -> None:
    d = _ocr_dir(doc_id)
    if d.exists():
        for f in d.glob("*.json"):
            f.unlink(missing_ok=True)
        try:
            d.rmdir()
        except OSError:
            pass