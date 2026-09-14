"""对话意图判断层（对标 NotebookLM 的"有判断力的学习助手"）。

用一次廉价模型调用，把用户问题分类成若干 dialog mode，
比正则更灵活地识别"讲概念 / 要澄清 / 寒暄"等需求，
避免所有问题都被塞进"严格检索问答"导致生硬拒答。
"""

from . import settings
from .chat import _get_client, chat_model, has_llm_key

MODES = ["qa", "explain", "study_plan", "key_points", "self_test", "meta", "clarify"]

_CLASSIFY_PROMPT = """你是对话意图分类器。根据用户的最新问题，从下面的类别中选最合适的一个，只输出类别名（不要输出其他任何字符）：

- qa: 用户想从文档中查具体事实、定义、结论、细节，要求回到文档原文
- explain: 用户想理解某个概念或原理，希望讲清楚、讲通俗，可能希望用比喻或大白话
- study_plan: 用户想对整个文档/课程做整体学习规划、梳理框架、快速入门（如"速通/怎么学/大纲/这本书讲了什么"）
- key_points: 用户想划重点、复习考点、考前准备（如"复习/重点/押题"）
- self_test: 用户想出题自测（如"自测/出几道题/考考我"）
- meta: 与文档内容无关的寒暄、询问助手功能（如"你好/你是谁/你能做什么"）
- clarify: 提问缺少明确主题，根本不知道用户想学/问哪一章或哪个概念时才用。注意：只要用户已点名具体章节或概念（如"第2章 / 第三章 / 中断系统 / 什么是Cache"），主题就足够明确，一律不要用 clarify，而要对应 explain 或 qa

用户问题：{question}"""

_MODE_RE = None


def _mode_re():
    global _MODE_RE
    if _MODE_RE is None:
        import re

        _MODE_RE = re.compile(r"\b(?:%s)\b" % "|".join(MODES))
    return _MODE_RE


def classify(question: str) -> str:
    """返回一个 mode；分类失败或不确定时返回 'qa'（保守默认）。"""
    if not has_llm_key():
        return "qa"
    try:
        resp = _get_client().chat.completions.create(
            model=chat_model(),
            messages=[
                {"role": "system", "content": "只输出一个类别名。"},
                {"role": "user", "content": _CLASSIFY_PROMPT.format(question=question)},
            ],
            temperature=0,
            max_tokens=16,
        )
        text = (resp.choices[0].message.content or "").strip().lower()
    except Exception:  # noqa: BLE001
        return "qa"
    m = _mode_re().search(text)
    return m.group(0) if m else "qa"


_STUDY_MODES = {"study_plan", "key_points", "self_test"}

_CHAPTER_REF_RE = None


def chapter_scoped(question: str) -> bool:
    """问题是否明确指向某一章/节（此时不宜切到整本书式的学习模式）。"""
    global _CHAPTER_REF_RE
    if _CHAPTER_REF_RE is None:
        import re

        _CHAPTER_REF_RE = re.compile(
            r"第\s*[\d一二三四五六七八九十百]+\s*[章节篇部分]"
        )
    return bool(_CHAPTER_REF_RE.search(question))


def is_study_op(mode: str) -> bool:
    return mode in _STUDY_MODES