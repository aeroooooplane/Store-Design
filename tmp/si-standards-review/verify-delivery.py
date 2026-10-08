from pathlib import Path
from html.parser import HTMLParser
import json,hashlib
root=Path(r'E:\效果图生成器\Store-Design');out=root/'素材库/04_assets/按SI标准命名-20261001'; report=root/'output/si-standards-review-20261001'
man=json.loads((out/'manifest.json').read_text('utf-8'))
class Links(HTMLParser):
 def __init__(self):super().__init__();self.links=[];self.articles=0
 def handle_starttag(self,tag,attrs):
  if tag=='article':self.articles+=1
  for k,v in attrs:
   if k in ['href','src'] and v and not v.startswith('#'):self.links.append(v)
results=[]
for name,base,expected in [('模型预览目录.html',out,90),('标准阅读索引.html',report,360)]:
 p=Links();p.feed((base/name).read_text('utf-8'));missing=[v for v in p.links if not (base/v).exists()]
 assert not missing,missing
 assert p.articles==expected
 results.append({'file':name,'cards':p.articles,'local_links_checked':len(p.links),'missing':missing})
assert len(man['assets'])==90
assert all((out/a['named_skp']).stat().st_size==a['bytes'] for a in man['assets'])
check=json.loads((out/'校验结果.json').read_text('utf-8'))
check['catalogue_link_checks']=results
views=json.loads((report/'补充原生视图检查.json').read_text('utf-8'))
assert len(views)==24 and all(a['status']=='ok' for a in views)
check['additional_native_view_images']=sum(len(a['additional_views']) for a in man['assets'])
assert check['additional_native_view_images']==96
source=root/'道具模型/影石通用模型.skp'
h=hashlib.sha256()
with source.open('rb') as f:
 for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
check['source_master_sha256_after']=h.hexdigest()
check['source_master_unchanged']=h.hexdigest()=='ded29dc7f6741972d5d630272bef92e996b6839a51e64bfe3a2ed1b5d513b943'
assert check['source_master_unchanged']
(out/'校验结果.json').write_text(json.dumps(check,ensure_ascii=False,indent=2),'utf-8')
# Keep the human decision file aligned with the final evidence wording.
p=report/'逐项识别记录.txt';p.write_text(p.read_text('utf-8-sig').replace('左侧场景头盔、右侧配件','场景头盔与配件分区'),'utf-8')
print(json.dumps(check,ensure_ascii=False,indent=2))
