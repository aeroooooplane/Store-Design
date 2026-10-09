"""Upload verified source ZIPs to the already-created GitHub draft Release.
Sequential uploads; never clobbers an existing asset. Checks GitHub SHA256 digest.
"""
import hashlib,json,subprocess,sys,time,os
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[3]
CACHE=ROOT/'资源库/90_处理过程与审核/数据清洗-20261009/_cache/新增图纸GitHub传输-01'
REPO='aeroooooplane/Store-Design';TAG='cleaning-source-supplement-20261009'
COMMIT='3f69f9dd89c652957eccb23cbddde201e16a0fa6'
def run(args):
    p=subprocess.run(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if p.returncode:raise RuntimeError(p.stderr.decode('utf-8',errors='replace'))
    return p.stdout

def api(endpoint):return json.loads(run(['gh','api','repos/'+REPO+'/'+endpoint]))
def meta():return dict(schemaVersion=1,generatedAt=datetime.now(timezone.utc).isoformat(),generator=dict(script='upload_archives.py',version='1.0.0'))
def log(event):
    with (CACHE/'upload-progress.jsonl').open('a',encoding='utf-8') as f:
        f.write(json.dumps({**meta(),**event},ensure_ascii=False)+'\n');f.flush();os.fsync(f.fileno())
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
    return h.hexdigest()
def main():
    sys.stdout.reconfigure(encoding='utf-8')
    manifest=json.loads((CACHE/'source-supplement-manifest.json').read_text(encoding='utf-8'))
    releases=[r for r in api('releases?per_page=100') if r['tag_name']==TAG]
    assert len(releases)==1
    release=releases[0];rid=release['id']
    assert release['draft'] and release['target_commitish']==COMMIT
    results=[]
    for expected in manifest['archives']:
        p=CACHE/expected['name']
        assert p.stat().st_size==expected['bytes'] and digest(p)==expected['sha256']
        current=[a for a in api(f'releases/{rid}/assets?per_page=100') if a['name']==p.name]
        if not current:
            print('Uploading',p.name,expected['bytes'],'bytes',flush=True)
            log(dict(stage='upload_started',name=p.name,bytes=expected['bytes']))
            started=time.monotonic()
            run(['gh','release','upload',TAG,str(p),'--repo',REPO])
            elapsed=time.monotonic()-started
        else:elapsed=None
        for retry in range(8):
            found=[a for a in api(f'releases/{rid}/assets?per_page=100') if a['name']==p.name]
            if found and found[0].get('digest'):break
            time.sleep(2)
        assert len(found)==1
        asset=found[0]
        if asset['state']!='uploaded' or asset['size']!=expected['bytes'] or asset.get('digest')!='sha256:'+expected['sha256']:
            raise RuntimeError('Remote asset differs; not overwritten: '+p.name)
        result=dict(name=p.name,id=asset['id'],bytes=asset['size'],sha256=expected['sha256'],remote_digest=asset['digest'],elapsed_seconds=elapsed,url=asset['browser_download_url'])
        log(dict(stage='archive_remote_verified',**result));results.append(result)
        print('Remote SHA256 verified:',p.name,'seconds:',round(elapsed,1) if elapsed else 'reused',flush=True)
    receipt=CACHE/'archive-upload-receipt.json'
    if receipt.exists():
        old=json.loads(receipt.read_text(encoding='utf-8'));assert old['release_id']==rid
    else:
        with receipt.open('x',encoding='utf-8') as f:json.dump({**meta(),'release_id':rid,'tag':TAG,'archives':results,'published':False},f,ensure_ascii=False,indent=2)
    print('All four ZIP assets verified remotely. Release remains draft.',flush=True)
if __name__=='__main__':main()
