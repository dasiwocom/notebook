"""NotebookLM 风格的学习助手。

把「速通 / 复习划重点 / 自测题」这类学习意图从普通问答里分流，
基于文档目录 + 各章起始页开篇片段，生成带页码引用([source:N])的学习材料，
复用现有聊天流的 引用跳转 / PDF 高亮 逻辑。
"""

import json
import re
from pathlib import Path

from . import config, db, ocr
from .chat import _parse_citations, _strip_suggest, _get_client, chat_model, has_llm_key

_CN_NUM = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
}

_ARABIC_CHAPTER_RE = re.compile(r"第\s*(\d+)\s*[章节篇部分]")
_CN_CHAPTER_RE = re.compile(r"第\s*([一二三四五六七八九十]{1,3})\s*[章节篇部分]")


def _cn_to_int(s: str) -> int:
    if "十" in s:
        left, right = s.split("十", 1)
        tens = _CN_NUM.get(left) if left else 10
        ones = _CN_NUM.get(right, 0)
        return tens + ones if left else 10 + ones
    return _CN_NUM.get(s, 0)


def extract_chapter_no(message: str) -> int | None:
    m = _ARABIC_CHAPTER_RE.search(message)
    if m:
        n = int(m.group(1))
        if 1 <= n <= 40:
            return n
    m = _CN_CHAPTER_RE.search(message)
    if m:
        n = _cn_to_int(m.group(1))
        if 1 <= n <= 40:
            return n
    return None


def chapter_scope(doc_id: str | None, message: str) -> tuple[str, int, int] | None:
    """问题提到具体章节时，返回 (目标文档, 起始页, 结束页)，供按章节限定检索。"""
    info = chapter_info(doc_id, message)
    if info is None:
        return None
    return (info["doc_id"], info["start"], info["end"])


def chapter_info(doc_id: str | None, message: str) -> dict | None:
    """问题点名章节时，返回含章号/章题/页码范围/全书目录的上下文信息。

    供讲解等模式使用：让模型知道自己正在讲哪一章、以及这章在全书中的位置。
    返回 {
        doc_id, no, title, start, end,
        label: "第 2 章 xxx（第 18 页起）",
        outline_line: "全书章节：第 1 章 xxx → 第 2 章 xxx → ...",
    }；解析不到返回 None。
    """
    no = extract_chapter_no(message)
    if no is None:
        return None
    target = resolve_target(doc_id)
    if target is None:
        return None
    outline = get_outline(db.get_document(target))
    if not outline:
        return None
    idx = next(
        (i for i, e in enumerate(outline) if _chapter_no(e["title"]) == no), None
    )
    if idx is None:
        return None
    title = outline[idx]["title"]
    start = int(outline[idx].get("page") or 0)
    end = (
        int(outline[idx + 1]["page"]) - 1
        if idx + 1 < len(outline)
        else start + 60
    )
    outline_line = " → ".join(
        f"{_chapter_no(e['title'])}: {e['title']}" if _chapter_no(e["title"]) else e["title"]
        for e in outline
    )
    return {
        "doc_id": target,
        "no": no,
        "title": title,
        "start": start,
        "end": end,
        "label": f"第 {no} 章「{title}」（第 {start} 页起，约第 {start}–{end} 页）",
        "outline_line": "全书章节顺序：" + outline_line,
    }

_CHAPTER_HEAD_RE = re.compile(r"^##\s+(第\s*[\d一二三四五六七八九十百]+\s*章[^\n]*)", re.M)
_PAGE_MARK_RE = re.compile(r"^#+\s+第\s*(\d+)\s*页\s*$", re.M)

# 学习意图 → 操作类型；顺序即优先级（先精确小类，后大类）
_OPSPEC = [
    (
        "mind_map",
        re.compile(r"思维导图|脑图|mind\s*map|导图"),
    ),
    (
        "quiz",
        re.compile(r"选择题|做题|quiz|单选"),
    ),
    (
        "self_test",
        re.compile(r"自测|出题|考考我|考我一|出几道|模拟题|测试题|练习题|小测|测一测|抽查"),
    ),
    (
        "key_points",
        re.compile(r"划重点|重点总结|考前复习|押题|重点在哪|哪些是重点|考点|考纲"),
    ),
    (
        "study_plan",
        re.compile(r"速通|带我过|帮我过|怎么学|如何学|学习计划|学习路线|这门课|整本书|全书"
                   r"|总结这本|这本书|概览|大纲|梳理|预习|速览"),
    ),
]
_OP_RE = _OPSPEC

