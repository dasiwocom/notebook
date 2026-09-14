import math
import re
from typing import Any

import numpy as np

from . import config, db, settings
from .reranker import reranker


def _bigrams(text: str) -> set[str]:
    """字符级 bigram（中文无词边界，用字符 n-gram 做词法匹配）。"""
    chars = [c for c in text.lower() if not c.isspace()]
    return {"".join(chars[i : i + 2]) for i in range(max(0, len(chars) - 1))}


def _lexical_fuzzy(q: str, passages: list[str]) -> list[float]:
    """字符 bigram 的 F1 相似度 —— cross-encoder 不可用时的回退重排。

    同时考虑「查询词覆盖」（召回）与「命中密度」（精确），比单纯覆盖率更稳，
    避免长段落因碰巧含更多查询字而被高估。
    """
    qg = _bigrams(q)
    if not qg:
        return [0.0] * len(passages)
    out: list[float] = []
    for p in passages:
        pg = _bigrams(p)
        if not pg:
            out.append(0.0)
            continue
        inter = len(qg & pg)
        prec = inter / len(pg)
        rec = inter / len(qg)
        out.append(2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0)
    return out


_PAGE_RE = re.compile(r"第\s*(\d+)\s*页")


def _page_of(path: list[str]) -> int | None:
    if not path:
        return None
    m = _PAGE_RE.search(path[0])
    return int(m.group(1)) if m else None


def _mmr_select(
    cands: list[dict],
    sims: np.ndarray,
    lam: float,
    top_k: int,
) -> list[dict]:
    """Greedy maximal marginal relevance: score = λ*rel − (1−λ)*max_sim_to_chosen."""
    n = len(cands)
    chosen: list[int] = []
    remaining = list(range(n))
    while len(chosen) < top_k and remaining:
        best = -1
        best_v = -float("inf")
        for i in remaining:
            if chosen:
                red = max(sims[i][j] for j in chosen)
            else:
                red = 0.0
            v = lam * cands[i]["score"] - (1.0 - lam) * red
            if v > best_v:
                best_v = v
                best = i
        chosen.append(best)
        remaining.remove(best)
    return [cands[i] for i in chosen]


