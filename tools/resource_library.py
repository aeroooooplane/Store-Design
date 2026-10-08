"""Resolve immutable source PDFs kept outside the repository."""
import json, os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
def source_pdf_root():
    config_path=ROOT/'resources.local.json'
    config=json.loads(config_path.read_text(encoding='utf-8-sig')) if config_path.exists() else {}
    value=os.environ.get('STORE_SOURCE_PDFS') or config.get('sourcePdfRoot')
    if not value: raise ValueError('Set STORE_SOURCE_PDFS or resources.local.json sourcePdfRoot; source PDFs are external.')
    return Path(value).resolve()
def source_pdf_path(value):
    return source_pdf_root()/Path(value).name
