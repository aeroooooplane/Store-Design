"""Verify every Release asset, upload small restore files, then publish the draft."""
import hashlib,json,subprocess,sys,time
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[3]
CACHE=ROOT/'资源库/90_处理过程与审核/数据清洗-20261009/_cache/新增图纸GitHub传输-01'
REPO='aeroooooplane/Store-Design';TAG='cleaning-source-supplement-20261009'
COMMIT='3f69f9dd89c652957eccb23cbddde201e16a0fa6'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def command(args):
    p=subprocess.run(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if p.returncode:raise RuntimeError(p.stderr.decode('utf-8',errors='replace'))
    return p.stdout
def api(endpoint):return json.loads(command(['gh','api','repos/'+REPO+'/'+endpoint]))
def meta():return dict(schemaVersion=1,generatedAt=datetime.now(timezone.utc).isoformat(),generator=dict(script='finish_release.py',version='1.0.0'))
def main():
    sys.stdout.reconfigure(encoding='utf-8')
    archived=read(CACHE/'archive-upload-receipt.json')
    expected=read(CACHE/'release-assets.json')['assets'];rid=archived['release_id']
    release=api(f'releases/{rid}')
    assert release['tag_name']==TAG and release['target_commitish']==COMMIT
    for entry in expected:
        if entry['name'].endswith('.zip'):continue
        path=CACHE/entry['name']
        assert path.stat().st_size==entry['bytes'] and hashlib.sha256(path.read_bytes()).hexdigest()==entry['sha256']
        present=[a for a in api(f'releases/{rid}/assets?per_page=100') if a['name']==entry['name']]
        if not present:
            command(['gh','release','upload',TAG,str(path),'--repo',REPO])
            print('Uploaded',entry['name'],flush=True)
    remote=api(f'releases/{rid}/assets?per_page=100')
    assert len(remote)==len(expected) and {a['name'] for a in remote}=={a['name'] for a in expected}
    lookup={a['name']:a for a in remote}
    for item in expected:
        remote_item=lookup[item['name']]
        assert remote_item['state']=='uploaded' and remote_item['size']==item['bytes']
        assert remote_item.get('digest')=='sha256:'+item['sha256'],('SHA mismatch',item['name'])
    # Publishing is the final mutation, after every local/remote digest agrees.
    if release['draft']:
        command(['gh','release','edit',TAG,'--draft=false','--latest=false','--repo',REPO])
    final=api(f'releases/{rid}')
    assert not final['draft'] and final['published_at']
    tag=api('git/ref/tags/'+TAG)
    assert tag['object']['type']=='commit' and tag['object']['sha']==COMMIT
    receipt={**meta(),'release_id':rid,'release_url':final['html_url'],'tag':TAG,'commit':COMMIT,
             'published':True,'asset_count':len(expected),'assets':[dict(name=a['name'],bytes=a['size'],digest=a['digest'],url=a['browser_download_url']) for a in remote],
             'source_totals':dict(pdf=95,spreadsheets=1,files=96,bytes=1510368407),
             'all_remote_sha256_verified':True,'source_files_modified':False,
             'cleaning_started':False,'training_eligible':False}
    with (CACHE/'release-publish-receipt.json').open('x',encoding='utf-8') as f:json.dump(receipt,f,ensure_ascii=False,indent=2)
    print(json.dumps({k:v for k,v in receipt.items() if k!='assets'},ensure_ascii=False),flush=True)
if __name__=='__main__':main()
