"""Non-destructive page splitting and conservative training-data triage.

Input: audited immutable PDF hashes. Output: single-page vector PDFs, previews,
region candidates and provenance. No automatic SI labels or training approval.
"""
import argparse
import collections
from concurrent.futures import ProcessPoolExecutor, as_completed
import hashlib
import html
import json
from pathlib import Path
import re
import shutil
import time

ROOT = Path(__file__).resolve().parents[2]
import sys
sys.path.insert(0, str(ROOT/"tools"))
from resource_library import source_pdf_path
VERSION = 2
CATEGORY_NAMES={'cover':'封面','cover_candidate':'封面候选','contents':'图纸目录','specification':'设计施工说明',
                'plan_candidate':'平面图候选','elevation_candidate':'立面图候选','render_candidate':'效果图候选',
                'image_candidate':'图像页待分类','mixed_candidate':'图像与图纸混排','annotated_render':'带标注效果图',
                'electrical':'电气图','construction':'施工图','text_heavy_reference':'文字密集参考页','unknown':'类别待复核'}

def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf8')
    temporary.replace(path)

def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def content_warning(text):
    return bool(re.search(r'format error|syntax error|cannot (?:find|load)|broken|repairing PDF|invalid|unsupported|missing font', text, re.I))

def page_category(text, number, image_coverage):
    compact = re.sub(r'\s+', '', text)
    if re.search(r'图纸目录|DRAWINGINDEX|DRAWINGLIST', compact, re.I):
        return 'contents'
    if re.search(r'设计施工说明|设计总说明|施工总说明|装修设计说明|GENERALNOTES', compact, re.I) and image_coverage < .25:
        return 'specification'
    if number == 1 and image_coverage < .12 and re.search(r'20\d{2}|平方米|㎡', compact) and (
            '效果图' in compact and '施工图' in compact or len(compact) < 160 and not re.search(r'布置|定位|平面图|立面图', compact)):
        return 'cover_candidate'
    # Short title-like lines, not incidental mentions in long specification prose.
    titles = ''.join(line.strip() for line in text.splitlines() if len(line.strip()) < 70)
    titles = re.sub(r'\s+', '', titles)
    plan = bool(re.search(r'家具.*?平面|平面布置|家具定位|原始平面|原始结构|FLOORPLAN|FURNISHINGPLAN', titles, re.I))
    if plan:
        return 'mixed_candidate' if image_coverage > .25 else 'plan_candidate'
    if re.search(r'配电系统|电气系统|弱电系统|单线图|电气设计说明', titles):
        return 'electrical'
    if re.search(r'立面图|ELEVATION', titles, re.I):
        return 'mixed_candidate' if image_coverage > .25 else 'elevation_candidate'
    if re.search(r'天花|配电|铺装|节点|大样|施工说明|物料表|灯具定位|插座|给排水', titles) and image_coverage < .25:
        return 'construction'
    if re.search(r'效果图|效果展示|RENDERING|PERSPECTIVE', titles, re.I) and image_coverage > .15:
        return 'render_candidate'
    if image_coverage > .25:
        return 'image_candidate'
    if len(compact) > 1200:
        return 'text_heavy_reference'
    return 'unknown'

def split_page(source, number, target):
    import fitz
    try:
        with fitz.open() as single:
            # Cross-page links cannot remain valid in a single-page derivative.
            single.insert_pdf(source, from_page=number, to_page=number, links=False, annots=True)
            single.save(target, garbage=3, deflate=True)
        return 'vector_page_copy'
    except Exception:
        if not source.name:
            raise
        from pypdf import PdfReader,PdfWriter
        reader=PdfReader(source.name,strict=False)
        writer=PdfWriter()
        # append preserves canonical form fields and widget appearances.
        writer.append(reader,pages=[number])
        writer.write(target)
        return 'pypdf_fallback_requires_review'

def extract_native_image(doc,xref,target):
    import fitz
    original = doc.extract_image(xref)
    if original.get('smask',0):
        base = fitz.Pixmap(doc,xref)
        mask = fitz.Pixmap(doc,original['smask'])
        # Some PDF image decoders already attach the soft mask as alpha.
        combined = base if base.alpha else fitz.Pixmap(base,mask)
        path = target.with_suffix('.png')
        combined.save(path)
    else:
        path = target.with_suffix('.'+original['ext'])
        path.write_bytes(original['image'])
    return {'path':str(path),'width':original['width'],'height':original['height'],
            'sha256':sha256(path),'method':'original_embedded_raster_not_inpainted',
            'status':'native_image_candidate_requires_visual_review','training_eligible':False}

