"""Local, incremental PDF audit. Never promotes text guesses to training labels."""
import argparse
import collections
import hashlib
import html
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATEGORIES = {
    'plan': r'平面布置|家具定位|原始平面|原始结构|FURNISHING\s*PLAN|FLOOR\s*PLAN',
    'elevation': r'立面图|ELEVATION',
    'render': r'效果图|效果展示|RENDERING|PERSPECTIVE',
    'construction': r'天花|配电|铺装|节点|大样|施工说明|物料表|灯具定位|插座',
    'contents': r'图纸目录|图\s*纸\s*目\s*录|DRAWING\s*INDEX',
}

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf8')

def reference_files(ref):
    entries = git('ls-tree', '-rz', ref, '--', '各门店图纸').split(b'\0')
    indexed = []
    for entry in entries:
        if entry:
            info, name = entry.split(b'\t', 1)
            if name.lower().endswith(b'.pdf'):
                indexed.append((info.split()[2], name))
    batch = subprocess.check_output(['git', 'cat-file', '--batch'], cwd=ROOT,
                                    input=b''.join(oid+b'\n' for oid, _ in indexed))
    files = []
    offset = 0
    for oid, name in indexed:
        end = batch.index(b'\n', offset)
        header = batch[offset:end].split()
        size = int(header[2])
        blob = batch[end+1:end+1+size].decode('utf8')
        offset = end+size+2
        match = re.search(r'oid sha256:([0-9a-f]{64})\nsize (\d+)', blob)
        if not match:
            raise ValueError('Expected LFS pointer: ' + name.decode('utf8'))
        files.append({'path': name.decode('utf8'), 'expected_sha256': match[1], 'expected_bytes': int(match[2])})
    return files

def classify(text):
    compact = re.sub(r'\s+', '', text)
    kinds = [key for key, pattern in CATEGORIES.items() if re.search(pattern, text, re.I) or re.search(pattern, compact, re.I)]
    # A contents page mentions many drawing titles, not actual training images.
    if 'contents' in kinds:
        kinds = ['contents']
    if len(compact) < 40:
        kinds.append('image_or_sparse_text')
    return kinds or ['unclassified']

