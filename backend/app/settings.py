"""运行时设置覆盖（对 .env 的界面级覆盖，无需重启即可生效）。

存于 data/settings.json（不在 git 里）。.env / config.py 里的值仍作为
默认值；这里只保存用户在界面里改过的键。save() 会 bump version，
热路径（chat/judge/study/embeddings/retriever）据此判断要不要重建
客户端 / 重新取值。
"""

import json
import threading
from pathlib import Path

from . import config

_SETTINGS_PATH: Path = Path(config.DB_PATH).parent / "settings.json"

_lock = threading.Lock()
_data: dict = {}
_version = 0


def _load() -> None:
    global _data
    if _SETTINGS_PATH.exists():
        try:
            _data = json.loads(_SETTINGS_PATH.read_text(encoding="utf-8"))
            if not isinstance(_data, dict):
                _data = {}
        except (json.JSONDecodeError, OSError):
            _data = {}
    else:
        _data = {}


def ensure_file() -> None:
    """首页打开时调用一次：确保 settings.json 存在（空 {}）。"""
    if not _SETTINGS_PATH.exists():
        _SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        _SETTINGS_PATH.write_text("{}", encoding="utf-8")


def version() -> int:
    return _version


def get(key: str, default=None):
    """返回运行时覆盖值；未覆盖时返回默认值。"""
    with _lock:
        return _data.get(key, default)


def get_int(key: str, default: int) -> int:
    try:
        return int(get(key, default))
    except (TypeError, ValueError):
        return default


def get_float(key: str, default: float) -> float:
    try:
        return float(get(key, default))
    except (TypeError, ValueError):
        return default


def has(key: str) -> bool:
    with _lock:
        return key in _data


def _has_key(src: dict, key: str) -> bool:
    v = src.get(key)
    return bool(isinstance(v, str) and v.strip())


def effective() -> dict:
    """合并默认值 + 覆盖值的“生效配置”（供 GET /api/settings）。

    API key 不回传原文，只给 *_SET 布尔标志。
    """
    merged = {
        "DEEPSEEK_BASE_URL": config.DEEPSEEK_BASE_URL,
        "DEEPSEEK_API_KEY": config.DEEPSEEK_API_KEY,
        "CHAT_MODEL": config.CHAT_MODEL,
        "EMBEDDING_PROVIDER": config.EMBEDDING_PROVIDER,
        "LOCAL_EMBEDDING_MODEL": config.LOCAL_EMBEDDING_MODEL,
        "OPENAI_BASE_URL": config.OPENAI_BASE_URL,
        "OPENAI_API_KEY": config.OPENAI_API_KEY,
        "EMBEDDING_MODEL": config.EMBEDDING_MODEL,
        "TOP_K": config.TOP_K,
        "CANDIDATE_K": config.CANDIDATE_K,
        "MMR_LAMBDA": config.MMR_LAMBDA,
    }
    merged.update(_data)
    return {
        "DEEPSEEK_BASE_URL": merged["DEEPSEEK_BASE_URL"],
        "CHAT_MODEL": merged["CHAT_MODEL"],
        "EMBEDDING_PROVIDER": merged["EMBEDDING_PROVIDER"],
        "LOCAL_EMBEDDING_MODEL": merged["LOCAL_EMBEDDING_MODEL"],
        "OPENAI_BASE_URL": merged["OPENAI_BASE_URL"],
        "EMBEDDING_MODEL": merged["EMBEDDING_MODEL"],
        "TOP_K": merged["TOP_K"],
        "CANDIDATE_K": merged["CANDIDATE_K"],
        "MMR_LAMBDA": merged["MMR_LAMBDA"],
        "DEEPSEEK_API_KEY_SET": _has_key(merged, "DEEPSEEK_API_KEY"),
        "OPENAI_API_KEY_SET": _has_key(merged, "OPENAI_API_KEY"),
    }


def save(patch: dict) -> dict:
    """把 patch 合并进设置文件并落盘。

    - 缺失键：保持不变
    - 值非空字符串：覆盖
    - 值为空字符串：删除覆盖（回退到 .env 默认）
    返回更新后的有效配置。
    """
    global _version
    with _lock:
        changed = False
        for k, v in patch.items():
            if v is None:
                continue
            if isinstance(v, str):
                v = v.strip()
            if not v:
                if k in _data:
                    del _data[k]
                    changed = True
                continue
            if _data.get(k) != v:
                _data[k] = v
                changed = True
        if changed:
            _SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
            _SETTINGS_PATH.write_text(
                json.dumps(_data, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            _version += 1
    return effective()


_load()