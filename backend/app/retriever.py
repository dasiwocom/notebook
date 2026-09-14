import re
from typing import Any

import numpy as np

from . import config, db, settings
from .reranker import reranker


def _lexical_fuzzy(q: str, passages: list[str]) -> list[float]:
    """Char bigram overlap similarity — cheap heuristic used as a fallback
    rerank when the cross-encoder is not available. Values in [0, 1]."""

    def grams(text: str) -> set[str]:
        s = text.lower()
        chars = [c for c in s if not c.isspace()]
        return {
            "".join(chars[i : i + 2])
            for i in range(max(0, len(chars) - 1))
        }

    qg = grams(q)
    if not qg:
        return [0.0] * len(passages)
    return [
        len(qg & grams(p)) / len(qg) if grams(p) else 0.0 for p in passages
    ]


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
        order = np.argsort(scores)[::-1]
        order = order[: len(self._chunk_ids)]
        if order.size == 0:
            return []

        selected = []
        for i in order:
            i = int(i)
            if doc_filter is not None and self._doc_ids[i] not in doc_filter:
                continue
            if page_range is not None:
                pg = _page_of(self._paths[i])
                if pg is None or not (page_range[0] <= pg <= page_range[1]):
                    continue
            score = float(scores[i])
            if score < 0.1:
                break
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