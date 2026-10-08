"""Deduplicate extracted native images and create a reviewable local catalogue."""
import argparse
import collections
from concurrent.futures import ThreadPoolExecutor
import hashlib
import html
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

def preview_html(record):
    if not record['decode_verified']:
        return '<p>原图解码失败，已隔离；请通过来源页检查。</p>'
    return f'<img loading="lazy" src="thumbs/{record["id"]}.jpg">'

def dimension_flags(width,height):
    flags=[]
    if min(width,height)<384:
        flags.append('low_resolution')
    if max(width,height)/max(1,min(width,height))>4:
        flags.append('extreme_aspect_ratio')
    return flags

def native_records(pages):
    records={}
    for page in pages:
        for region in page['region_candidates']:
            native=region.get('native_image')
            if not native:
                continue
            key=native['sha256']
            if key not in records:
                records[key]={'id':key[:16],'sha256':key,'path':native['path'],'width':native['width'],
                              'height':native['height'],'occurrences':[],'training_eligible':False,
                              'review_status':'unreviewed','dimension_flags':dimension_flags(native['width'],native['height'])}
            records[key]['occurrences'].append({'page_id':page['id'],'store_id':page['store_id'],
                'source_pdf':page['source_pdf'],'source_sha256':page['source_sha256'],'source_page':page['source_page'],
                'source_aliases':page.get('source_aliases',[]),'category':page['category'],
                'source_quality_flags':page['flags'],'master_si_unverified':page['master_si_unverified'],
                'box_normalized':region['box_normalized'],'pdf_transform':native['pdf_transform'],'path':native['path']})
    for record in records.values():
        record['stores']=sorted({r['store_id'] for r in record['occurrences']})
        record['review_status']='quality_review_required' if record['dimension_flags'] else 'visual_review_required'
    return list(records.values())

