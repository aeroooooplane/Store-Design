"""Non-destructive correction of inventory ambiguities; archive PDFs to cache only."""
import subprocess,zipfile
from pipeline import *
VERSION='1.0.0'
def run():
    dest=OUT/'00_文件类型复核.json'
    if dest.exists():return read(dest)
    original=inventory();items=[]
    for r in original['files']:
        matches=r['index_matches'];same=[a for a in matches if Path(a.get('file_name',a.get('filename',a.get('name','')))).stem==Path(r['filename']).stem]
        if not same:same=[a for a in matches if a.get('name')==Path(r['filename']).stem]
        sid=same[0]['source_id'] if len(same)==1 else r['source_id']
        o=dict(source_id=sid,path=r['path'],sha256=r['sha256'],format=Path(r['path']).suffix[1:].lower(),index_status=r['index_status'],matching_index_ids=[a['source_id'] for a in matches],identity_match_method='sha256_and_filename' if len(same)==1 else 'sha256',page_count=r['page_count'],encrypted=r['encrypted'],damaged=r['damaged'],archive_members=None)
        if o['format']=='rar':
            q=subprocess.run(['tar','-tf',r['path']],capture_output=True,check=True)
            members=[a for a in q.stdout.decode('gbk').splitlines() if a]
            o.update(damaged=False,encrypted=None,page_count=None,archive_members=members,archive_listing_encoding='gbk',note='PyMuPDF不支持RAR，不属于PDF损坏；压缩包目录可读取。',embedded_pdfs=[])
            for k,member in enumerate(m for m in members if m.lower().endswith('.pdf')):
                # Never extract archive paths into filesystem. Capture one member to a controlled path.
                data=subprocess.run(['tar','-xOf',r['path'],member],capture_output=True,check=True).stdout
                dst=CACHE/'archive-pdfs'/f'{sid}-{k+1:02}.pdf';dst.parent.mkdir(parents=True,exist_ok=True)
                if dst.exists():
                    if digest(dst)!=hashlib.sha256(data).hexdigest():raise RuntimeError('Cache collision')
                else:
                    with dst.open('xb') as f:f.write(data)
                with fitz.open(dst) as doc:
                    o['embedded_pdfs'].append(dict(member=member,cache_path=str(dst),sha256=digest(dst),pages=len(doc),encrypted=doc.is_encrypted,damaged=doc.is_repaired,processing_status='pending_pilot_gate'))
        elif o['format']=='pptx':
            with zipfile.ZipFile(r['path']) as z:
                o['slide_count']=sum(bool(re.fullmatch(r'ppt/slides/slide\d+\.xml',n)) for n in z.namelist())
                o['media_count']=sum(n.startswith('ppt/media/') and not n.endswith('/') for n in z.namelist())
                o['damaged']=z.testzip() is not None
            o.update(note='未入索引的原生PPTX，页数指幻灯片数，不能计入418份PDF页数。',processing_status='pending_pilot_gate')
        items.append(o)
    result=dict(**meta(),correction_of='00_文件清单.json',files=items,counts=dict(files=len(items),formats=dict(collections.Counter(a['format'] for a in items)),indexed_pdf_pages=sum(a['page_count'] for a in items if a['format']=='pdf'),pptx_slides=sum(a.get('slide_count',0) for a in items),archive_pdf_pages=sum(p['pages'] for a in items for p in a.get('embedded_pdfs',[]))),note='原始清单保留不覆盖。本文件优先解释格式、RAR损坏状态及PDF-175/PDF-176同哈希身份。')
    result['generator']={'script':'inventory_review.py','version':VERSION};write(dest,result)
    print(json.dumps(result['counts'],ensure_ascii=False),flush=True)
    return result
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');run()
