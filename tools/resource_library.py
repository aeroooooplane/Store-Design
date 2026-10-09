"""Resolve source PDFs from the resource library, with optional local overrides."""
import json, os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
def source_pdf_root():
    config_path=ROOT/'resources.local.json'
    config=json.loads(config_path.read_text(encoding='utf-8-sig')) if config_path.exists() else {}
    value=os.environ.get('STORE_SOURCE_PDFS') or config.get('sourcePdfRoot') or '资源库/01_各门店原图纸'
    selected=Path(value)
    return (selected if selected.is_absolute() else ROOT/selected).resolve()
def source_pdf_path(value):
    return source_pdf_root()/Path(value).name
