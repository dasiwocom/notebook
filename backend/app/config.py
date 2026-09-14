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

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "1500"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "200"))
TOP_K = int(os.getenv("TOP_K", "5"))
CANDIDATE_K = int(os.getenv("CANDIDATE_K", "20"))
MMR_LAMBDA = float(os.getenv("MMR_LAMBDA", "0.7"))
RERANKER_MODEL = os.getenv("RERANKER_MODEL", "BAAI/bge-reranker-base")
HISTORY_LIMIT = int(os.getenv("HISTORY_LIMIT", "6"))

DB_PATH = os.getenv("DB_PATH") or str(_BASE_DIR / "data" / "app.db")
PORT = int(os.getenv("PORT", "8000"))

PDF_DATA_DIR = Path(os.getenv("PDF_DATA_DIR") or str(_BASE_DIR / "data" / "pdf"))
PDF_PAGES_DIR = Path(os.getenv("PDF_PAGES_DIR") or str(_BASE_DIR / "data" / "pdfpages"))
PDF_OCR_DIR = Path(os.getenv("PDF_OCR_DIR") or str(_BASE_DIR / "data" / "pdf_ocr"))
PDF_PAGE_DPI = int(os.getenv("PDF_PAGE_DPI", "110"))
OCR_DPI = int(os.getenv("OCR_DPI", "110"))
OCR_MIN_BODY_CHARS = int(os.getenv("OCR_MIN_BODY_CHARS", "20"))
OCR_WORKERS = int(os.getenv("OCR_WORKERS", "2"))
OCR_PARTIAL_EVERY = int(os.getenv("OCR_PARTIAL_EVERY", "40"))

STUDY_TOC_PATH = os.getenv("STUDY_TOC_PATH") or str(_BASE_DIR / "data" / "tocs.json")