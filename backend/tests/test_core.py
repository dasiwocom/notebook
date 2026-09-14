"""核心纯函数单元测试：切块 / 中文数字 / 引用解析 / 向量编解码 / MMR。"""

import numpy as np

from app.chunker import chunk_markdown
from app.study import _cn_to_int
from app.chat import _parse_citations, _citation_overlap, _build_context
from app.db import _encode_embedding, _decode_embedding
from app.retriever import _mmr_select


def test_cn_to_int():
    assert _cn_to_int("十") == 10
    assert _cn_to_int("十五") == 15
    assert _cn_to_int("二十") == 20
    assert _cn_to_int("二十五") == 25
    assert _cn_to_int("三十三") == 33
    assert _cn_to_int("八") == 8


def test_chunk_by_heading():
    md = "# 第一章\n这是第一章内容。\n\n## 第一节\n第一节内容。"
    chunks = chunk_markdown(md, max_chars=500, overlap=100)
    assert len(chunks) == 2
    assert chunks[0]["path"] == ["第一章"]
    assert chunks[1]["path"] == ["第一章", "第一节"]


def test_chunk_size_limit():
    md = "# 标题\n" + "长文本" * 300  # 900 字
    chunks = chunk_markdown(md, max_chars=500, overlap=100)
    # 超过上限应被切分
    assert len(chunks) >= 2
    assert all(len(c["text"]) <= 500 + 20 for c in chunks)  # 允许轻微超界（切到换行）


def test_parse_citations_dense_and_verified():
    results = [
        {"chunk_id": 1, "doc_id": "d", "doc_name": "书", "path": ["第 1 页"], "text": "NVIC 中断优先级分组与子优先级。", "score": 0.9},
        {"chunk_id": 2, "doc_id": "d", "doc_name": "书", "path": ["第 2 页"], "text": "抢占优先级高者可以打断低者。", "score": 0.8},
        {"chunk_id": 3, "doc_id": "d", "doc_name": "书", "path": ["第 3 页"], "text": "操作系统进程调度的轮转算法。", "score": 0.5},
    ]
    answer = "NVIC 的中断优先级先比抢占优先级[source:0]，高者可打断低者[source:1]。"
    cits = _parse_citations(answer, results)
    # 密集顺序、带 source 索引、相关引用 verified=True
    assert [c["source"] for c in cits] == [0, 1]
    assert all(c["verified"] for c in cits)
    # 无关 chunk 与答案几乎零重叠
    assert _citation_overlap(answer, results[2]["text"]) < 0.05


def test_parse_citations_skips_invalid_index():
    results = [{"chunk_id": 1, "doc_id": "d", "doc_name": "书", "path": [], "text": "内容", "score": 0.9}]
    cits = _parse_citations("引用[source:5]", results)  # 越界
    assert cits == []


def test_embedding_roundtrip():
    v = [0.1, -0.2, 0.3, 0.4, 0.0]
    raw = _encode_embedding(v)
    back = _decode_embedding(raw)
    assert len(raw) == len(v) * 4  # float32
    assert all(abs(a - b) < 1e-6 for a, b in zip(v, back))


def test_decode_legacy_json_embedding():
    import json
    v = [0.1, 0.2, 0.3]
    back = _decode_embedding(json.dumps(v))  # 旧 JSON 文本格式
    assert back == v


def test_mmr_select_diversifies():
    cands = [
        {"score": 0.95, "chunk_id": 1},
        {"score": 0.9, "chunk_id": 2},
        {"score": 0.8, "chunk_id": 3},
    ]
    # 两两完全相似（冗余）
    sims = np.array([[0.0, 1.0, 1.0], [1.0, 0.0, 1.0], [1.0, 1.0, 0.0]], dtype=np.float32)
    out = _mmr_select(cands, sims, lam=0.7, top_k=2)
    assert len(out) == 2
    assert out[0]["chunk_id"] == 1  # 最高分先选


def test_build_context_budget():
    results = [
        {"doc_name": "书", "path": ["第 1 页"], "text": "A" * 100},
        {"doc_name": "书", "path": ["第 2 页"], "text": "B" * 100},
    ]
    ctx = _build_context(results)
    assert "[source:0]" in ctx and "[source:1]" in ctx