_STUDY_PROMPTS: dict[str, str] = {
    "study_plan": """你是一个【学习导师】，对标 NotebookLM 的学习助手。下面会给出《{title}》的章节结构：每章包含章节名、起始页和开篇片段。

任务：为用户制作一份《这门课速通方案》。

要求（务必遵守）：
1. 只依据给出的章节材料作答（章节名、页码、开篇片段），不要编造书里没有的知识。
2. 用 Markdown 输出以下结构：
## 课程速通方案
### 一、课程概览
两三句话说明这本书的定位与内容主线（只能基于书名和章节标题推断）。
### 二、章节地图
逐章一行：`**章节名**（第 N 页起）—— 一句话主旨`，每行末尾标注 [source:N]。
### 三、学习路线
给出建议的学习顺序与时间分配，明确标出必读的重点章和可以略读的章（依据章节页码推断篇幅）。
### 四、关键概念速记
每章挑 2~4 个最核心的概念，用一句话解释，并在每条末尾标注 [source:N]。
3. [source:N] 的编号必须与提供的章节材料编号一一对应（从 0 开始），不要出现不存在的编号。
4. 整体语言口语化一点，像研究生带学弟速通一门课，但信息保持严谨。""",
    "key_points": """你是一个【学习导师】，对标 NotebookLM 的学习助手。下面会给出《{title}》的章节结构：每章包含章节名、起始页和开篇片段。

任务：为用户划这门课的重点，输出《考前重点清单》。

要求（务必遵守）：
1. 只依据给出的章节材料（章节名、页码、开篇片段）作答，不要编造书里没有的知识。
2. 用 Markdown 输出以下结构：
## 考前重点清单
### 一、重点章节
按重要程度给章节排优先级（重要/较重要/可略读），依据章节页码判断篇幅。
### 二、逐章重点
每章列出 3~6 个最可能考查的高频概念 / 流程 / 易错点，每条标注 [source:N]。
### 三、易混与易错点
挑 3~5 个容易混淆的概念做一个简短对比表。
### 四、复习建议
给出 2~3 条针对本书的高效复习建议。
3. [source:N] 的编号必须与提供的章节材料编号一一对应（从 0 开始），不要出现不存在的编号。""",
    "self_test": """你是一个【学习导师】，对标 NotebookLM 的学习助手。下面会给出《{title}》的章节结构：每章包含章节名、起始页和开篇片段。

任务：为用户出一组自测题。

要求（务必遵守）：
1. 题目只能围绕给出的章节材料（章节名、页码、开篇片段）中能直接推断的内容出，涉及具体数值、公式细节、长流程的题目一律不要出（材料里只有开篇片段，避免猜题）。
2. 用 Markdown 输出以下结构：
## 自测题
每一道题格式：`**第 X 题（对应章节名）** 题目 …… [source:N]`，优先概念定义、原理对比、主线流程这类宏观题。
### 参考答案
每题给要点式答案，并标注 [source:N]。
3. 出 8~10 题，覆盖尽量多的章节；[source:N] 的编号必须与章节材料编号一一对应（从 0 开始）。""",
    "mind_map": """你是一个【学习导师】，对标 NotebookLM 的思维导图功能。下面会给出《{title}》的章节结构：每章包含章节名、起始页和开篇片段。

任务：基于章节结构生成一份思维导图的 JSON 树。

要求（务必遵守）：
1. 只基于给出的章节材料（章节名、页码、开篇片段）生成，不要编造。
2. 根节点 label 为书名（去掉文件后缀）。一级子节点为各章，二级子节点为该章的核心概念（2~4 个）。
3. 严格只输出一个 JSON 代码块（```json ... ```），不要输出任何其他文字、标题或解释。
4. JSON 格式：
```json
{{"label":"书名","children":[{{"label":"第1章 xxx","children":[{{"label":"概念A"}},{{"label":"概念B"}}]}},{{"label":"第2章 xxx","children":[]}}]}}
```
5. children 为空数组时写 []，不要省略。每个 label 一句话，不超过 20 字。""",
    "quiz": """你是一个【学习导师】，对标 NotebookLM 的 Quiz 功能。下面会给出《{title}》的章节结构：每章包含章节名、起始页和开篇片段。

任务：基于章节材料出一组选择题。

要求（务必遵守）：
1. 题目只围绕给出的章节材料中能直接推断的内容，涉及具体数值、公式细节、长流程的一律不出。
2. 严格只输出一个 JSON 代码块（```json ... ```），不要输出任何其他文字。
3. JSON 格式：一个数组，每个元素是一道题。
```json
[{{"q":"题干","opts":["A. 选项1","B. 选项2","C. 选项3","D. 选项4"],"ans":0,"explain":"解析"}}]
```
4. ans 是正确选项的索引（0=A, 1=B, 2=C, 3=D）。出 8~10 题，覆盖尽量多的章节。
5. 解析一两句话说清楚为什么选这个，不要过长。""",
}


