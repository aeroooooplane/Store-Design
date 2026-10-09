"""Publish the exact reviewed local Git tree using GitHub's Git Database API.
No credential extraction. gh uses its existing keyring login. New branch only.
"""
import hashlib, json, subprocess, sys, re
from pathlib import Path
from datetime import datetime, timezone, timedelta
ROOT=Path(__file__).resolve().parents[3]
BASE='5b53d1a02ce03badd65fd564bb4b4dcfa4e78a1d'
COMMIT='3f69f9dd89c652957eccb23cbddde201e16a0fa6'
BRANCH='progress/cleaning-light-20261009'
REPO='repos/aeroooooplane/Store-Design'
CACHE=ROOT/'资源库/90_处理过程与审核/数据清洗-20261009/_cache/light-api-publish-01'

def command(args, data=None):
    p=subprocess.run(args,cwd=ROOT,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if p.returncode:raise RuntimeError(p.stderr.decode('utf-8',errors='replace'))
    return p.stdout

def git(*args):return command(['git',*args])
def api(endpoint, data=None):
    args=['gh','api',REPO+'/'+endpoint]
    if data is not None:args+=['--method','POST','--input','-']
    return json.loads(command(args,json.dumps(data,ensure_ascii=False).encode('utf-8') if data is not None else None))

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    assert git('rev-parse','HEAD').decode().strip()==BASE
    assert api('git/ref/heads/main')['object']['sha']==BASE
    assert not git('ls-remote','--heads','origin',BRANCH).strip()
    before_index=git('diff','--cached','--binary')
    before_head=git('symbolic-ref','HEAD')
    records=git('diff-tree','--no-commit-id','--name-only','-r','-z',COMMIT).decode('utf-8').strip('\0').split('\0')
    assert len(records)==299
    tree=[];total=0
    for name in records:
        assert name.startswith(('tools/data-cleaning/light-handoff-20261009-01/','tools/data-cleaning/full-run-02/'))
        assert not any(part in name.split('/') for part in ['_cache','__pycache__','.venv'])
        blob=git('show',COMMIT+':'+name)
        assert len(blob)<2*1024*1024
        text=blob.decode('utf-8')
        assert not text.startswith('version https://git-lfs.github.com/spec/v1')
        tree.append(dict(path=name,mode='100644',type='blob',content=text));total+=len(blob)
    assert total==8485916
    base_tree=git('rev-parse',BASE+'^{tree}').decode().strip()
    expected_tree=git('rev-parse',COMMIT+'^{tree}').decode().strip()
    CACHE.mkdir(parents=True,exist_ok=False)
    print('Uploading reviewed text tree only:',len(tree),'files,',total,'bytes',flush=True)
    remote_tree=api('git/trees',dict(base_tree=base_tree,tree=tree))['sha']
    assert remote_tree==expected_tree,('Tree differs',remote_tree,expected_tree)
    raw=git('cat-file','commit',COMMIT).decode('utf-8')
    header,message=raw.split('\n\n',1)
    identities={}
    for role in ['author','committer']:
        line=next(s for s in header.splitlines() if s.startswith(role+' '))
        m=re.fullmatch(role+r' (.+) <([^>]+)> (\d+) ([+-])(\d\d)(\d\d)',line)
        assert m
        offset=(int(m[5])*60+int(m[6]))*(1 if m[4]=='+' else -1)
        date=datetime.fromtimestamp(int(m[3]),timezone(timedelta(minutes=offset))).isoformat()
        identities[role]=dict(name=m[1],email=m[2],date=date)
    result=api('git/commits',dict(message=message,tree=remote_tree,parents=[BASE],**identities))
    remote_commit=result['sha']
    # Creating a reference fails if the name already exists; never update or force it.
    ref=api('git/refs',dict(ref='refs/heads/'+BRANCH,sha=remote_commit))
    verified=api('git/ref/heads/'+BRANCH)['object']['sha']
    assert verified==remote_commit
    assert api('git/commits/'+verified)['tree']['sha']==expected_tree
    assert api('git/ref/heads/main')['object']['sha']==BASE
    assert git('diff','--cached','--binary')==before_index and git('symbolic-ref','HEAD')==before_head
    receipt=dict(schemaVersion=1,generatedAt=datetime.now(timezone.utc).isoformat(),
        generator=dict(script='light-api-publish-01/publish.py',version='1.0.0'),
        method='GitHub Git Database REST API through authenticated gh CLI',
        commit=remote_commit,local_commit=COMMIT,tree=remote_tree,branch=BRANCH,
        files=len(tree),uncompressed_bytes=total,remote_verified=True,
        main_and_original_index_preserved=True,pdf_uploaded=False,png_uploaded=False,
        cache_uploaded=False,training_eligible=False,
        start_guide='tools/data-cleaning/light-handoff-20261009-01/START_HERE.md')
    with (CACHE/'publish-receipt.json').open('x',encoding='utf-8') as f:json.dump(receipt,f,ensure_ascii=False,indent=2)
    print(json.dumps(receipt,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
