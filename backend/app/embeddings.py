from openai import OpenAI

import os

from . import config, settings

_openai_client: OpenAI | None = None
_openai_version: int = -1
_local_embedder: object | None = None
_local_model_key: str = ""


def _get_openai_client() -> OpenAI:
    global _openai_client, _openai_version
    ver = settings.version()
    if _openai_client is None or _openai_version != ver:
        _openai_client = OpenAI(
            base_url=settings.get("OPENAI_BASE_URL", config.OPENAI_BASE_URL),
            api_key=settings.get("OPENAI_API_KEY", config.OPENAI_API_KEY),
            timeout=60.0,
            max_retries=1,
        )
        _openai_version = ver
    return _openai_client


def _get_local_embedder():
    global _local_embedder, _local_model_key
    model = settings.get("LOCAL_EMBEDDING_MODEL", config.LOCAL_EMBEDDING_MODEL)
    if _local_embedder is None or _local_model_key != (model, settings.version()):
        os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
        os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
        from fastembed import TextEmbedding

        _local_embedder = TextEmbedding(model_name=model)
        _local_model_key = (model, settings.version())
    return _local_embedder


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    if settings.get("EMBEDDING_PROVIDER", config.EMBEDDING_PROVIDER) == "openai":
        resp = _get_openai_client().embeddings.create(
            model=settings.get("EMBEDDING_MODEL", config.EMBEDDING_MODEL),
            input=texts,
        )
        return [d.embedding for d in resp.data]
    return [list(map(float, v)) for v in _get_local_embedder().embed(texts)]