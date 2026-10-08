"""Export reviewed page selections without rasterizing source PDF geometry.

Usage: python tools/resource-library/export_store_pdfs.py selection.json
Selection: {"source_id":"PDF-001", "store_id":"store-001", "version_id":"v1",
"approved":true, "reviewer":"name", "plan_pages":[14], "render_pages":[4,5]}
Page numbers are physical PDF pages, starting at 1. Existing outputs are never overwritten.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from resource_library import ROOT, source_pdf_path
from pypdf import PdfReader, PdfWriter


def validate_pages(pages, count):
    if not isinstance(pages, list) or any(type(p) is not int or not 1 <= p <= count for p in pages):
        raise ValueError('Pages must be a list of physical page numbers in range.')
    if len(set(pages)) != len(pages) or pages != sorted(pages):
        raise ValueError('Pages must be unique and in original page order.')
    return pages


def export(selection):
    if selection.get('approved') is not True or not str(selection.get('reviewer', '')).strip():
        raise ValueError('Reviewed page selection and reviewer are required.')
    for key in ('store_id', 'version_id'):
        if not re.fullmatch(r'[A-Za-z0-9_-]+', selection.get(key, '')):
            raise ValueError(f'{key} must contain only ASCII letters, digits, underscore or hyphen.')
    index = json.loads((ROOT/'资源库/00_资源索引/门店资源索引.json').read_text(encoding='utf-8'))
    record = next((r for r in index['sources'] if r['source_id'] == selection['source_id']), None)
    if not record:
        raise ValueError('Unknown source_id')
    source = source_pdf_path(record['source_file'])
    with source.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != record['sha256']:
        raise ValueError('Source hash differs from the resource index.')
    reader = PdfReader(source)
    outputs = []
    stem = selection['store_id']+'__'+selection['version_id']
    for key, folder, label in [('plan_pages','02_各门店平面图','平面图'), ('render_pages','03_各门店效果图','效果图')]:
        pages = validate_pages(selection.get(key, []), len(reader.pages))
        if pages:
            destination = ROOT/'资源库'/folder/(stem+'__'+label+'.pdf')
            outputs.append((destination, pages))
    if not outputs:
        raise ValueError('Select at least one page.')
    provenance = ROOT/'资源库/00_资源索引/选页记录'/(stem+'.json')
    if any(p.exists() for p in [provenance, *(p for p, _ in outputs)]):
        raise FileExistsError('This store/version already has output; choose a new version.')
    # Validate and assemble all outputs before publishing any of them.
    with TemporaryDirectory() as temporary:
        pending = []
        for i, (destination, pages) in enumerate(outputs):
            writer = PdfWriter()
            for page in pages:
                writer.add_page(reader.pages[page-1])
            staged = Path(temporary)/f'{i}.pdf'
            writer.write(staged)
            if len(PdfReader(staged).pages) != len(pages):
                raise ValueError('Export page count mismatch.')
            pending.append((staged, destination))
        for staged, destination in pending:
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open('xb') as stream:
                stream.write(staged.read_bytes())
        provenance.parent.mkdir(parents=True, exist_ok=True)
        with provenance.open('x', encoding='utf-8') as stream:
            json.dump({**selection, 'source_sha256': digest, 'source_file': record['source_file'],
                       'training_eligible': False,
                       'outputs': [p.relative_to(ROOT).as_posix() for p, _ in outputs]}, stream, ensure_ascii=False, indent=2)
    return [p for p, _ in outputs]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('selection', type=Path)
    args = parser.parse_args()
    for result in export(json.loads(args.selection.read_text(encoding='utf-8-sig'))):
        print(result)
