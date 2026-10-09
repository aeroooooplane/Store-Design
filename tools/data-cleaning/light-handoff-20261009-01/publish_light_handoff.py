"""Publish only the reviewed lightweight handoff on a new branch.
Uses a separate temporary index; preserves the user's branch and staged changes.
Requires explicit --publish. Never uses force push or resets.
"""
import argparse, hashlib, json, os, subprocess, sys
from pathlib import Path
from datetime import datetime, timezone
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
BRANCH='progress/cleaning-light-20261009'
BASE='5b53d1a02ce03badd65fd564bb4b4dcfa4e78a1d'
REMOTE='https://github.com/aeroooooplane/Store-Design.git'

def git(*args, env=None, input=None):
    result=subprocess.run(['git',*args], cwd=ROOT, env=env, input=input,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('git '+str(args)+': '+result.stderr.decode('utf-8',errors='replace'))
    return result.stdout

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser();parser.add_argument('--publish',action='store_true');args=parser.parse_args()
    paths=sorted(p for p in HERE.rglob('*') if p.is_file() and '__pycache__' not in p.parts)
    old=ROOT/'tools/data-cleaning/full-run-02'
    paths+=sorted(p for p in old.iterdir() if p.is_file() and (p.suffix in {'.py','.md','.txt'} or p.name=='.gitattributes'))
    names=[p.relative_to(ROOT).as_posix() for p in paths]
    if len(names)!=len(set(names)):raise RuntimeError('Duplicate selection')
    if any(p.suffix.lower() in {'.png','.pdf','.xlsx','.zip','.onnx'} or p.stat().st_size>2*1024*1024 for p in paths):
        raise RuntimeError('Unexpected large/binary file')
    size=sum(p.stat().st_size for p in paths)
    if size>12*1024*1024:raise RuntimeError('Lightweight package unexpectedly exceeds 12 MiB')
    if git('rev-parse','HEAD').decode().strip()!=BASE:raise RuntimeError('Local base changed')
    if git('remote','get-url','origin').decode().strip()!=REMOTE:raise RuntimeError('Remote changed')
    staged_before=git('diff','--cached','--binary')
    branch_before=git('symbolic-ref','HEAD')
    print(json.dumps(dict(files=len(paths),bytes=size,branch=BRANCH),ensure_ascii=False),flush=True)
    if not args.publish:return 0
    remote_main=git('ls-remote','--heads','origin','main').decode().split()[0]
    if remote_main!=BASE:raise RuntimeError('Remote main advanced; review before publishing')
    if git('ls-remote','--heads','origin',BRANCH).strip():raise RuntimeError('Remote handoff branch already exists')
    check=subprocess.run(['git','show-ref','--verify','--quiet','refs/heads/'+BRANCH],cwd=ROOT)
    if check.returncode!=1:raise RuntimeError('Local branch exists or reference check failed')
    area=ROOT/'资源库/90_处理过程与审核/数据清洗-20261009/_cache/light-git-publish-01'
    area.mkdir(parents=True,exist_ok=False)
    specs=area/'pathspecs.nul'
    specs.write_bytes(b'\0'.join(n.encode('utf-8') for n in names)+b'\0')
    env=dict(os.environ,GIT_INDEX_FILE=str(area/'isolated.index'))
    git('read-tree',BASE,env=env)
    git('-c','core.autocrlf=false','add','--pathspec-from-file='+str(specs),'--pathspec-file-nul',env=env)
    changed=set(git('diff','--cached','--name-only','-z',env=env).decode('utf-8').strip('\0').split('\0'))
    if changed!=set(names):raise RuntimeError('Staged paths differ from reviewed selection')
    if git('diff','--cached','--name-only','--diff-filter=DMRTUXB',env=env).strip():
        raise RuntimeError('Selection includes modifications/deletions; expected additions only')
    # Confirm Git contains exact reviewed bytes, irrespective of global autocrlf.
    for p,n in zip(paths,names):
        blob=git('show',':'+n,env=env)
        if hashlib.sha256(blob).hexdigest()!=sha(p):raise RuntimeError('Git changed bytes: '+n)
    tree=git('write-tree',env=env).decode().strip()
    message='Add lightweight store-cleaning handoff and isolated rebuild entry\n\nPreserve source IDs and human review records; rebuild large caches on another computer. No drawings or machine caches included.\n'
    commit=git('commit-tree',tree,'-p',BASE,input=message.encode('utf-8')).decode().strip()
    git('update-ref','refs/heads/'+BRANCH,commit,'0'*40)
    git('push','origin',commit+':refs/heads/'+BRANCH)
    if git('symbolic-ref','HEAD')!=branch_before or git('diff','--cached','--binary')!=staged_before:
        raise RuntimeError('Concurrent change to working branch/index detected; no reset attempted')
    remote_commit=git('ls-remote','--heads','origin',BRANCH).decode().split()[0]
    if remote_commit!=commit:raise RuntimeError('Remote verification mismatch')
    report=dict(schemaVersion=1,generatedAt=datetime.now(timezone.utc).isoformat(),
                generator=dict(script='publish_light_handoff.py',version='1.0.0'),
                base_commit=BASE,commit=commit,branch=BRANCH,files=len(paths),uncompressed_bytes=size,
                main_and_original_index_preserved=True,remote_verified=True,
                pdf_uploaded=False,cache_uploaded=False)
    with (area/'publish-receipt.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
    print(json.dumps(report,ensure_ascii=False),flush=True)
    return 0

if __name__=='__main__':raise SystemExit(main())
