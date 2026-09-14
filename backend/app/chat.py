import json
import re

from openai import OpenAI

from . import config, settings
from .embeddings import embed_texts
from .retriever import retriever

SYSTEM_PROMPT = """你是一个学习型助手，对标 NotebookLM：默认严格依赖用户文档作答，但要像老师一样有判断力。

规则：
1. 来自文档的说法必须标注来源 [source:0]、[source:1] 等（编号与源材料一致），不要给出不存在的编号。
2. 要有教学的判断：
   - 材料充分 → 直接基于材料作答并带引用；
   - 概念理解 / 学习方法类问题，即使材料不直接覆盖，也可以用你自己的知识讲懂，但必须把「补充讲解 / 比喻 / 常识」单独用"补充："标明，不得冒充文档内容，同时尽量给出文档里最接近的内容和引用；
   - 需要文档里具体细节而材料没有 → 明确说这部分文档没覆盖，给出最接近的文档内容（带引用）或提一个澄清问题；
   - 与文档主题完全无关 → 不要硬答，友好说明当前文档是什么主题、能帮你什么。
3. 回答使用 Markdown，简洁有条理。
4. 回答末尾给一行追问建议，只建议与文档相关、有深度的追问：
SUGGESTIONS: 追问1|追问2|追问3"""

EXPLAIN_PROMPT = """你是一个有判断力的一对一老师，用户在「讲概念/讲章」模式，想真正弄懂某个概念或某一章，而不是听你复述套话。

规则（务必遵守，这是本模式的核心价值）：
1. 先弄明白到底要讲什么：
   - 若问题点名了「第 N 章」，你要认准这一章的身份——章号、章题、页码范围（下面会给定），并以此组织内容；不要把它当成「随便一章」来泛泛而谈。
   - 判断这一章/这个概念的「性质」再选讲法，禁止每章套同一个骨架：
     · 概念/原理章：讲清定义、分类、相互区别、常见混淆点；
     · 硬件/器件章：讲组成、引脚/寄存器/参数、工作流程、与外设的配合；
     · 软件/操作系统章：讲运行机制、调用流程、API 用在哪、与别的机制的区别；
     · 设计/方法章：讲步骤、公式/参数、设计权衡与易错点。
2. 禁止开头套话：不要以「本章主要介绍了……」或「本章重点讲解了……」开头。第一句话就给出这章/这个概念最有价值的一个判断：它在解决什么问题、或它最该被记住的一件事。
3. 内容必须从检索片段里抠「真东西」：点名书中特有的名词、定义、寄存器/引脚/参数/数值、流程步骤，能对上原文位置就加 [source:N]（编号与源材料一致，不要编造编号）。段落尽量做到「句句有出处」；没有片段支撑的推论/补充，用「补充：我自己的讲解」明确标出，不得冒充书里内容。
4. 把这章真正「讲出个样子」：提炼出这一章最核心的 2~4 个点当骨架，再逐个讲透；骨架必须来自这一章本身的内容，不准用「概念→原理→特点」这种万能模板。
5. 结合在全书中的位置讲（下面会给定全书章节顺序）：这章是给后面哪章打基础、和前/后章什么关系。
6. 收尾给一两句针对本章的「这样记」（一句话关键词或顺口溜），不要给放之四海皆准的万能记忆法。
7. 与文档主题完全无关的问题，友好引导回文档主题。
8. 回答使用 Markdown，紧凑有条理；末尾给一行追问建议：
SUGGESTIONS: 追问1|追问2|追问3"""

META_PROMPT = """你是一个学习助手，用户发来一条与文档内容关系不大的消息（打招呼 / 问你是谁 / 问你能做什么）。
友好简短地回应（你正在帮用户围绕文档学习），说明你能做什么：围绕文档提问、总结章节、制定速通学习规划、划重点、出题自测。
并列出当前库里的文档（若没有文档，请建议先上传）。
语气友好，三到四句，不要长篇大论，不要编造。"""

_CITE_RE = re.compile(r"\[source:(\d+)\]")
_SUGGEST_RE = re.compile(r"(?m)^\s*SUGGESTIONS:\s*(.*)$")


def _strip_suggest(text: str) -> str:
    """移除末尾的 SUGGESTIONS 行（含只输出裸 SUGGESTIONS 的截断情况）。"""
    t = _SUGGEST_RE.sub("", text)
    return re.sub(r"(?i)\bSUGGESTIONS[:：]?\s*$", "", t)

_client: OpenAI | None = None
_client_version: int = -1


def _get_client() -> OpenAI:
    global _client, _client_version
    ver = settings.version()
    if _client is None or _client_version != ver:
        _client = OpenAI(
            base_url=settings.get("DEEPSEEK_BASE_URL", config.DEEPSEEK_BASE_URL),
            api_key=settings.get("DEEPSEEK_API_KEY", config.DEEPSEEK_API_KEY),
            timeout=120.0,
            max_retries=2,
        )
        _client_version = ver
    return _client