class HashIndex:
    """BK-tree: approximate visual duplicates are review hints, never deletions."""
    def __init__(self):
        self.root = None

    def add(self, value, key):
        node = self.root
        if node is None:
            self.root = [value, [key], {}]
            return
        while True:
            distance = (value ^ node[0]).bit_count()
            if distance == 0:
                node[1].append(key)
                return
            if distance not in node[2]:
                node[2][distance] = [value, [key], {}]
                return
            node = node[2][distance]

    def find(self, value, radius):
        found, pending = [], [self.root] if self.root else []
        while pending:
            node = pending.pop()
            distance = (value ^ node[0]).bit_count()
            if distance <= radius:
                found.extend((key, distance) for key in node[1][:5])
            pending.extend(child for d, child in node[2].items() if distance-radius <= d <= distance+radius)
        return sorted(found, key=lambda item: (item[1], item[0]))[:5]

def visual_features(pix):
    import numpy as np
    from PIL import Image
    im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
    gray = np.asarray(im.convert('L'))
    small = np.asarray(im.convert('L').resize((9,8), Image.Resampling.LANCZOS))
    bits = (small[:,1:] > small[:,:-1]).flatten()
    dhash = sum(int(bit) << i for i, bit in enumerate(bits))
    rgb = np.asarray(im)
    red = (rgb[:,:,0].astype(int) > rgb[:,:,1].astype(int)+55) & (rgb[:,:,0].astype(int) > rgb[:,:,2].astype(int)+55)
    return {'preview_pixel_sha256': hashlib.sha256(f'{pix.width}x{pix.height}:'.encode()+pix.samples).hexdigest(),
            'dhash': f'{dhash:016x}', 'ink_fraction': float((gray < 245).mean()),
            'red_fraction': float(red.mean())}

def image_regions(page):
    import fitz
    import numpy as np
    occupied = np.zeros((32,32), dtype=bool)
    rects = []
    for info in page.get_image_info(xrefs=True):
        rect = fitz.Rect(info['bbox']) * page.rotation_matrix
        rect &= page.rect
        if rect.is_empty or rect.width < 1 or rect.height < 1:
            continue
        box = [rect.x0/page.rect.width, rect.y0/page.rect.height, rect.x1/page.rect.width, rect.y1/page.rect.height]
        x0,y0,x1,y1 = [max(0,min(32, int(v*32))) for v in box]
        occupied[y0:max(y0+1,y1),x0:max(x0+1,x1)] = True
        if rect.get_area()/page.rect.get_area() >= .08 and min(info['width'],info['height']) >= 256:
            if not any(max(abs(a-b) for a,b in zip(box, old['box'])) < .01 for old in rects):
                rects.append({'box':box,'xref':info.get('xref',0),'transform':list(info['transform'])})
    return float(occupied.mean()), sorted(rects, key=lambda r:(r['box'][2]-r['box'][0])*(r['box'][3]-r['box'][1]), reverse=True)[:4]

REVIEW_TYPES = {'cover':'cover', 'contents':'contents', 'electrical_contents':'contents',
                'render_facade':'render_candidate', 'furniture_plan':'plan_candidate',
                'annotated_render':'annotated_render', 'specification_text':'specification',
                'electrical_schematic':'electrical'}

