import re

_ATX = re.compile(r"^(#{1,6})\s+(.*)$")


def _slice_text(text: str, max_chars: int, overlap: int) -> list[tuple[int, str]]:
    text = text.rstrip("\n")
    if not text:
        return []
    if len(text) <= max_chars:
        return [(0, text)]
    parts = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        cut = text.rfind("\n", start, end)
        if cut > start + max_chars // 2:
            end = cut
        content = text[start:end].strip()
        if content:
            parts.append((start, content))
        if end >= len(text):
            break
        new_start = end - overlap if end - overlap > start else end
        if new_start >= len(text):
            break
        start = new_start
    return parts


def chunk_markdown(
    text: str, max_chars: int = 1500, overlap: int = 200
) -> list[dict]:
    lines = text.splitlines(keepends=True)
    sections = []
    cur_path: list[tuple[int, str]] = []
    buf: list[str] = []
    buf_start = 0
    offset = 0

    def flush(start: int) -> None:
        content = "".join(buf)
        if content.strip():
            sections.append({"path": [t for _, t in cur_path], "start": start, "text": content})
        buf.clear()

    for line in lines:
        m = _ATX.match(line)
        if m:
            flush(buf_start)
            level = len(m.group(1))
            cur_path = [p for p in cur_path if p[0] < level] + [(level, m.group(2).strip())]
            buf_start = offset
            buf = [line]
        else:
            if not buf:
                buf_start = offset
            buf.append(line)
        offset += len(line)
    flush(buf_start)

    chunks = []
    idx = 0
    for sec in sections:
        for part_start, part in _slice_text(sec["text"], max_chars, overlap):
            chunks.append(
                {
                    "idx": idx,
                    "path": sec["path"],
                    "text": part,
                    "char_start": sec["start"] + part_start,
                    "char_end": sec["start"] + part_start + len(part),
                }
            )
            idx += 1
    return chunks