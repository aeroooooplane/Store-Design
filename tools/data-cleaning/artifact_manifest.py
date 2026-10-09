"""Inventory task-owned artifacts only; do not include unrelated user changes."""
from package_pilot import *
def main():
    target=OUT/'09_新增文件清单.json'
    if target.exists():raise FileExistsError(target)
    roots=[ROOT/'tools/data-cleaning',OUT,ANNOTATIONS];files=[];environment=[]
    for root in roots:
        for p in sorted(root.rglob('*')):
            if not p.is_file():continue
            rel=p.relative_to(ROOT).as_posix()
            if '.venv' in p.parts or '__pycache__' in p.parts:
                environment.append(dict(path=rel,bytes=p.stat().st_size));continue
            files.append(dict(path=rel,bytes=p.stat().st_size,sha256=digest(p)))
    write(target,dict(owned_roots=[str(p) for p in roots],artifacts=files,artifact_count=len(files),environment_files=environment,environment_file_count=len(environment),note='清单不包含自身；只枚举本任务新建的3个目录。虚拟环境及字节码列路径和大小，其余列SHA256。用户其他并发新增目录不属于本任务。',training_eligible=False,task_complete=False))
    print('artifacts',len(files),'environment',len(environment),flush=True)
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');main()