def process_file(job):
    import fitz
    row, aliases, output, reviews = job
    out = Path(output)
    source = source_pdf_path(row['path'])
    sid = row['store_id'] or 'UNMAPPED-'+row['expected_sha256'][:12]
    cache_path = out/'file-results'/f'{sid}.json'
    if cache_path.exists():
        cached = json.loads(cache_path.read_text(encoding='utf8'))
        if cached.get('version') != VERSION or cached['sha256'] != row['expected_sha256']:
            raise ValueError('Output version/source changed; choose a new directory: '+sid)
        if cached.get('complete') and all((out/p['pdf']).exists() and (out/p['preview']).exists() for p in cached['pages']):
            return cached
    if sha256(source) != row['expected_sha256']:
        raise ValueError('Source changed since audit; not exporting '+row['path'])
    fitz.TOOLS.mupdf_display_errors(False)
    fitz.TOOLS.mupdf_display_warnings(False)
    fitz.TOOLS.mupdf_warnings(reset=True)
    result = {'version':VERSION,'store_id':sid,'source':row['path'],'sha256':row['expected_sha256'],
              'aliases':aliases,'pages':[], 'complete':False}
    with fitz.open(source) as doc:
        open_warnings = fitz.TOOLS.mupdf_warnings(reset=True)
        result['open_warnings'] = open_warnings
        result['source_page_count'] = len(doc)
        base = Path('pages')/sid/row['expected_sha256'][:12]
        (out/base).mkdir(parents=True,exist_ok=True)
        for n,page in enumerate(doc):
            if shutil.disk_usage(out).free < 20*1024**3:
                raise RuntimeError('Less than 20 GiB free; stopped without deleting anything')
            pid = f'{sid}-p{n+1:04d}'
            pdf = base/f'p{n+1:04d}.pdf'
            thumb = base/f'p{n+1:04d}.jpg'
            text = page.get_text('text')
            image_coverage, regions = image_regions(page)
            category = page_category(text, n+1, image_coverage)
            review = reviews.get(f'{sid}:{n+1}')
            if review:
                category = REVIEW_TYPES.get(review['actual_type'], category)
            flags = []
            if row['excluded_conflict']:
                flags.append('source_label_conflict')
            if review and review.get('decision')=='exclude_and_check_store_identity':
                flags.append('store_identity_mismatch_suspected')
            scale = 640/max(page.rect.width, page.rect.height)
            pix = page.get_pixmap(matrix=fitz.Matrix(scale,scale), colorspace=fitz.csRGB, alpha=False)
            features = visual_features(pix)
            if features['ink_fraction'] < .001:
                flags.append('blank_or_nearly_blank_candidate')
            if features['red_fraction'] > .005:
                flags.append('red_markup_or_colored_artwork_review')
            parse_warnings = fitz.TOOLS.mupdf_warnings(reset=True)
            if content_warning(open_warnings + parse_warnings):
                flags.append('content_parse_warning')
            export_method=split_page(doc,n,out/pdf)
            if export_method!='vector_page_copy':
                flags.append('fallback_export_requires_review')
            export_warnings = fitz.TOOLS.mupdf_warnings(reset=True)
            with fitz.open(out/pdf) as check:
                assert len(check)==1 and check[0].rect==page.rect and check[0].rotation==page.rotation, pid
                # Every exported page is opened; full visual equality checked once per source.
                if n==0 or export_method!='vector_page_copy':
                    reopened = check[0].get_pixmap(matrix=fitz.Matrix(scale,scale),colorspace=fitz.csRGB,alpha=False)
                    if reopened.samples != pix.samples:
                        flags.append('export_visual_difference')
            if content_warning(export_warnings):
                flags.append('export_parse_warning')
            pix.save(out/thumb, jpg_quality=85)
            crops = []
            if category in {'render_candidate','image_candidate','mixed_candidate','annotated_render'}:
                for i,region in enumerate(regions):
                    box=region['box']
                    rect = fitz.Rect(box[0]*page.rect.width,box[1]*page.rect.height,box[2]*page.rect.width,box[3]*page.rect.height)
                    crop_scale = min(2,1600/max(rect.width,rect.height))
                    crop = base/f'p{n+1:04d}-region{i+1}.png'
                    page.get_pixmap(matrix=fitz.Matrix(crop_scale,crop_scale),clip=rect,colorspace=fitz.csRGB,alpha=False).save(out/crop)
                    entry={'path':crop.as_posix(),'box_normalized':box,'sha256':sha256(out/crop),
                           'status':'candidate_not_visually_approved','training_eligible':False}
                    if region['xref']:
                        try:
                            native=extract_native_image(doc,region['xref'],out/base/f'p{n+1:04d}-native{i+1}')
                            native['path']=Path(native['path']).relative_to(out).as_posix()
                            native['pdf_transform']=region['transform']
                            entry['native_image']=native
                        except Exception as exc:
                            entry['native_extraction_error']=str(exc)
                            flags.append('native_extraction_failed')
                    crops.append(entry)
            crop_warnings = fitz.TOOLS.mupdf_warnings(reset=True)
            if content_warning(crop_warnings):
                flags.append('crop_parse_warning')
            record = {'id':pid,'store_id':sid,'source_pdf':row['path'],'source_sha256':row['expected_sha256'],
                      'source_page':n+1,'source_aliases':aliases,'pdf':pdf.as_posix(),'pdf_sha256':sha256(out/pdf),
                      'preview':thumb.as_posix(),'width_pt':page.rect.width,'height_pt':page.rect.height,
                      'rotation':page.rotation,'category':category,'flags':flags,'text_excerpt':text[:1200],
                      'export_method':export_method,
                      'image_coverage':image_coverage,**features,'region_candidates':crops,
                      'master_si_unverified':row['master_si'],'training_eligible':False,'split':'unassigned',
                      'group_id':row.get('master_record_id') or row['expected_sha256'],
                      'visual_review':review, 'parse_warnings':parse_warnings,'export_warnings':export_warnings+crop_warnings,
                      'export_visual_check':'mismatch' if 'export_visual_difference' in flags else 'match' if n==0 or export_method!='vector_page_copy' else 'not_checked'}
            result['pages'].append(record)
    result['complete'] = True
    dump(cache_path,result)
    return result