_OCR_NUM_MAP = {
    "!": "1", '"': "2", "#": "3", "$": "4", "%": "5",
    "&": "6", "'": "7", "(": "8", ")": "9", "*": "0",
}


def _chapter_no(title: str) -> int | None:
    m = re.search(r"第\s*([^\s，。；：]{1,6}?)\s*章", title)
    if not m:
        return None
    s = m.group(1)
    if s.isdigit():
        return int(s)
    if s in _CN_NUM:
        return _CN_NUM[s]
    digits = "".join(_OCR_NUM_MAP.get(c, "") for c in s)
    return int(digits) if digits.isdigit() else None


def detect_op(message: str) -> str | None:
    """返回学习操作类型（study_plan / key_points / self_test / mind_map / quiz），不是学习句返回 None。"""
    from .judge import chapter_scoped

    if chapter_scoped(message):
        return None
    for op, rel in _OP_RE:
        if rel.search(message):
            return op
    return None


def _extract_balanced_json(text: str):
    """在没有代码块保证时，引号感知扫描最外层首个可解析的 JSON 对象/数组。"""
    i = 0
    n = len(text)
    while i < n:
        start = text.find("{", i)
        arr = text.find("[", i)
        if start < 0:
            start = arr
        elif arr >= 0:
            start = min(start, arr)
        if start < 0:
            return None
        depth = 0
        in_str = False
        esc = False
        j = start
        while j < n:
            c = text[j]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            elif c == '"':
                in_str = True
            elif c in "{[":
                depth += 1
            elif c in "}]":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:j + 1])
                    except (json.JSONDecodeError, ValueError):
                        return None
            j += 1
        i = start + 1
    return None


def _parse_structured(text: str, op: str):
    """从 LLM 输出中提取 JSON 并解析为结构化数据。

    依次尝试：```json 代码块 → 任意三反引号代码块 → 裸 JSON。
    只要形状匹配（mind_map 为带 label 的对象，quiz 为题目数组）即返回。
    """
    if op not in ("mind_map", "quiz"):
        return None
    data = None
    for pat in (
        r"```(?:json|JSON)\s*\n?(.*?)\n?\s*```",
        r"```(?!json|JSON\b)[^\n]*\n?(.*?)\n?\s*```",
    ):
        m = re.search(pat, text, re.S)
        if not m:
            continue
        try:
            data = json.loads(m.group(1))
            break
        except (json.JSONDecodeError, ValueError):
            continue
    if data is None:
        data = _extract_balanced_json(text)
    if op == "mind_map" and isinstance(data, dict) and "label" in data:
        return data
    if op == "quiz" and isinstance(data, list) and all(
        isinstance(q, dict) and "q" in q and "opts" in q and "ans" in q
        for q in data
    ):
        return data
    return None


def resolve_target(doc_id: str | None) -> str | None:
    """学习模式聚焦一份文档：显式 doc_id 优先，其次库里唯一就绪文档。"""
    if doc_id:
        doc = db.get_document(doc_id)
        return doc_id if doc and doc["status"] == "ready" else None
    docs = [d for d in db.list_documents() if d["status"] == "ready"]
    if len(docs) == 1:
        return docs[0]["id"]
    return None