class Retriever:
    def __init__(self) -> None:
        self._chunk_ids: list[int] = []
        self._doc_ids: list[str] = []
        self._doc_names: list[str] = []
        self._paths: list[list[str]] = []
        self._texts: list[str] = []
        self._matrix: np.ndarray | None = None
        self._norm: np.ndarray | None = None
        # BM25 词法索引（混合检索）
        self._bigram_df: dict[str, int] = {}
        self._chunk_bigrams: list[set[str]] = []
        self._chunk_len: list[int] = []
        self.reload()

    def reload(self) -> None:
        rows = db.get_indexed_chunks()
        self._chunk_ids = [r["id"] for r in rows]
        self._doc_ids = [r["doc_id"] for r in rows]
        self._doc_names = [r["doc_name"] for r in rows]
        self._paths = [r["path"] for r in rows]
        self._texts = [r["text"] for r in rows]
        self._row_index = {int(r["id"]): i for i, r in enumerate(rows)}
        if rows:
            self._matrix = np.array([r["embedding"] for r in rows], dtype=np.float32)
            self._norm = self._matrix / (
                np.linalg.norm(self._matrix, axis=1, keepdims=True) + 1e-9
            )
        else:
            self._matrix = None
            self._norm = None
        # 构建字符 bigram 的 BM25 词法索引
        self._bigram_df = {}
        self._chunk_bigrams = []
        self._chunk_len = []
        for r in rows:
            g = _bigrams(r["text"])
            self._chunk_bigrams.append(g)
            self._chunk_len.append(len(r["text"]))
            for bg in g:
                self._bigram_df[bg] = self._bigram_df.get(bg, 0) + 1

    def _bm25_scores(self, query: str) -> np.ndarray:
        """字符 bigram BM25 打分（全库）。"""
        n = len(self._chunk_ids)
        qg = _bigrams(query)
        if n == 0 or not qg:
            return np.zeros(n, dtype=np.float32)
        avgdl = sum(self._chunk_len) / n
        k1, b = 1.5, 0.75
        scores = np.zeros(n, dtype=np.float32)
        for g in qg:
            df = self._bigram_df.get(g, 0)
            if df == 0:
                continue
            idf = math.log((n - df + 0.5) / (df + 0.5) + 1.0)
            for i in range(n):
                if g in self._chunk_bigrams[i]:
                    dl = self._chunk_len[i] or 1
                    tf = 1.0  # 字符 bigram 二元命中即可
                    scores[i] += idf * (tf * (k1 + 1.0)) / (tf + k1 * (1.0 - b + b * dl / avgdl))
        return scores

    def _fused_order(self, dense: np.ndarray, query: str) -> np.ndarray:
        """dense 与 BM25 用 RRF 融合排序：兼顾语义相关与精确关键词召回。"""
        bm25 = self._bm25_scores(query)
        k = 60
        rrf: dict[int, float] = {}
        for rank, i in enumerate(np.argsort(dense)[::-1][:200]):
            rrf[int(i)] = rrf.get(int(i), 0.0) + 1.0 / (k + rank)
        for rank, i in enumerate(np.argsort(bm25)[::-1][:200]):
            rrf[int(i)] = rrf.get(int(i), 0.0) + 1.0 / (k + rank)
        order = sorted(rrf.keys(), key=lambda i: -rrf[i])
        return np.asarray(order, dtype=np.int64)

    def search(
        self,
        query_embedding: list[float],
        top_k: int | None = None,
        doc_id: str | None = None,
        query_text: str | None = None,
        page_range: tuple[int, int] | None = None,
        doc_ids: list[str] | None = None,
    ) -> list[dict]:
        if self._norm is None:
            return []
        if doc_ids is None and doc_id is not None:
            doc_ids = [doc_id]
        doc_filter = set(doc_ids) if doc_ids else None
        q = np.asarray(query_embedding, dtype=np.float32)
        q = q / (np.linalg.norm(q) + 1e-9)
        scores = self._norm @ q

        top_k = top_k or settings.get_int("TOP_K", config.TOP_K)
        candidate_k = max(
            settings.get_int("CANDIDATE_K", config.CANDIDATE_K), top_k
        )
        if query_text:
            order = self._fused_order(scores, query_text)  # 混合检索：dense + BM25
        else:
            order = np.argsort(scores)[::-1]
        order = order[: len(self._chunk_ids)]
        if order.size == 0:
            return []

        # 多文档时每文档限流：避免某本大书在候选阶段吃掉全部名额，
        # 导致 MMR 重排只能在单一文档内做、无法跨文档平衡。
        multi_doc = doc_filter is not None and len(doc_filter) > 1
        per_doc_cap = max(top_k, candidate_k // len(doc_filter)) if multi_doc else 0
        per_doc_count: dict[str, int] = {}

        selected = []
        for i in order:
            i = int(i)
            d = self._doc_ids[i]
            if doc_filter is not None and d not in doc_filter:
                continue
            if page_range is not None:
                pg = _page_of(self._paths[i])
                if pg is None or not (page_range[0] <= pg <= page_range[1]):
                    continue
            score = float(scores[i])
            if score < 0.1:
                if query_text:
                    continue  # 融合顺序非单调：跳过低 dense 片段继续
                break  # 纯 dense 顺序单调递减：低分即止
            if multi_doc and per_doc_count.get(d, 0) >= per_doc_cap:
                continue
            selected.append(
                {
                    "score": score,
                    "chunk_id": self._chunk_ids[i],
                    "doc_id": self._doc_ids[i],
                    "doc_name": self._doc_names[i],
                    "path": self._paths[i],
                    "text": self._texts[i],
                }
            )
            per_doc_count[d] = per_doc_count.get(d, 0) + 1
            if len(selected) >= candidate_k:
                break

        if not selected:
            return []
        if len(selected) > top_k:
            if query_text:
                reranked: list[float] | None = reranker.rerank(
                    query_text, [r["text"] for r in selected]
                )
                if reranked is not None:
                    for r, s in zip(selected, reranked):
                        r["score"] = (r["score"] + s * 2.0) / 3.0
                else:
                    lex = _lexical_fuzzy(query_text, [r["text"] for r in selected])
                    for r, s in zip(selected, lex):
                        r["score"] = (r["score"] + s * 1.2) / 2.0
                selected.sort(key=lambda r: r["score"], reverse=True)
            if len(selected) > top_k:
                idxs = [self._row_index[int(r["chunk_id"])] for r in selected]
                n = len(idxs)
                sims = np.zeros((n, n), dtype=np.float32)
                for a in range(n):
                    for b in range(a + 1, n):
                        s = float(np.dot(self._norm[idxs[a]], self._norm[idxs[b]]))
                        sims[a][b] = sims[b][a] = s
                return _mmr_select(
                    selected, sims, settings.get_float("MMR_LAMBDA", config.MMR_LAMBDA), top_k
                )
        return selected[:top_k]


retriever: Any = Retriever()