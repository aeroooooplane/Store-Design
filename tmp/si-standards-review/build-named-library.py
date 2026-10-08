from pathlib import Path
import json, csv, hashlib, shutil, re, html, zipfile
from collections import Counter
from PIL import Image
ROOT=Path(r'E:\效果图生成器\Store-Design')
WORK=ROOT/'tmp/si-standards-review'
BASE=ROOT/'素材库/04_assets/incoming/split-20260925-v2'
OUT=ROOT/'素材库/04_assets/按SI标准命名-20261001'
REPORT=ROOT/'output/si-standards-review-20261001'
OUT.mkdir(parents=True,exist_ok=True); REPORT.mkdir(parents=True,exist_ok=True)
(OUT/'预览').mkdir(exist_ok=True)
source=json.loads((BASE/'manifest.json').read_text('utf-8'))
lines=(WORK/'naming-decisions.txt').read_text('utf-8-sig').strip().splitlines()
assert len(lines)==len(source['assets'])==90

def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for chunk in iter(lambda:f.read(8*1024*1024),b''): h.update(chunk)
 return h.hexdigest()

rows=[]
for line,a in zip(lines,source['assets']):
 n,si,name,variant,match,refs,reason=line.split('|')
 assert int(n)==len(rows)+1
 if int(n)==77: reason=reason.replace('左侧场景头盔、右侧配件','场景头盔与配件分区')
 aid=a['asset_id']; src=BASE/a['recommended_skp']
 filename=f'{si}_{name}_{variant}__{aid}.skp'
 assert not re.search(r'[<>:"/\\|?*]',filename)
 dest=OUT/si/filename; dest.parent.mkdir(exist_ok=True)
 assert len(str(dest))<240
 src_hash=digest(src)
 if dest.exists():
  assert digest(dest)==src_hash, f'Existing different file: {dest}'
 else: shutil.copy2(src,dest)
 assert digest(dest)==src_hash
 validation=json.loads((BASE/aid/'validation.json').read_text('utf-8'))
 views=sorted((WORK/'model-views').glob(f'{aid}-[0-3].png'))
 # Native views provide a better front view for the 24 inspected ambiguous assets.
 preview_src=views[0] if views else BASE/aid/'preview-instance.png'
 pic=Image.open(preview_src).convert('RGB');pic.thumbnail((960,800));pic.save(OUT/'预览'/f'{aid}.jpg',quality=90)
 viewlinks=[]
 for p in views:
  target=OUT/'预览'/f'{p.stem}.jpg'
  im=Image.open(p).convert('RGB');im.thumbnail((960,800));im.save(target,quality=88)
  viewlinks.append(target.relative_to(OUT).as_posix())
 row={'n':int(n),'asset_id':aid,'si_family':si,'standard_name':name,'variant':variant,'match':match,'confidence':'低（用途）' if match=='待确认' else ('中（家族或变体）' if match in ['变体','非标'] else '高（类型）'), 'reference_pages':refs,'judgment':reason,'old_category':a['category'],'old_definition':a['definition'],'original_instances':len(a['instances']),'source_skp':src.relative_to(ROOT).as_posix(),'named_skp':dest.relative_to(OUT).as_posix(),'preview':f'预览/{aid}.jpg','additional_views':viewlinks,'tight_face_bounds_xyz_mm':[round(v*1000,2) for v in validation['source_tight_face_bounds_m']],'source_sha256':src_hash,'named_sha256':digest(dest),'bytes':dest.stat().st_size,'prior_native_validation':validation.get('native_sketchup_read_check',{}).get('status')}
 rows.append(row)
 print(f'{n}/90 {aid} {filename}',flush=True)