def get_outline(doc: dict) -> list[dict] | None:
    """返回 [{title, page}]。

    优先级：data/tocs.json 手工目录 → PDF 自带书签(get_toc) → 正文标题推断。
    顺序即容错能力：前三者都失败时才报「找不到章节结构」。
    """
    curated = _curated_outline(doc)
    if curated:
        return curated
    bookmarked = _pdf_outline(doc)
    if bookmarked:
        return bookmarked
    return _fallback_outline(doc)


def _pdf_outline(doc: dict) -> list[dict] | None:
    """读 PDF 自带大纲/书签（get_toc），页码即 PDF 物理页号，与正文页标记对齐。

    只取一级条目；若全书无一级书签（PDF 只按「节」分级），则退而取全部。
    """
    from . import pdf

    path = pdf.raw_path(doc["id"])
    if not path.exists():
        return None
    try:
        import pymupdf

        with pymupdf.open(path) as d:
            toc = d.get_toc(simple=True)
    except Exception:
        return None
    if not toc:
        return None
    entries = [(int(lv), t.strip(), int(p)) for lv, t, p in toc if t.strip() and p >= 1]
    lvl1 = [(t, p) for lv, t, p in entries if lv == 1]
    items = lvl1 or [(t, p) for lv, t, p in entries]
    out, seen = [], set()
    for title, page in items:
        key = (title, page)
        if key in seen:
            continue
        seen.add(key)
        out.append({"title": title, "page": page})
    return out or None


def _curated_outline(doc: dict) -> list[dict] | None:
    path = Path(config.STUDY_TOC_PATH)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    name = doc["name"]
    for b in data.get("books", []):
        if any(s and s in name for s in b.get("match", [])):
            offset = int(b.get("page_offset", 0))
            return [
                {"title": c["title"], "page": int(c["page"]) + offset}
                for c in b.get("chapters", [])
            ]
    return None


def _fallback_outline(doc: dict) -> list[dict] | None:
    content = doc.get("content") or ""
    pages = {m.start(): int(m.group(1)) for m in _PAGE_MARK_RE.finditer(content)}
    page_starts = sorted(pages)
    if not page_starts:
        return None
    import bisect

    by_page: dict[int, str] = {}

    def consider(m_start: int, title: str) -> None:
        idx = bisect.bisect_right(page_starts, m_start) - 1
        if idx < 0:
            return
        page = pages[page_starts[idx]]
        cur = by_page.get(page)
        if cur is None or len(title) > len(cur):
            by_page[page] = title

    for m in _CHAPTER_HEAD_RE.finditer(content):
        consider(m.start(), m.group(1).strip())
    for m in _NAKED_CHAPTER_RE.finditer(content):
        name = m.group(0)
        if _TOC_LEADER_RE.search(name):
            continue
        consider(m.start(), f"第{m.group(1)}章 {m.group(2).strip()}")
    if not by_page:
        return None
    out = []
    for i, page in enumerate(sorted(by_page), 1):
        title = by_page[page]
        m = re.match(r"第\s*[^\s，。；：]{1,6}\s*章\s*", title)
        rest = title[m.end():] if m else title
        rest = rest.strip(" !·．.!，,、-—–　")
        out.append({"title": f"第 {i} 章 {rest}".rstrip(), "page": page})
    return out


# 裸章标题（OCR 扫描书常无 '##' 前缀）：`第!章!信号描述及分析基础`
_NAKED_CHAPTER_RE = re.compile(
    r"^第\s*([^\s，。；：]{1,6})\s*章\s*([^\n]{1,40})$", re.M
)

# 目录行的点线式占位连续符（'!!!!'、'···'、'....'），裸章匹配需跳过
_TOC_LEADER_RE = re.compile(r"[!·•．.\u00b7]{2,}")


_HEADER_SKIP = re.compile(
    r"^(嵌入式系统设计基础及应用.*|—*-?基于ARM.*|第\s*\d+\s*章[^。，；]{0,12})$"
)


