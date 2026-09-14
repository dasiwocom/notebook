import asyncio
import threading

from . import config


class Reranker:
    """Cross-encoder reranker built on infinity-emb (onnxruntime).

    The dependency is optional: if it cannot be imported or the model
    cannot be loaded, ``rerank()`` returns ``None`` and callers fall back
    to the heuristic boost path.
    """

    def __init__(self) -> None:
        self._engine = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._error: str | None = None
        self._init_lock = threading.Lock()
        self._started = False

    def _ensure(self) -> None:
        if self._engine is not None or self._error is not None:
            return
        with self._init_lock:
            if self._engine is not None or self._error is not None or self._started:
                return
            self._started = True
        try:
            from infinity_emb import RerankEngine

            self._loop = asyncio.new_event_loop()
            thread = threading.Thread(
                target=self._loop.run_forever, daemon=True, name="reranker-loop"
            )
            thread.start()
            fut = asyncio.run_coroutine_threadsafe(
                self._start(RerankEngine), self._loop
            )
            fut.result(timeout=300)
        except Exception as exc:  # noqa: BLE001
            self._error = f"reranker 不可用：{exc}"

    async def _start(self, engine_cls) -> None:
        self._engine = engine_cls(
            model_name_or_path=config.RERANKER_MODEL,
            provider="onnx",
            device="cpu",
        )

    def rerank(self, query: str, passages: list[str]) -> list[float] | None:
        self._ensure()
        engine = self._engine
        if engine is None or self._loop is None:
            return None
        try:
            fut = asyncio.run_coroutine_threadsafe(
                engine.rank(query=query, docs=passages), self._loop
            )
            scores = fut.result(timeout=120)
            return [float(s) for s in scores]
        except Exception:  # noqa: BLE001
            return None


reranker = Reranker()