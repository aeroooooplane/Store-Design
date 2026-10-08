"""End-to-end acceptance checks for the local split/clean corpus."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import time
import fitz

ROOT=Path(__file__).resolve().parents[2]

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--out',default='资源库/90_处理过程与审核/PDF拆分')
    args=ap.parse_args()
    out=ROOT/args.out
    started=time.time()
    sources=json.loads((ROOT/'资源库/99_历史归档/训练实验/corpus-audit-4070/files.json').read_text(encoding='utf8'))
    sources=[r for r in sources if r['status']=='verified']
    summary=json.loads((out/'summary.json').read_text(encoding='utf8'))
    assert summary['complete'], 'Split run incomplete'
    assert json.loads((out/'export-errors.json').read_text(encoding='utf8'))==[], 'Export errors unresolved'
    pages=[json.loads(line) for line in (out/'manifest.jsonl').read_text(encoding='utf8').splitlines()]
    assert len(pages)==summary['single_page_pdfs']
    assert len({p['id'] for p in pages})==len(pages)
    assert all(not p['training_eligible'] and p['split']=='unassigned' for p in pages)
    represented={}
    for p in pages:
        for alias in p['source_aliases']:
            represented.setdefault(alias['path'],[]).append(p['source_page'])
    assert set(represented)=={s['path'] for s in sources}
    for source in sources:
        assert sorted(represented[source['path']])==list(range(1,source['page_count']+1)),source['path']
    def verify_source(source):
        assert digest(ROOT/source['path'])==source['expected_sha256'],source['path']
        return True
    with ThreadPoolExecutor(max_workers=3) as executor:
        assert all(executor.map(verify_source,sources))
    fitz.TOOLS.mupdf_display_errors(False)
    fitz.TOOLS.mupdf_display_warnings(False)
    # MuPDF documents stay on this thread; hashing source files above is independent.
    for i,p in enumerate(pages):
        target=out/p['pdf']
        assert target.resolve().is_relative_to(out.resolve())
        assert digest(target)==p['pdf_sha256'],p['id']
        with fitz.open(target) as doc:
            assert len(doc)==1,p['id']
            assert abs(doc[0].rect.width-p['width_pt'])<.01,p['id']
            assert abs(doc[0].rect.height-p['height_pt'])<.01,p['id']
            assert doc[0].rotation==p['rotation'],p['id']
        assert (out/p['preview']).exists(),p['id']
        for region in p['region_candidates']:
            assert (out/region['path']).exists(),p['id']
        if (i+1)%2000==0:
            print(f'Verified {i+1}/{len(pages)} single-page PDFs',flush=True)
    native=[json.loads(line) for line in (out/'native-catalog/unique-images.jsonl').read_text(encoding='utf8').splitlines()]
    assert len({r['sha256'] for r in native})==len(native)
    for row in native:
        assert digest(out/row['path'])==row['sha256']
        assert not row['training_eligible']
        if not row['decode_verified']:
            assert row['review_status']=='quarantine'
    class Links(HTMLParser):
        def __init__(self,base):
            super().__init__()
            self.base=base
            self.count=0
        def handle_starttag(self,tag,attrs):
            for name,value in attrs:
                if name in ('href','src') and value and not value.startswith(('https:','http:','#')):
                    assert (self.base/value).exists(),str(self.base/value)
                    self.count+=1
    link_count=0
    for path in out.rglob('*.html'):
        links=Links(path.parent)
        links.feed(path.read_text(encoding='utf8'))
        link_count+=links.count
    result={'state':'passed','source_hashes_unchanged':len(sources),'source_pages_accounted_for':sum(len(v) for v in represented.values()),
            'single_page_pdfs_reopened_and_hashed':len(pages),'unique_native_image_hashes_checked':len(native),
            'quarantined_native_decode_failures':sum(not r['decode_verified'] for r in native),'local_html_links_checked':link_count,
            'training_eligible':0,'elapsed_seconds':round(time.time()-started,2),
            'scope':'Structural/content-hash checks are complete; visual semantics and SI versions are not fully reviewed.'}
    (out/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':
    main()