def _chapter_excerpt(doc: dict, entry: dict, max_chars: int = 700) -> str:
    """取一章起始页的正文片段，跳过封面/页眉噪声；OCR 缺失或内容过短时叠加后续页。"""
    page = entry.get("page")
    text = ""
    if page:
        for pg in range(page, page + 4):
            try:
                data = ocr.ocr_page(doc["id"], pg)
            except Exception:
                break
            if data.get("text"):
                text += "\n" + data["text"]
            if len(text) >= max_chars:
                break
    if not text.strip():
        text = _content_excerpt(doc, entry["title"])
    if not text.strip():
        return "（该章开篇 OCR 暂不可用，仅有章节名与页码）"
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    lines = [ln for ln in lines if len(ln) > 1 and not _HEADER_SKIP.match(ln)]
    return "\n".join(lines)[:max_chars] or "（该章开篇内容为空）"


def _content_excerpt(doc: dict, title: str, max_chars: int = 700) -> str:
    content = doc.get("content") or ""
    idx = content.find(title)
    if idx < 0:
        return ""
    seg = content[idx + len(title):]
    seg = re.split(r"\n#+ ", seg, maxsplit=1)[0]
    return seg.strip()[:max_chars]


def _build_input(entries: list[dict], excerpts: list[str], doc_name: str, question: str) -> str:
    parts = []
    for i, (e, ex) in enumerate(zip(entries, excerpts)):
        page = e.get("page")
        page_txt = f"第 {page} 页" if page else "起始页未知"
        parts.append(
            f"[source:{i}] 章节编号 {i}\n"
            f"章节名：「{e['title']}」({page_txt}起)\n"
            f"开篇片段：\n{ex}"
        )
    return f"《{doc_name}》\n\n{'\n\n'.join(parts)}\n\n用户请求：{question}"


def _build_results(entries: list[dict], excerpts: list[str], doc: dict) -> list[dict]:
    results = []
    for i, (e, ex) in enumerate(zip(entries, excerpts)):
        page = e.get("page")
        path = ([f"第 {page} 页", e["title"]] if page else [e["title"]])
        results.append(
            {
                "chunk_id": i,
                "doc_id": doc["id"],
                "doc_name": doc["name"],
                "path": path,
                "text": ex,
                "score": 1.0,
            }
        )
    return results


def answer_study_stream(op: str, message: str, *, doc_id: str | None = None):
    """Yields NDJSON 事件（delta/done/error），与聊天流同构，前端无需改动。"""
    if not has_llm_key():
        yield {
            "type": "error",
            "text": "还没有配置 DeepSeek API Key，请在 backend/.env 里填写 DEEPSEEK_API_KEY。",
        }
        return

    target = resolve_target(doc_id)
    if target is None:
        docs = db.list_documents()
        if not docs:
            yield {"type": "error", "text": "库里还没有可学的文档，先上传一份再试。"}
        else:
            yield {
                "type": "error",
                "text": "库里有多份文档，学习助手一次聚焦一份；请在侧边栏选中要学的那门课再问。",
            }
        return

    doc = db.get_document(target)
    outline = get_outline(doc)
    if not outline:
        yield {
            "type": "error",
            "text": "没在这份文档里找到可用的章节结构，暂时无法生成学习材料。",
        }
        return

    excerpts = [_chapter_excerpt(doc, e) for e in outline]
    results = _build_results(outline, excerpts, doc)
    prompt = _STUDY_PROMPTS[op].format(title=doc["name"])
    user_input = _build_input(outline, excerpts, doc["name"], message)

    try:
        stream = _get_client().chat.completions.create(
            model=chat_model(),
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_input},
            ],
            temperature=0.2,
            stream=True,
        )

        full_text = ""
        shown = 0
        for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta is None:
                continue
            token = delta.content or ""
            if not token:
                continue
            full_text += token
            cleaned = _strip_suggest(full_text)
            if len(cleaned) > shown:
                yield {"type": "delta", "text": cleaned[shown:]}
                shown = len(cleaned)

        cleaned_final = _strip_suggest(full_text)
        citations = _parse_citations(cleaned_final, results)
        sources = [
            {
                "doc_name": r["doc_name"],
                "section": " > ".join(r["path"]) if r["path"] else "文档开头",
                "score": round(r["score"], 3),
            }
            for r in results
        ]
        yield {
            "type": "done",
            "citations": citations,
            "sources": sources,
            "suggestions": [],
            "structured": _parse_structured(full_text, op),
        }
    except Exception as exc:  # noqa: BLE001
        yield {"type": "error", "text": f"学习模式请求失败：{exc}"}