def chat_model() -> str:
    return settings.get("CHAT_MODEL", config.CHAT_MODEL)


def has_llm_key() -> bool:
    return bool(settings.get("DEEPSEEK_API_KEY", config.DEEPSEEK_API_KEY))


# context 字符预算：防止 TOP_K 在设置里被调大后，拼接的源材料逼近模型上下文上限。
_MAX_CONTEXT_CHARS = 12000


def _build_context(results: list[dict]) -> str:
    parts = []
    total = 0
    for i, r in enumerate(results):
        section = " > ".join(r["path"]) if r["path"] else "文档开头"
        block = f'[source:{i}] 来自「{r["doc_name"]}」| 章节：{section}\n{r["text"]}'
        if parts and total + len(block) > _MAX_CONTEXT_CHARS:
            break
        parts.append(block)
        total += len(block)
    return "\n\n".join(parts)


def _bigrams(text: str) -> set[str]:
    """字符级 bigram：中文词边界模糊，用字符 n-gram 做轻量相似度。"""
    chars = [c for c in text.lower() if not c.isspace()]
    return {"".join(chars[i : i + 2]) for i in range(max(0, len(chars) - 1))}


def _citation_overlap(answer: str, chunk: str) -> float:
    """被引 chunk 与答案的字符 bigram 重叠比例（以 chunk 为分母）。
    用于「逐句有据」的轻量校验：重叠接近 0 说明引用大概率张冠李戴。"""
    ga, gb = _bigrams(answer), _bigrams(chunk)
    if not gb:
        return 0.0
    return len(ga & gb) / len(gb)


def _parse_citations(answer: str, results: list[dict]) -> list[dict]:
    citations = []
    seen = set()
    for m in _CITE_RE.finditer(answer):
        i = int(m.group(1))
        if i < 0 or i >= len(results) or i in seen:
            continue
        seen.add(i)
        r = results[i]
        citations.append(
            {
                "source": i,  # 源索引，便于前端做显式映射/校验
                "chunk_id": r["chunk_id"],
                "doc_id": r["doc_id"],
                "doc_name": r["doc_name"],
                "section": " > ".join(r["path"]) if r["path"] else "文档开头",
                "snippet": r["text"][:220].replace("\n", " ").strip(),
                "score": round(r["score"], 3),
                # 逐句有据校验：被引 chunk 与答案几乎零重叠 → 疑似编造/张冠李戴
                "verified": _citation_overlap(answer, r["text"]) >= 0.05,
            }
        )
    return citations


def _rewrite_question(history: list[dict] | None, raw: str) -> str:
    if not history:
        return raw
    msgs = [
        {
            "role": "system",
            "content": (
                "根据对话历史，把用户最新的问题改写为一个独立、完整、适合文档检索的查询句。"
                "只输出改写后的查询，不要回答问题。"
            ),
        }
    ]
    for h in history[-config.HISTORY_LIMIT :]:
        msgs.append(h)
    msgs.append({"role": "user", "content": raw})
    try:
        resp = _get_client().chat.completions.create(
            model=chat_model(), messages=msgs, temperature=0, max_tokens=200
        )
        text = (resp.choices[0].message.content or "").strip()
        return text if text and len(text) > 3 else raw
    except Exception:  # noqa: BLE001
        return raw


def _no_context_answer(reason: str) -> str:
    return f"根据提供的文档，{reason}无法回答这个问题。"


