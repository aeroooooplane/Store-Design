"""Create independently verifiable ZIP assets for the 96 newly copied sources.
Original PDFs and all existing artifacts stay immutable. ZIP_STORED avoids CPU-heavy compression.
"""
import argparse, hashlib, json, os, sys, zipfile
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[3]
RUN=ROOT/'资源库/90_处理过程与审核/数据清洗-20261009'
INVENTORY=RUN/'全量续跑-02/00_同步与文件清单.json'
SOURCE_ROOT=ROOT/'资源库/01_各门店原图纸'
BUFFER=4*1024*1024

def meta():
    return dict(schemaVersion=1,generatedAt=datetime.now(timezone.utc).isoformat(),
                generator=dict(script='source-release-20261009-01/package_sources.py',version='1.0.0'))
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for data in iter(lambda:f.read(BUFFER),b''):h.update(data)
    return h.hexdigest()
def write(p,data):
    with p.open('x',encoding='utf-8') as f:
        json.dump({**meta(),**data},f,ensure_ascii=False,indent=2);f.write('\n')
def progress(dest,data):
    with (dest/'progress.jsonl').open('a',encoding='utf-8') as f:
        f.write(json.dumps({**meta(),**data},ensure_ascii=False)+'\n');f.flush();os.fsync(f.fileno())
def select_files():
    inventory=read(INVENTORY)
    by_path={str(Path(r['path']).resolve()).casefold():r for r in inventory['files']}
    files=[]
    for incoming in inventory['incoming']:
        if incoming['action']!='copy':continue
        p=Path(incoming['destination']).resolve()
        if not p.is_relative_to(SOURCE_ROOT.resolve()):raise RuntimeError('Unexpected source path '+str(p))
        row=by_path[str(p).casefold()]
        if p.suffix.lower() not in {'.pdf','.xlsx'}:raise RuntimeError('Unexpected format '+str(p))
        assert p.stat().st_size==incoming['bytes']==row['bytes']
        assert incoming['sha256']==row['sha256']
        files.append(dict(source_id=row['source_id'],relative_path=p.relative_to(ROOT).as_posix(),
                          bytes=row['bytes'],sha256=row['sha256'],format=row['format']))
    assert len(files)==96 and sum(f['format']=='pdf' for f in files)==95
    assert sum(f['bytes'] for f in files)==1510368407
    assert len({f['relative_path'].casefold() for f in files})==len(files)
    return files

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser();parser.add_argument('--output-name',default='新增图纸GitHub传输-01');args=parser.parse_args()
    if Path(args.output_name).name!=args.output_name or args.output_name in {'.','..'}:raise ValueError('Invalid output name')
    dest=RUN/'_cache'/args.output_name;dest.mkdir(parents=True,exist_ok=True)
    files=select_files();groups=[]
    # First-fit decreasing; every ZIP is independently readable, not a split ZIP volume.
    for record in sorted(files,key=lambda r:(-r['bytes'],r['relative_path'])):
        group=next((g for g in groups if sum(f['bytes'] for f in g)+record['bytes']<=400*1024*1024),None)
        if group is None:group=[];groups.append(group)
        group.append(record)
    print('Sources:',len(files),'Independent ZIP assets:',len(groups),'Bytes:',sum(f['bytes'] for f in files),flush=True)
    archive_records=[];file_records=[]
    for number,group in enumerate(groups,1):
        name=f'source-supplement-part-{number:02d}.zip';path=dest/name
        receipt=dest/f'part-{number:02d}-receipt.json'
        assigned=[{**record,'archive':name} for record in sorted(group,key=lambda r:r['relative_path'])]
        if receipt.exists():
            old=read(receipt)
            assert old['files']==assigned and sha(path)==old['archive']['sha256']
            print('Verified existing complete archive',name,flush=True)
            archive_records.append(old['archive']);file_records.extend(assigned);continue
        if path.exists():raise FileExistsError('Incomplete ZIP preserved; choose a new --output-name: '+str(path))
        with zipfile.ZipFile(path,'x',compression=zipfile.ZIP_STORED,allowZip64=True) as z:
            for record in assigned:
                p=ROOT/record['relative_path']
                info=zipfile.ZipInfo.from_file(p,arcname=record['relative_path'],strict_timestamps=False)
                info.compress_type=zipfile.ZIP_STORED
                h=hashlib.sha256();count=0
                with p.open('rb') as src,z.open(info,'w',force_zip64=True) as out:
                    for block in iter(lambda:src.read(BUFFER),b''):
                        h.update(block);out.write(block);count+=len(block)
                if h.hexdigest()!=record['sha256'] or count!=record['bytes']:
                    raise RuntimeError('Source changed while packing: '+record['relative_path'])
                progress(dest,dict(stage='pack_member',archive=name,source_id=record['source_id'],bytes=count,sha256=h.hexdigest()))
        # Re-read the archive payload: this validates the stored bytes as well as original sources.
        with zipfile.ZipFile(path) as z:
            assert set(z.namelist())=={r['relative_path'] for r in assigned}
            for record in assigned:
                h=hashlib.sha256();count=0
                with z.open(record['relative_path']) as f:
                    for block in iter(lambda:f.read(BUFFER),b''):h.update(block);count+=len(block)
                assert h.hexdigest()==record['sha256'] and count==record['bytes']
        archive=dict(name=name,bytes=path.stat().st_size,sha256=sha(path),files_count=len(assigned))
        write(receipt,dict(archive=archive,files=assigned,source_and_zip_members_verified=True))
        archive_records.append(archive);file_records.extend(assigned)
        progress(dest,dict(stage='archive_complete',**archive))
        print('Verified',name,'bytes',archive['bytes'],'files',len(assigned),flush=True)
    manifest=dest/'source-supplement-manifest.json'
    result=dict(source_inventory_sha256=sha(INVENTORY),
        git_handoff_commit='3f69f9dd89c652957eccb23cbddde201e16a0fa6',
        release_tag='cleaning-source-supplement-20261009',archives=archive_records,
        files=sorted(file_records,key=lambda r:r['relative_path']),
        totals=dict(pdf=95,spreadsheets=1,files=96,bytes=sum(r['bytes'] for r in files)),
        same_content_sources_kept=['NEW-039','NEW-040'],training_eligible=False)
    if manifest.exists():
        existing=read(manifest)
        assert existing['files']==result['files'] and existing['archives']==result['archives']
    else:write(manifest,result)
    print('Manifest ready:',str(manifest),flush=True)
if __name__=='__main__':main()