def main():
    from PIL import Image,ImageOps,ImageDraw
    parser=argparse.ArgumentParser()
    parser.add_argument('--out',default='资源库/90_处理过程与审核/PDF拆分')
    parser.add_argument('--partial',action='store_true')
    args=parser.parse_args()
    out=(ROOT/args.out).resolve()
    pages=[]
    if args.partial:
        for path in sorted((out/'file-results').glob('*.json')):
            pages.extend(json.loads(path.read_text(encoding='utf8'))['pages'])
    else:
        pages=[json.loads(line) for line in (out/'manifest.jsonl').read_text(encoding='utf8').splitlines()]
    records=native_records(pages)
    catalog=out/'native-catalog'
    (catalog/'thumbs').mkdir(parents=True,exist_ok=True)
    reviews={}
    review_path=ROOT/'资源库/99_历史归档/训练实验/pdf-cleaning-v2/visual-decisions.json'
    if not review_path.exists():
        review_path=catalog/'visual-decisions.json'
    if review_path.exists():
        reviews=json.loads(review_path.read_text(encoding='utf8'))
    def inspect(record):
        try:
            path=out/record['path']
            with path.open('rb') as stream:
                if hashlib.file_digest(stream,'sha256').hexdigest()!=record['sha256']:
                    raise ValueError('Extracted image hash mismatch')
            with Image.open(path) as source:
                source.load()
                record['has_alpha']='A' in source.getbands() or 'transparency' in source.info
                if record['has_alpha']:
                    rgba=source.convert('RGBA')
                    im=Image.new('RGBA',rgba.size,'white')
                    im.alpha_composite(rgba)
                    im=im.convert('RGB')
                else:
                    im=source.convert('RGB')
                thumb=ImageOps.contain(im,(480,320),Image.Resampling.LANCZOS)
                thumb.save(catalog/'thumbs'/f'{record["id"]}.jpg',quality=88)
                record['decode_verified']=True
            if record['sha256'] in reviews:
                record['visual_decision']=reviews[record['sha256']]
                record['review_status']=reviews[record['sha256']]['status']
        except Exception as exc:
            record['decode_verified']=False
            record['review_status']='quarantine'
            record['error']=str(exc)
        return record
    with ThreadPoolExecutor(max_workers=2) as executor:
        records=list(executor.map(inspect,records))
    (catalog/'unique-images.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in records),encoding='utf8')
    for group,selected_rows in {
        'visually-clean-si-unverified':[r for r in records if r['review_status']=='visually_clean_render_si_unverified'],
        'excluded-or-separated':[r for r in records if r['review_status'].startswith(('exclude','separate','quarantine')) or r['dimension_flags']],
        'unreviewed':[r for r in records if r['review_status'] in ('visual_review_required','quality_review_required')]
    }.items():
        (catalog/f'{group}.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in selected_rows),encoding='utf8')
    duplicates=[{'sha256':r['sha256'],'representative':r['path'],'occurrences':r['occurrences']} for r in records if len(r['occurrences'])>1]
    (catalog/'duplicate-images.json').write_text(json.dumps(duplicates,ensure_ascii=False,indent=2),encoding='utf8')
    summary={'partial':args.partial,'source_pages_indexed':len(pages),'native_occurrences':sum(len(r['occurrences']) for r in records),
             'unique_native_images':len(records),'duplicate_groups':len(duplicates),
             'duplicate_occurrences_not_recounted':sum(len(r['occurrences'])-1 for r in records),
             'review_statuses':dict(collections.Counter(r['review_status'] for r in records)),
             'quality_flags':dict(collections.Counter(f for r in records for f in r['dimension_flags'])),
             'training_eligible':0,'note':'Native image content preserved. Transparent images may require original PDF context. No image is approved for SI training by dimensions or keywords alone.'}
    (catalog/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
    css='<meta charset="utf-8"><style>body{font:15px system-ui;background:#eee;margin:30px;color:#222}main{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}article{background:white;padding:14px}img{width:100%;height:220px;object-fit:contain}p{line-height:1.5;overflow-wrap:anywhere}a{color:#1764ac}</style>'
    for start in range(0,len(records),60):
        cards=[]
        for r in records[start:start+60]:
            source=r['occurrences'][0]
            decision=r.get('visual_decision',{}).get('notes','未视觉审核，不作为已清洗合格的训练图')
            cards.append(f'<article><a href="../{r["path"]}">{preview_html(r)}</a><h3>{source["page_id"]} · {r["width"]}×{r["height"]}</h3><p>{r["review_status"]} · {html.escape(", ".join(r["dimension_flags"]))}</p><p>{html.escape(decision)}</p><p>出现{len(r["occurrences"])}次 · {html.escape(", ".join(r["stores"]))}</p><a href="../review/{source["store_id"]}.html">查看来源页</a></article>')
        nav=' '.join(f'<a href="page-{i//60+1}.html">{i//60+1}</a>' for i in range(0,len(records),60))
        (catalog/f'page-{start//60+1}.html').write_text(css+f'<a href="../index.html">PDF总目录</a><h1>底层原图去重目录</h1><p>{len(records)}张唯一原图 · 保留原始内容和透明通道；缩略图透明区以白色显示。</p><p>{nav}</p><main>'+''.join(cards)+'</main>',encoding='utf8')
    # Deterministic contact sheets support visual review; not training images.
    selected=[]
    stores=set()
    for r in records:
        sid=r['occurrences'][0]['store_id']
        if sid not in stores and r['decode_verified'] and not r['dimension_flags']:
            selected.append(r)
            stores.add(sid)
        if len(selected)>=60:
            break
    for offset in range(0,len(selected),20):
        batch=selected[offset:offset+20]
        sheet=Image.new('RGB',(1440,5*245),'#eeeeee')
        draw=ImageDraw.Draw(sheet)
        for i,r in enumerate(batch):
            with Image.open(catalog/'thumbs'/f'{r["id"]}.jpg') as im:
                thumb=ImageOps.contain(im,(350,210))
                sheet.paste(thumb,((i%4)*360,(i//4)*245+28))
            draw.text(((i%4)*360+5,(i//4)*245+5),f'{offset+i+1:02d} {r["occurrences"][0]["page_id"]} {r["id"][:6]}',fill='black')
        sheet.save(catalog/f'contact-{offset//20+1}.jpg',quality=92)
    (catalog/'contact-samples.json').write_text(json.dumps([{'number':i+1,'sha256':r['sha256'],'path':r['path'],'page_id':r['occurrences'][0]['page_id']} for i,r in enumerate(selected)],ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(summary,ensure_ascii=False,indent=2),flush=True)

if __name__=='__main__':
    main()