def scan_pdf(path, sha, cache):
    import fitz
    cached = cache / (sha + '.json')
    if cached.exists():
        previous = json.loads(cached.read_text(encoding='utf8'))
        if previous.get('classifier_version') == 2:
            return previous
    pages = []
    fitz.TOOLS.mupdf_warnings(reset=True)
    with fitz.open(path) as doc:
        warnings = fitz.TOOLS.mupdf_warnings(reset=True)
        if doc.needs_pass:
            raise ValueError('Password protected PDF')
        for n, page in enumerate(doc):
            text = page.get_text('text')
            page_warnings = fitz.TOOLS.mupdf_warnings(reset=True)
            kinds = classify(text)
            pages.append({'page': n + 1, 'width_pt': page.rect.width, 'height_pt': page.rect.height,
                          'rotation': page.rotation, 'text_chars': len(text.strip()),
                          'text_sha256': hashlib.sha256(text.encode()).hexdigest(),
                          'candidate_types': kinds, 'text_excerpt': text[:3000],
                          'parse_warnings': page_warnings,
                          'si_text_candidates': sorted(set(re.findall(r'SI\s*[12](?:\.0)?', text, re.I))),
                          'review_status': 'pending_visual_review', 'training_eligible': False})
    result = {'sha256': sha, 'pages': pages, 'page_count': len(pages), 'classifier_version': 2,
              'parse_warnings': warnings, 'pages_with_warnings': sum(bool(p['parse_warnings']) for p in pages)}
    write_json(cached, result)
    return result

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ref', default='origin/main')
    ap.add_argument('--out', default='素材库/04_training/corpus-audit-4070')
    ap.add_argument('--scan', action='store_true')
    args = ap.parse_args()
    out = ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)
    cache = out / 'page-index'
    cache.mkdir(exist_ok=True)
    catalog = json.loads((ROOT/'素材库/01_catalog/classification/stores.json').read_text(encoding='utf8'))
    by_name = {row['file']: row for row in catalog}
    ignored = {row['file'] for row in json.loads((ROOT/'素材库/01_catalog/classification/ignored-conflicts.json').read_text(encoding='utf8'))}
    rows, totals, kinds, samples, hashes = [], collections.Counter(), collections.Counter(), [], collections.defaultdict(list)
    if (out/'visual-samples.json').exists():
        samples = json.loads((out/'visual-samples.json').read_text(encoding='utf8'))
    refs = reference_files(args.ref)
    for i, row in enumerate(refs):
        path = ROOT / row['path']
        old = by_name.get(path.name, {})
        row.update(store_id=old.get('id'), master_record_id=old.get('recordId'),
                   master_si=old.get('si'), master_shop_type=old.get('shopType'),
                   label_status='historical_pdf_version_unverified', excluded_conflict=path.name in ignored)
        if not path.exists():
            row['status'] = 'missing'
        elif path.stat().st_size < 1024 and path.read_bytes().startswith(b'version https://git-lfs'):
            row['status'] = 'lfs_pointer_only'
        else:
            sha = digest(path)
            row['actual_sha256'] = sha
            row['status'] = 'verified' if sha == row['expected_sha256'] else 'hash_mismatch_preserve_local'
            if row['status'] == 'verified':
                hashes[sha].append(row['path'])
                if args.scan:
                    try:
                        index = scan_pdf(path, sha, cache)
                        row['page_count'] = index['page_count']
                        row['parse_warning'] = bool(index['parse_warnings'] or index['pages_with_warnings'])
                        row['pages_with_warnings'] = index['pages_with_warnings']
                        totals['pdfs_with_warnings'] += int(row['parse_warning'])
                        totals['pages_with_warnings'] += index['pages_with_warnings']
                        row['page_index'] = 'page-index/' + sha + '.json'
                        totals['pages'] += index['page_count']
                        row['candidate_type_counts'] = dict(collections.Counter(k for p in index['pages'] for k in p['candidate_types']))
                        kinds.update(row['candidate_type_counts'])
                        # One representative per file; fill heterogeneous review sheet.
                        for page in index['pages']:
                            key = page['candidate_types'][0]
                            if sum(s['category'] == key for s in samples) < 2 and len(samples) < 14:
                                samples.append({'path': row['path'], 'store_id': row['store_id'], 'page': page['page'], 'category': key})
                                break
                    except Exception as exc:
                        row['status'] = 'pdf_parse_error'
                        row['error'] = str(exc)
        totals[row['status']] += 1
        rows.append(row)
        if (i+1) % 25 == 0:
            print(f'{i+1}/{len(refs)} {dict(totals)}', flush=True)
    registered = {Path(r['path']).name for r in refs}
    absent = [{'store_id': r['id'], 'file': r['file']} for r in catalog if r['file'] not in registered]
    summary = {'git_revision': git('rev-parse', args.ref).decode().strip(), 'remote_pdf_entries': len(refs),
               'catalog_entries': len(catalog), 'catalog_files_absent_from_git': len(absent),
               'counts': dict(totals), 'page_type_candidate_counts': dict(kinds),
               'duplicate_file_groups': [v for v in hashes.values() if len(v)>1],
               'training_eligible_new_pages': 0,
               'note': 'Text classes are candidates only. Visual review, source version, store identity and region annotations are required. No original files altered.'}
    write_json(out/'files.json', rows)
    write_json(out/'summary.json', summary)
    write_json(out/'missing-from-github.json', absent)
    write_json(out/'unavailable-local.json', [r for r in rows if r['status'] != 'verified'])
    if args.scan:
        import fitz
        panels = []
        reviewed = {}
        if (out/'visual-review.json').exists():
            reviewed = {(r['store_id'],r['page']):r for r in json.loads((out/'visual-review.json').read_text(encoding='utf8'))['samples']}
        for n, sample in enumerate(samples):
            with fitz.open(ROOT/sample['path']) as doc:
                page = doc[sample['page']-1]
                pix = page.get_pixmap(matrix=fitz.Matrix(900/max(page.rect.width,page.rect.height),900/max(page.rect.width,page.rect.height)), alpha=False)
                img = f'review-{n:02d}.png'
                pix.save(out/img)
            sample['image'] = img
            review = reviewed.get((sample['store_id'],sample['page']))
            decision = f'<p>视觉复核：{html.escape(review["actual_type"])} — {html.escape(review["evidence"])}</p>' if review else '<p>待视觉复核</p>'
            panels.append(f'<article><h3>文本候选 {html.escape(sample["category"])} · {html.escape(str(sample["store_id"]))} · p{sample["page"]}</h3><p>{html.escape(sample["path"])}</p>{decision}<img src="{img}"></article>')
        write_json(out/'visual-samples.json', samples)
        (out/'review.html').write_text('<!doctype html><meta charset="utf-8"><title>PDF 逐页抽查</title><style>body{font-family:system-ui;margin:32px;background:#eee}main{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:white;padding:16px}img{width:100%}</style><h1>PDF 逐页抽查：自动候选，尚未批准训练</h1><p>页面类别可以混合，效果图需单独裁切，平面图需尺寸和几何标注。同店全部版本/视角必须在同一数据划分。</p><main>'+''.join(panels)+'</main>',encoding='utf8')
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)

if __name__ == '__main__':
    main()
