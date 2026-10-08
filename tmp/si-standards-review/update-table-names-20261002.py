from pathlib import Path
import json,csv,re,html,hashlib
from collections import Counter
from html.parser import HTMLParser
root=Path(r'E:\效果图生成器\Store-Design');base=root/'资源库/04_软装道具模型/单件模型'
p=base/'manifest.json';m=json.loads(p.read_text('utf-8'));changes=[]
page=base/'模型预览目录.html';ht=page.read_text('utf-8')
for a in m['assets']:
 name=a['standard_name']
 if name not in ['1800mm中岛桌','1800mm开箱桌','1.8米中岛桌','1.8米开箱桌']:continue
 old=dict(a);kind='亮脚' if a['asset_id'] in ['asset-41053706','asset-41277543'] else '普通'
 table='中岛桌' if '中岛桌' in name else '开箱桌'
 a['manual_name']=name;a['category']=kind+table
 a['standard_name']=name.replace(table,kind+table)
 a['variant']=a['variant'].replace('四脚变体_','')
 a['judgment']+='；2026-10-02按用户术语归类为'+a['category']+'（'+('四条独立桌腿' if kind=='亮脚' else '整体底座')+'）'
 a['named_skp']=f"{a['si_family']}/{a['si_family']}_{a['standard_name']}_{a['variant']}__{a['asset_id']}.skp"
 src=base/old['named_skp'];dst=base/a['named_skp']
 assert src.is_file() and not dst.exists()
 assert src.parent.resolve()==dst.parent.resolve() and base.resolve() in dst.resolve().parents
 src.rename(dst)
 assert hashlib.sha256(dst.read_bytes()).hexdigest()==a['named_sha256']
 pattern=r'<article id="'+re.escape(a['asset_id'])+r'">.*?</article>'
 block=re.search(pattern,ht,re.S).group(0)
 updated=block.replace(html.escape(old['named_skp']),html.escape(a['named_skp'])).replace(html.escape(old['standard_name']),html.escape(a['standard_name'])).replace(html.escape(old['variant']),html.escape(a['variant'])).replace(html.escape(old['judgment']),html.escape(a['judgment']))
 ht=ht.replace(block,updated)
 changes.append({'asset_id':a['asset_id'],'category':a['category'],'old_name':old['standard_name'],'new_name':a['standard_name'],'old_variant':old['variant'],'new_variant':a['variant'],'old_file':old['named_skp'],'new_file':a['named_skp'],'judgment':a['judgment']})
assert len(changes)==8
m['updated']='2026-10-02';m['table_naming_rule']={'普通':'整体底座','亮脚':'四条独立桌腿','authority':'用户2026-10-02明确命名要求','manual_name':'保留手册原名，项目展示名称使用四个品类'}
p.write_text(json.dumps(m,ensure_ascii=False,indent=2),'utf-8')
ht=ht.replace('使用 Ctrl+F 搜索名称或资产 ID。','桌型统一称为普通中岛桌、亮脚中岛桌、普通开箱桌、亮脚开箱桌；普通为整体底座，亮脚为四条腿。使用 Ctrl+F 搜索名称或资产 ID。')
page.write_text(ht,'utf-8')
csvpath=base/'命名对照.csv'
with csvpath.open(encoding='utf-8-sig',newline='') as f:r=csv.DictReader(f);fields=r.fieldnames;records=list(r)
byid={c['asset_id']:c for c in changes}
for row in records:
 c=byid.get(row['原资产ID'])
 if c:
  row['标准名称或描述']=c['new_name'];row['变体说明']=c['new_variant'];row['新文件_相对本目录']=c['new_file'];row['识别依据']=c['judgment']
with csvpath.open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(records)
for txt in [root/'资源库/05_店铺形象设计标准/历史阅读记录/逐项识别记录.txt',root/'tmp/si-standards-review/naming-decisions.txt']:
 lines=txt.read_text('utf-8-sig').splitlines();byn={a['n']:a for a in m['assets'] if a['asset_id'] in byid};out=[]
 for line in lines:
  cells=line.split('|');a=byn.get(int(cells[0])) if cells and cells[0].isdigit() else None
  if a:cells[2]=a['standard_name'];cells[3]=a['variant'];cells[6]=a['judgment']
  out.append('|'.join(cells))
 txt.write_text('\n'.join(out)+'\n','utf-8')
counts=dict(Counter(c['category'] for c in changes))
log={'date':'2026-10-02','rule':m['table_naming_rule'],'counts':counts,'changes':changes,'verification':{'renamed_files':8,'hash_identical':8,'all_library_files':len(list(base.rglob('*.skp')))}}
class Links(HTMLParser):
 def __init__(self):super().__init__();self.links=[]
 def handle_starttag(self,tag,attrs):
  self.links.extend(v for k,v in attrs if k in ['href','src'] and v and not v.startswith('#'))
parser=Links();parser.feed(ht);assert all((base/link).exists() for link in parser.links)
assert all((base/a['named_skp']).is_file() for a in m['assets'])
assert len(list(base.rglob('*.skp')))==90
log['verification']['catalogue_links_valid']=len(parser.links)
(base/'桌型命名更新-20261002.json').write_text(json.dumps(log,ensure_ascii=False,indent=2),'utf-8')
checkpath=base/'校验结果.json';check=json.loads(checkpath.read_text('utf-8'));check['table_naming_update_20261002']=log['verification'];checkpath.write_text(json.dumps(check,ensure_ascii=False,indent=2),'utf-8')
section='''\n\n## 2026-10-02 桌型名称更新（用户确认）\n\n项目内统一使用四个品类：普通中岛桌、亮脚中岛桌、普通开箱桌、亮脚开箱桌。普通指下方为整体底座；亮脚指四条独立桌腿，与凳子的腿型无关。\n\n本库涉及8件：普通中岛桌4件、亮脚中岛桌1件、普通开箱桌2件、亮脚开箱桌1件。两款原“四脚变体”改用“亮脚”作为正式项目品类名。手册中的原始名称与详图差异记录仍保留，不修改标准原文；manifest的manual_name可回查手册原名。开箱储物柜、单面开箱桌等其他用途不纳入这四类重命名。\n\nSU文件名、预览目录、CSV、manifest和逐项识别记录已同步；8件文件校验值与改名前一致，总数仍为90件。新旧路径见桌型命名更新-20261002.json。\n'''
for doc in [base/'使用指引.md',root/'docs/si-standards-review-20261001.md']:
 with doc.open('a',encoding='utf-8') as f:f.write(section)
print(json.dumps({'counts':counts,'verification':log['verification']},ensure_ascii=False,indent=2))