def aggregate(results,out,missing,total_sources):
    pages = [page for result in sorted(results,key=lambda x:x['store_id']) for page in result['pages']]
    counts = collections.Counter(p['category'] for p in pages)
    flags = collections.Counter(f for p in pages for f in p['flags'])
    exact = collections.defaultdict(list)
    tree = HashIndex()
    near = []
    for page in pages:
        exact[page['preview_pixel_sha256']].append(page['id'])
        matches = tree.find(int(page['dhash'],16),3)
        if matches:
            near.append({'id':page['id'],'matches':matches,'status':'visual_similarity_only_not_safe_to_delete'})
        tree.add(int(page['dhash'],16),page['id'])
    def jsonl(path,rows):
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in rows),encoding='utf8')
    jsonl(out/'manifest.jsonl',pages)
    for category in counts:
        jsonl(out/'queues'/f'{category}.jsonl',[p for p in pages if p['category']==category])
    jsonl(out/'queues'/'quarantine.jsonl',[p for p in pages if any(f in p['flags'] for f in ['source_label_conflict','content_parse_warning','export_parse_warning','crop_parse_warning','store_identity_mismatch_suspected','export_visual_difference','native_extraction_failed','fallback_export_requires_review'])])
    dump(out/'duplicate-review.json',{'exact_source_aliases':[{'canonical':r['source'],'aliases':r['aliases']} for r in results if len(r['aliases'])>1],
                                     'same_preview_pixels':[ids for ids in exact.values() if len(ids)>1],
                                     'near_preview_hash':near,'policy':'No pages deleted; similarity does not prove same scale, date, dimensions or store.'})
    dump(out/'unavailable-sources.json',missing)
    summary = {'version':VERSION,'input_available_source_files':total_sources,'exported_unique_source_files':len(results),
               'single_page_pdfs':len(pages),'input_pages_represented':sum(len(r['pages'])*len(r['aliases']) for r in results),
               'region_candidates':sum(len(p['region_candidates']) for p in pages),'categories':dict(counts),'flags':dict(flags),
               'native_image_candidates':sum('native_image' in c for p in pages for c in p['region_candidates']),
               'same_preview_groups':sum(len(ids)>1 for ids in exact.values()),'near_duplicate_review_rows':len(near),
               'training_eligible_pages':0,'all_exports_reopened':True,'source_first_pages_visually_compared':len(results),
               'export_methods':dict(collections.Counter(p.get('export_method','vector_page_copy') for p in pages)),
               'visual_equality_checks':sum(p['export_visual_check']=='match' for p in pages),
               'bytes_exported':sum(f.stat().st_size for f in (out/'pages').rglob('*') if f.is_file()),
               'complete':sum(len(r['aliases']) for r in results)==total_sources,
               'notes':['Original PDFs unchanged.','Image and drawing categories are candidates, not ground truth.',
                        'Cross-page links are omitted in derivatives; original retained.','No OCR or automatic SI verification performed.']}
    dump(out/'summary.json',summary)
    (out/'review').mkdir(exist_ok=True)
    css='<meta charset="utf-8"><style>body{font-family:system-ui;margin:32px;background:#f2f3f5;color:#20252a}main{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}article{background:white;padding:14px;overflow-wrap:anywhere}img{width:100%;object-fit:contain}p{line-height:1.6}a{color:#1458ad}</style>'
    links=[]
    for result in sorted(results,key=lambda r:r['store_id']):
        cards=[]
        for p in result['pages']:
            crops=''.join(f'<a href="../{c["path"]}">带叠加层图块 {i+1}</a> '+(f'<a href="../{c["native_image"]["path"]}">底层原图 {i+1}</a> ' if 'native_image' in c else '') for i,c in enumerate(p['region_candidates']))
            cards.append(f'<article><h3>{p["id"]} · {p["category"]}</h3><p>{html.escape(", ".join(p["flags"]))}</p><a href="../{p["pdf"]}"><img loading="lazy" src="../{p["preview"]}"></a><p><a href="../{p["pdf"]}">单页PDF</a> {crops}</p></article>')
        (out/'review'/f'{result["store_id"]}.html').write_text(css+f'<a href="../index.html">返回目录</a><h1>{html.escape(result["source"])}</h1><p>自动分类仅供筛选；保留原页，无正式训练批准。</p><main>'+''.join(cards)+'</main>',encoding='utf8')
        links.append(f'<li><a href="review/{result["store_id"]}.html">{result["store_id"]} · {html.escape(Path(result["source"]).name)}</a> · {len(result["pages"])}页</li>')
    (out/'by-category').mkdir(exist_ok=True)
    category_links=[]
    for category,count in counts.items():
        subset=[p for p in pages if p['category']==category]
        label=CATEGORY_NAMES.get(category,category)
        category_links.append(f'<li><a href="by-category/{category}-1.html">{label} · {count}页</a></li>')
        for start in range(0,count,80):
            nav=' '.join(f'<a href="{category}-{i//80+1}.html">{i//80+1}</a>' for i in range(0,count,80))
            cards=[]
            for p in subset[start:start+80]:
                cards.append(f'<article><h3>{p["id"]}</h3><p>{html.escape(Path(p["source_pdf"]).name)}</p><a href="../{p["pdf"]}"><img loading="lazy" src="../{p["preview"]}"></a><p>{html.escape(", ".join(p["flags"]))}</p><a href="../review/{p["store_id"]}.html">门店全部页面和图块</a></article>')
            (out/'by-category'/f'{category}-{start//80+1}.html').write_text(css+f'<a href="../index.html">返回目录</a><h1>{label}</h1><p>分类是候选，不能代替视觉与版本审核。</p><p>{nav}</p><main>'+''.join(cards)+'</main>',encoding='utf8')
    (out/'index.html').write_text(css+f'<h1>门店 PDF 拆分与第一轮清洗</h1><p>{len(results)}份去重原件 · {len(pages)}个单页PDF · {summary["region_candidates"]}个图块候选。原件均保留。</p><p>效果图/平面图按候选分类；带标注、解析异常、标签冲突及重复页另列清单，未自动批准训练。</p><p><a href="native-catalog/page-1.html">底层原图去重图库</a> · <a href="summary.json">统计</a> · <a href="manifest.jsonl">来源索引</a> · <a href="duplicate-review.json">重复复核</a> · <a href="queues/quarantine.jsonl">隔离队列</a></p><h2>按图种浏览</h2><ul>'+''.join(category_links)+'</ul><h2>按门店浏览</h2><ul>'+''.join(links)+'</ul>',encoding='utf8')
    return summary

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--out',default='资源库/90_处理过程与审核/PDF拆分')
    parser.add_argument('--workers',type=int,default=4)
    parser.add_argument('--limit-files',type=int)
    args=parser.parse_args()
    out=(ROOT/args.out).resolve()
    if not (out.is_relative_to(ROOT/'资源库/90_处理过程与审核/PDF拆分') or out.is_relative_to(ROOT/'output/pdf')):
        raise ValueError('Output must stay under the PDF processing directory')
    out.mkdir(parents=True,exist_ok=True)
    audit=ROOT/'资源库/99_历史归档/训练实验/corpus-audit-4070'
    sources=json.loads((audit/'files.json').read_text(encoding='utf8'))
    available=[r for r in sources if r['status']=='verified']
    missing=[r for r in sources if r['status']!='verified']
    reviews={f'{r["store_id"]}:{r["page"]}':r for r in json.loads((audit/'visual-review.json').read_text(encoding='utf8'))['samples']}
    groups=collections.defaultdict(list)
    for row in available:
        groups[row['expected_sha256']].append(row)
    jobs=[]
    for group in groups.values():
        row=group[0]
        aliases=[{'path':r['path'],'store_id':r['store_id'],'master_record_id':r.get('master_record_id')} for r in group]
        jobs.append((row,aliases,str(out),reviews))
    if args.limit_files:
        jobs=jobs[:args.limit_files]
    results=[]
    failures=[]
    started=time.time()
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        pending={executor.submit(process_file,job):job[0]['path'] for job in jobs}
        for future in as_completed(pending):
            try:
                result=future.result()
            except Exception as exc:
                failures.append({'source':pending[future],'error':str(exc)})
                dump(out/'export-errors.json',failures)
                print(json.dumps({'failed_source':pending[future],'error':str(exc)},ensure_ascii=False),flush=True)
                continue
            results.append(result)
            print(json.dumps({'completed_files':len(results),'scheduled_files':len(jobs),'store':result['store_id'],
                              'pages':sum(len(r['pages']) for r in results),'seconds':round(time.time()-started)},ensure_ascii=False),flush=True)
    dump(out/'export-errors.json',failures)
    print(json.dumps(aggregate(results,out,missing,len(available)),ensure_ascii=False,indent=2),flush=True)
    if failures:
        raise SystemExit(1)

if __name__=='__main__':
    main()
