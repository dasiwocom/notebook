import os
from pathlib import Path

from dotenv import load_dotenv

_BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(_BASE_DIR / ".env")

DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
CHAT_MODEL = os.getenv("CHAT_MODEL", "deepseek-chat")

EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "local")
LOCAL_EMBEDDING_MODEL = os.getenv(
    "LOCAL_EMBEDDING_MODEL", "BAAI/bge-small-zh-v1.5"
)
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "http://localhost:11434/v1")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "ollama")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")

# bge-small-zh-v1.5 的 max_seq_length 约 512 token；中文约 1 字 1 token，
# 因此 chunk 上限须远小于 1500，否则每块后半内容会被 fastembed 静默截断、检索不到。
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "500"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "100"))
TOP_K = int(os.getenv("TOP_K", "5"))
CANDIDATE_K = int(os.getenv("CANDIDATE_K", "20"))
MMR_LAMBDA = float(os.getenv("MMR_LAMBDA", "0.7"))
RERANKER_MODEL = os.getenv("RERANKER_MODEL", "BAAI/bge-reranker-base")
HISTORY_LIMIT = int(os.getenv("HISTORY_LIMIT", "6"))

DB_PATH = os.getenv("DB_PATH") or str(_BASE_DIR / "data" / "app.db")
PORT = int(os.getenv("PORT", "8000"))

# 上传文件大小上限（默认 100MB），防止大文件 OOM / 撑爆磁盘。
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(100 * 1024 * 1024)))

# 本地 API 访问令牌：设置后所有 /api 请求须带 Authorization: Bearer <token>。
# Electron 桌面版启动时自动生成随机 token 注入；纯 Web 部署请自行在 .env 配置。
NOTEBOOK_TOKEN = os.getenv("NOTEBOOK_TOKEN", "")

PDF_DATA_DIR = Path(os.getenv("PDF_DATA_DIR") or str(_BASE_DIR / "data" / "pdf"))
PDF_PAGES_DIR = Path(os.getenv("PDF_PAGES_DIR") or str(_BASE_DIR / "data" / "pdfpages"))
PDF_OCR_DIR = Path(os.getenv("PDF_OCR_DIR") or str(_BASE_DIR / "data" / "pdf_ocr"))
PDF_PAGE_DPI = int(os.getenv("PDF_PAGE_DPI", "110"))
OCR_DPI = int(os.getenv("OCR_DPI", "110"))
OCR_MIN_BODY_CHARS = int(os.getenv("OCR_MIN_BODY_CHARS", "20"))
OCR_WORKERS = int(os.getenv("OCR_WORKERS", "2"))
OCR_PARTIAL_EVERY = int(os.getenv("OCR_PARTIAL_EVERY", "40"))

STUDY_TOC_PATH = os.getenv("STUDY_TOC_PATH") or str(_BASE_DIR / "data" / "tocs.json")