counts=dict(Counter(a['si_family'] for a in rows));matches=dict(Counter(a['match'] for a in rows))
manifest={'created':'2026-10-01','scope':'90 distinct split assets, preserving source instance transforms and embedded materials','source_manifest':str((BASE/'manifest.json').relative_to(ROOT)).replace('\\','/'),'file_operation':'named byte-identical copies; original incoming files retained','dimension_note':'XYZ visible face bounds include products/stools/labels, and rotation; not nominal furniture WDH','classification_note':'SI family is visual/structural attribution, not a manufacturing compliance certificate; see match and judgment','counts_by_si':counts,'counts_by_match':matches,'assets':rows}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),'utf-8')
headers={'n':'序号','asset_id':'原资产ID','si_family':'SI归类','standard_name':'标准名称或描述','variant':'变体说明','match':'对应程度','confidence':'判断把握','reference_pages':'依据页码','judgment':'识别依据','old_category':'旧分类','old_definition':'旧组件名','original_instances':'原场景实例数','source_skp':'原文件_相对项目根目录','named_skp':'新文件_相对本目录','tight_face_bounds_xyz_mm':'可见几何XYZ毫米_不是台体净尺寸','source_sha256':'原文件SHA256','named_sha256':'新文件SHA256','prior_native_validation':'既有原生验证'}
with (OUT/'命名对照.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f);w.writerow(headers.values())
 for a in rows:w.writerow([a[k] for k in headers])
shutil.copy2(WORK/'naming-decisions.txt',REPORT/'逐项识别记录.txt')
(REPORT/'标准页面').mkdir(exist_ok=True)
page_rows=[]
parts=['SI1-part1','SI1-part2','SI1-part3','SI1-part4','SI1-part5','SI2']
for part in parts:
 texts=json.loads((WORK/f'{part}-text.json').read_text('utf-8'))
 folder=REPORT/'标准页面'/part;folder.mkdir(exist_ok=True)
 for page in texts:
  num=page['page'];p=WORK/part/f'幻灯片{num}.PNG';assert p.exists()
  dest=folder/f'{num:03}.jpg'
  if not dest.exists():Image.open(p).convert('RGB').save(dest,quality=86)
  page_rows.append({'source':part,'physical_page':num,'text':page['text'],'preview':dest.relative_to(REPORT).as_posix(),'review':'文字读取及页面图像核对；关键道具另作原尺寸详图对照'})
assert len(page_rows)==360
(REPORT/'逐页文字与阅读索引.json').write_text(json.dumps(page_rows,ensure_ascii=False,indent=2),'utf-8')
standard_files=sorted((ROOT/'设计标准').glob('*'))
(REPORT/'原标准文件校验.json').write_text(json.dumps([{'filename':p.name,'bytes':p.stat().st_size,'sha256':digest(p)} for p in standard_files if p.is_file()],ensure_ascii=False,indent=2),'utf-8')
shutil.copy2(WORK/'model-views/complete.json',REPORT/'补充原生视图检查.json')
# Static local catalogue, no web dependencies or network calls.
e=html.escape
cards=[]
for a in rows:
 dims=' × '.join(str(v) for v in a['tight_face_bounds_xyz_mm'])
 links=' · '.join(f'<a href="{e(v)}">视角{i+1}</a>' for i,v in enumerate(a['additional_views']))
 cards.append(f'''<article id="{a['asset_id']}"><a href="{e(a['preview'])}"><img loading="lazy" src="{e(a['preview'])}" alt="{e(a['standard_name'])}"></a><div class="body"><div class="tag">{e(a['si_family'])} · {e(a['match'])} · {a['asset_id']}</div><h2>{a['n']:02} {e(a['standard_name'])}</h2><p>{e(a['variant'])}</p><p class="reason">{e(a['judgment'])}</p><p class="small">依据：{e(a['reference_pages'])}<br>可见几何 XYZ：{dims} mm（含陈列，不是柜体净尺寸）</p><a class="file" href="{e(a['named_skp'])}">打开对应 SU 文件 ↗</a><p class="small">{links}</p></div></article>''')
style='''*{box-sizing:border-box}body{margin:0;background:#f4f3ee;color:#222;font:15px/1.6 "Microsoft YaHei",sans-serif}header,main{max-width:1440px;margin:auto;padding:32px}header{padding-bottom:8px}h1{font-size:34px;margin:8px 0}h2{font-size:19px;margin:8px 0}a{color:#185b4c}nav{display:flex;gap:18px;flex-wrap:wrap;margin:20px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:22px}article{background:white;border:1px solid #ddd;border-radius:12px;overflow:hidden}article img{width:100%;height:250px;object-fit:contain;background:#fafafa}.body{padding:20px}.tag{font-size:12px;font-weight:700;color:#786414}.small{font-size:12px;color:#666}.reason{min-height:70px}.file{font-weight:700}.note{padding:18px;background:#e9eee6;border-left:4px solid #41633b}'''
(OUT/'模型预览目录.html').write_text(f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SI 模型命名目录 · 90件</title><style>{style}</style><header><div>STORE DESIGN / 2026.10.01</div><h1>SI 模型命名目录</h1><p>90 件模型 · SI1.0 {counts.get('SI1.0',0)} 件 / SI2.0 {counts.get('SI2.0',0)} 件 / 通用 {counts.get('通用',0)} 件 / 非标 {counts.get('非标',0)} 件</p><div class="note">已按标准术语与实际结构命名。对应款、变体及非标件分别标注；SI 家族归类不代表所有尺寸均符合生产标准。使用 Ctrl+F 搜索名称或资产 ID。点击图片放大查看。</div><nav><a href="命名对照.csv">命名对照表</a><a href="使用指引.md">使用指引</a><a href="../../../output/si-standards-review-20261001/标准阅读索引.html">两套标准 · 360页</a><a href="../../../docs/si-standards-review-20261001.md">阅读与判断记录</a><a href="#asset-3356988">唯一用途未定项</a></nav></header><main><div class="grid">{''.join(cards)}</div></main></html>''','utf-8')
pagecards=[]
for a in page_rows:
 pagecards.append(f'<article id="{a["source"]}-{a["physical_page"]}"><a href="{e(a["preview"])}"><img loading="lazy" src="{e(a["preview"])}" alt="标准页"></a><div class="body"><h2>{a["source"]} · 第{a["physical_page"]}页</h2><details><summary>查看提取文字</summary><pre style="white-space:pre-wrap">{e(a["text"])}</pre></details></div></article>')
(REPORT/'标准阅读索引.html').write_text(f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>SI标准阅读索引</title><style>{style}</style><header><h1>两套 SI 标准 · 360 页阅读索引</h1><p>SI1-part1～5 对应压缩包的第1—2章、第3章、第4章、第5章、第6—8章；SI2为单独PPT。页码均为各文件物理页序。点击图像查看1600×900页面；图内细字以原PPT为准。</p></header><main><div class="grid">'+''.join(pagecards)+'</div></main></html>','utf-8')
checks={'date':'2026-10-01','source_assets':len(source['assets']),'named_skp_count':len(list(OUT.rglob('*.skp'))),'unique_names':len({a['named_skp'].casefold() for a in rows}),'hash_identical_count':sum(a['source_sha256']==a['named_sha256'] for a in rows),'prior_native_pass_count':sum(a['prior_native_validation']=='passed' for a in rows),'reviewed_standard_pages':len(page_rows),'additional_native_views_assets':len(json.loads((WORK/'model-views/complete.json').read_text('utf-8'))),'counts_by_si':counts,'counts_by_match':matches,'total_model_bytes':sum(a['bytes'] for a in rows),'note':'This run validates byte-identical naming copies. The 90 native load checks were from the existing batch; this run additionally loaded 24 ambiguous assets for 96 views. No source model was resaved.'}
assert checks['named_skp_count']==checks['unique_names']==checks['hash_identical_count']==90
(OUT/'校验结果.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),'utf-8')
print(json.dumps(checks,ensure_ascii=False,indent=2))