def _meta_answer():
    """寒暄/问助手功能：友好回应并列出库内文档。"""
    from . import db

    docs = db.list_documents()
    names = [d["name"] for d in docs]
    doc_lines = "\n".join(f"- {n}" for n in names) if names else "（当前还没有文档，请先上传。）"

    def emit(text: str, suggestions: list[str]) -> None:
        cleaned = _strip_suggest(text)
        yield {"type": "delta", "text": cleaned}
        yield {"type": "done", "citations": [], "sources": [], "suggestions": suggestions}

    if not has_llm_key():
        yield from emit("还没有配置 DeepSeek API Key。", [])
        return
    try:
        stream = _get_client().chat.completions.create(
            model=chat_model(),
            messages=[
                {"role": "system", "content": META_PROMPT},
                {
                    "role": "user",
                    "content": "当前库里文档：\n" + doc_lines,
                },
            ],
            temperature=0.4,
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
        if not cleaned_final:
            yield {"type": "delta", "text": "你好！我是一个围绕你文档学习的学习助手。"}
        yield {
            "type": "done",
            "citations": [],
            "sources": [],
            "suggestions": [],
        }
    except Exception as exc:  # noqa: BLE001
        yield from emit(f"回应失败：{exc}", [])


def _ask_clarify(doc_id: str | None = None):
    """提问过于笼统：列出现有章节结构，请用户指明想学哪一部分。"""
    from . import db, study

    target = study.resolve_target(doc_id)
    lines: list[str] = []
    if target:
        doc = db.get_document(target)
        outline = study.get_outline(doc)
        if outline:
            for i, e in enumerate(outline):
                page = f"（第 {e['page']} 页起）" if e.get("page") else ""
                lines.append(f"{i + 1}. {e['title']}{page}")
    text = "这个问法有点笼统，你具体想学 / 问哪一部分呢？"
    if lines:
        text += "\n\n当前这份文档的章节结构如下，挑一个或直接报概念都行：\n" + "\n".join(lines)
    text += "\n\n或者直接把题目 / 原话发给我。"
    yield {"type": "delta", "text": text}
    yield {"type": "done", "citations": [], "sources": [], "suggestions": []}


def answer_stream(
    message: str,
    *,
    history: list[dict] | None = None,
    doc_id: str | None = None,
    doc_ids: list[str] | None = None,
    op: str | None = None,
):
    """Yields dicts serialised as JSON lines (NDJSON)."""
    no_key = not has_llm_key()
    if no_key:
        yield {
            "type": "error",
            "text": "还没有配置 DeepSeek API Key，请在 backend/.env 里填写 DEEPSEEK_API_KEY。",
        }
        return

    if doc_ids is None and doc_id is not None:
        doc_ids = [doc_id]
    effective_doc = doc_ids[0] if doc_ids and len(doc_ids) == 1 else None

    from . import study

    # 前端 Studio 工具传入显式 op 时直接路由，结果稳定，不依赖正则/意图判断。
    if op in study.STUDY_OPS:
        yield from study.answer_study_stream(op, message, doc_id=effective_doc)
        return

    study_op = study.detect_op(message)
    if study_op:
        yield from study.answer_study_stream(study_op, message, doc_id=effective_doc)
        return

    rewritten = _rewrite_question(history, message)

    from . import judge

    mode = judge.classify(rewritten)
    # 分类器误判防御：既然点明了章节/概念，主题就够明确，不该走"太笼统"的澄清
    if mode == "clarify" and judge.chapter_scoped(message):
        mode = "explain"
    if judge.is_study_op(mode):
        if judge.chapter_scoped(message):
            mode = "qa"
        else:
            yield from study.answer_study_stream(mode, message, doc_id=effective_doc)
            return
    if mode == "meta":
        yield from _meta_answer()
        return
    if mode == "clarify":
        yield from _ask_clarify(effective_doc)
        return

    system_prompt = EXPLAIN_PROMPT if mode == "explain" else SYSTEM_PROMPT

    try:
        vectors = embed_texts([rewritten])
    except Exception as exc:
        yield {"type": "error", "text": f"嵌入服务不可用，请检查模型端点配置：{exc}"}
        return
    if not vectors:
        yield {"type": "error", "text": "嵌入服务没有返回向量，请检查模型端点配置。"}
        return

    scope_doc = effective_doc
    scope_pages = None
    scope = study.chapter_scope(effective_doc, message)
    chapter_hint = None
    if scope:
        scope_doc, scope_pages = scope[0], (scope[1], scope[2])
        info = study.chapter_info(effective_doc, message)
        if info:
            chapter_hint = (
                f"（用户点名学习这一章：{info['label']}；{info['outline_line']}。"
                f"请用它把内容讲具体、讲出这一章的独特之处，别套通用模板。）"
            )

    results = retriever.search(
        vectors[0],
        query_text=rewritten,
        doc_id=scope_doc,
        doc_ids=doc_ids,
        page_range=scope_pages,
    )
    if not results:
        context = (
            "（本次没有检索到与问题直接相关的文档片段。"
            "请按你的规则判断：能补讲的就补讲，需要文档细节的请说明并引导，不要硬答。）"
        )
    else:
        context = _build_context(results)
    if chapter_hint:
        context = chapter_hint + "\n\n" + context

    chat_messages = [{"role": "system", "content": system_prompt}]
    if history:
        for h in history[-config.HISTORY_LIMIT :]:
            chat_messages.append(h)
    chat_messages.append(
        {"role": "user", "content": f"源材料：\n{context}\n\n问题：{rewritten}"}
    )

    try:
        stream = _get_client().chat.completions.create(
            model=chat_model(),
            messages=chat_messages,
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
        sm = _SUGGEST_RE.search(full_text)
        suggestions = []
        if sm:
            suggestions = [
                s.strip() for s in sm.group(1).split("|") if s.strip()
            ]

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
            "suggestions": suggestions,
        }

    except Exception as exc:  # noqa: BLE001
        yield {"type": "error", "text": f"请求失败：{exc}"}


# `answer()` 非流式兜底已删除：无任何调用方，且与主路径 answer_stream() 的
# judge/rewrite/study 分流行为不一致，保留只会让 CLI/测试路径给出不同结果。