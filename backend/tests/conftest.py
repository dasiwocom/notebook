import os
import sys
import tempfile
from pathlib import Path

# 让测试使用临时数据库、从 backend 根目录导入 app 包，避免碰真实数据/真实 .env
_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR))
os.environ.setdefault("DB_PATH", str(Path(tempfile.mkdtemp()) / "test.db"))
os.environ.setdefault("PDF_DATA_DIR", str(Path(tempfile.mkdtemp())))
os.environ.setdefault("PDF_PAGES_DIR", str(Path(tempfile.mkdtemp())))
os.environ.setdefault("PDF_OCR_DIR", str(Path(tempfile.mkdtemp())))
