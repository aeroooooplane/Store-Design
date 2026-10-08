"""Fresh-handle visual verification of pages flagged by the export pass."""
import importlib.util
import json
from pathlib import Path
import fitz
import numpy as np

spec=importlib.util.spec_from_file_location('clean',Path(__file__).with_name('clean-pdfs.py'))
clean=importlib.util.module_from_spec(spec)
spec.loader.exec_module(clean)
out=clean.ROOT/'output/pdf/cleaned-v2'
fitz.TOOLS.mupdf_display_errors(False)
fitz.TOOLS.mupdf_display_warnings(False)
results=[]
checks=[]
for path in sorted((out/'file-results').glob('*.json')):
    result=json.loads(path.read_text(encoding='utf8'))
    for page in result['pages']:
        review=page.get('visual_review') or {}
        if 'store_identity_mismatch_suspected' in page['flags'] and review.get('decision')!='exclude_and_check_store_identity':
            page['flags'].remove('store_identity_mismatch_suspected')
        if 'export_visual_difference' not in page['flags']:
            continue
        with fitz.open(clean.ROOT/page['source_pdf']) as source, fitz.open(out/page['pdf']) as exported:
            original=source[page['source_page']-1]
            scale=640/max(original.rect.width,original.rect.height)
            a=original.get_pixmap(matrix=fitz.Matrix(scale,scale),colorspace=fitz.csRGB,alpha=False)
            b=exported[0].get_pixmap(matrix=fitz.Matrix(scale,scale),colorspace=fitz.csRGB,alpha=False)
            same=a.width==b.width and a.height==b.height and a.samples==b.samples
            measurement={'id':page['id'],'match':same,'method':'fresh source and derivative handles, RGB 640px long edge'}
            if a.width==b.width and a.height==b.height:
                difference=np.abs(np.frombuffer(a.samples,dtype=np.uint8).astype(int)-np.frombuffer(b.samples,dtype=np.uint8).astype(int))
                measurement.update(max_difference=int(difference.max()),mean_difference=float(difference.mean()))
            checks.append(measurement)
            page['fresh_visual_recheck']=measurement
            if same:
                page['initial_export_visual_check']=page['export_visual_check']
                page['export_visual_check']='match'
                page['flags'].remove('export_visual_difference')
            print(json.dumps(measurement),flush=True)
    clean.dump(path,result)
    results.append(result)
sources=json.loads((clean.ROOT/'素材库/04_training/corpus-audit-4070/files.json').read_text(encoding='utf8'))
clean.dump(out/'fresh-visual-recheck.json',{'checks':checks,'matched':sum(c['match'] for c in checks),'remaining':sum(not c['match'] for c in checks)})
clean.aggregate(results,out,[r for r in sources if r['status']!='verified'],sum(r['status']=='verified' for r in sources))
