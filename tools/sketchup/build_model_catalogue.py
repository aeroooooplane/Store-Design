"""Render the local and website model catalogue from its reviewed manifest."""
from pathlib import Path
from collections import Counter
import json,html,csv,re
ROOT=Path(__file__).resolve().parents[2]
import sys
sys.exit('模型目录页与清单已改由 tools/library/refresh-library.mjs 生成：pnpm library:refresh（2026-10-10 模型库重排）')
BASE=ROOT/'资源库/04_模型库'
m=json.loads((BASE/'manifest.json').read_text('utf-8'));rows=m['assets'];e=lambda v:html.escape(str(v),quote=True)
cats=['软装物料','信息化物料','展陈物料'];counts=Counter(a['material_category'] for a in rows)
rows=sorted(rows,key=lambda a:(cats.index(a['material_category']),{'SI1.0':0,'SI2.0':1,'SI待确认':2,None:0}[a['material_si']],a['material_sort'],a['standard_name'],a['n']))
placement_path=ROOT/'demo/src/data/placement-manifest.json'
placements={a['id']:a for a in json.loads(placement_path.read_text('utf-8'))['assets']} if placement_path.exists() else {}
sections=[]
for cat in cats:
 subs=['SI1.0','SI2.0','SI待确认'] if cat=='软装物料' else [None]
 for sub in subs:
  group=[a for a in rows if a['material_category']==cat and a['material_si']==sub]
  if not group:continue
  cards=[]
  for a in group:
   legend=a['plan_legend']
   if legend:
    raw_link=f'<a class="small" href="{e(legend["raw_file"])}" target="_blank" rel="noreferrer">查看原始裁片 ↗</a>' if legend.get('raw_file') else ''
    legend_html=f'''<a href="{e(legend['file'])}" target="_blank" rel="noreferrer"><img class="plan-image" loading="lazy" src="{e(legend['file'])}" alt="{e(legend['label'])}平面图例"></a><p class="legend-title">{e(legend['status'])}</p><p class="small">{e(legend['note'])}</p><details><summary>原图参考与来源</summary>{raw_link}<br><a class="small" href="{e(legend['context'])}" target="_blank" rel="noreferrer">来源：{e(Path(legend['source_pdf']).stem)} · 第{legend['page']}页 ↗</a></details>'''
   else:legend_html=f'<div class="no-legend">尚未确认平面图例</div><p class="small">{e(a["plan_legend_missing_reason"])}</p>'
   views=' · '.join(f'<a href="{e(v)}" target="_blank" rel="noreferrer">视角{i+1}</a>' for i,v in enumerate(a['additional_views']))
   search=e(' '.join(str(a.get(k,'')) for k in ['standard_name','variant','asset_id','si_family','material_category','category'])+' 莱卡墙' if '徕卡' in a['standard_name'] else ' '.join(str(a.get(k,'')) for k in ['standard_name','variant','asset_id','si_family','material_category','category']))
   placement=placements.get(a['asset_id'])
   placement_html=(f'<a class="file placement-link" href="/?asset={a["asset_id"]}">前往工作台摆放 ↗</a><p class="small">GLB {placement["bytes"]/1048576:.1f} MB · 尺寸/原点已校验，材质/正面待验收</p>' if placement else '<p class="small">暂未接入摆放清单</p>')
   cards.append(f'''<article id="{a['asset_id']}" data-cat="{cat}" data-si="{e(sub or '')}" data-search="{search}" data-legend="{str(bool(legend)).lower()}"><div class="card-heading"><span class="tag">{e(sub or cat)} · {e(a['match'])}</span><h2>{e(a['standard_name'])}</h2><p>{e(a['variant'])}</p></div><div class="visuals"><figure><figcaption>模型预览</figcaption><a href="{e(a['preview'])}" target="_blank" rel="noreferrer"><img class="model-image" loading="lazy" src="{e(a['preview'])}" alt="{e(a['standard_name'])}"></a></figure><figure class="legend"><figcaption>纯净平面图例</figcaption>{legend_html}</figure></div><div class="card-footer"><a class="file" href="{e(a['named_skp'])}">下载 SU 模型 ↗</a>{placement_html}<details><summary>识别依据与更多视角</summary><p>{e(a['judgment'])}</p><p class="small">{e(a['reference_pages'])}<br>可见几何 XYZ：{' × '.join(str(x) for x in a['tight_face_bounds_xyz_mm'])} mm（含陈列，不是柜体净尺寸）</p><p>{views}</p><small>{a['asset_id']}</small></details></div></article>''')
  title=cat+(' / '+sub if sub else '')
  sections.append(f'<section class="group" data-cat="{cat}" data-si="{e(sub or "")}"><div class="group-title"><h2>{title}</h2><span>{len(group)} 件</span></div>'+('<p class="small">两件非标家具仍缺少明确的SI归属，单列待确认。</p>' if sub=='SI待确认' else '')+'<div class="grid">'+''.join(cards)+'</div></section>')
css='\n'.join((ROOT/'demo/src/styles'/name).read_text('utf-8') for name in ['tokens.css','model-library.css'])
buttons='<button type="button" data-filter="全部" aria-pressed="true">全部 · 90</button>'+''.join(f'<button type="button" data-filter="{c}" aria-pressed="false">{c} · {counts[c]}</button>' for c in cats)
js='''const cards=[...document.querySelectorAll('article')],groups=[...document.querySelectorAll('.group')];let category='全部';const search=document.querySelector('#search'),si=document.querySelector('#si'),only=document.querySelector('#only-legend');function update(){const q=search.value.trim().toLowerCase();let count=0;for(const card of cards){const show=(category==='全部'||card.dataset.cat===category)&&(!si.value||card.dataset.si===si.value)&&(!only.checked||card.dataset.legend==='true')&&card.dataset.search.toLowerCase().includes(q);card.hidden=!show;if(show)count++}for(const group of groups)group.hidden=![...group.querySelectorAll('article')].some(c=>!c.hidden);document.querySelector('#count').textContent=`显示 ${count} / 90 件`;document.querySelector('#empty').hidden=count!==0}for(const button of document.querySelectorAll('[data-filter]'))button.addEventListener('click',()=>{category=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));si.value='';document.querySelector('#si-label').hidden=category!=='软装物料';update()});search.addEventListener('input',update);si.addEventListener('change',update);only.addEventListener('change',update);update();'''
htmltext=f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SI 模型库 · 分类与平面图例</title><style>{css}</style></head><body><header><div class="small">STORE DESIGN / 模型与平面图例</div><h1>SI 模型库</h1><p class="intro">软装物料按 SI 分组；广告机与电子水牌归入信息化物料，其他摆设、标识与道具归入展陈物料。</p><p class="small">纯净图例由对应 SU 模型生成，无文字、尺寸及背景杂线。实线表示俯视可见轮廓，桌型虚线表示已核对的底座或桌腿截面；卡片适应显示，不作为同比例施工图。原始门店裁片保留在来源中。</p><nav><a href="命名对照.csv">命名对照表</a><a href="使用指引.md">使用指引</a><a href="../../../资源库/05_店铺形象设计标准/历史阅读记录/标准阅读索引.html">两套标准 · 360页</a><a href="../../../docs/si-standards-review-20261001.md">阅读与判断记录</a><a href="平面图例/index.json">图例来源与处理记录</a></nav></header><div class="filters"><div class="tabs" role="group" aria-label="物料分类">{buttons}</div><div class="secondary"><input id="search" type="search" aria-label="搜索模型" placeholder="搜索桌型、柜体、尺寸或资产编号"><label id="si-label" hidden>SI版本<select id="si" aria-label="软装SI版本"><option value="">全部SI</option><option>SI1.0</option><option>SI2.0</option><option>SI待确认</option></select></label><label><input type="checkbox" id="only-legend">仅看已有图例</label><span id="count" class="small" role="status"></span></div></div><main>{''.join(sections)}<p id="empty" class="empty" hidden>没有匹配的模型，请调整筛选或搜索词。</p></main><script>{js}</script></body></html>'''
(BASE/'模型预览目录.html').write_text(htmltext,'utf-8')
# Enrich the existing audit CSV without dropping historical columns.
p=BASE/'命名对照.csv'
with p.open(encoding='utf-8-sig',newline='') as f:rd=csv.DictReader(f);fields=list(rd.fieldnames);old={r['原资产ID']:r for r in rd}
extra=['物料大类','软装SI分组','目录顺序','平面图例','图例来源','图例说明']
fields+= [x for x in extra if x not in fields]
with p.open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
 for i,a in enumerate(rows):
  row=old[a['asset_id']];l=a['plan_legend'];row.update({'物料大类':a['material_category'],'软装SI分组':a['material_si'] or '', '目录顺序':i+1,'平面图例':l['file'] if l else '', '图例来源':f"{l['source_pdf']} 第{l['page']}页" if l else '', '图例说明':l['note'] if l else a['plan_legend_missing_reason']});w.writerow(row)
print(json.dumps({'counts':dict(counts),'legend_models':sum(bool(a['plan_legend']) for a in rows)},ensure_ascii=False))

# Keep the published reading index on the same theme without regenerating
# reviewed text, images, asset names or source decisions.
standard=ROOT/'资源库/05_店铺形象设计标准/历史阅读记录/标准阅读索引.html'
if standard.exists():
 text=standard.read_text('utf-8')
 theme='\n'.join((ROOT/'demo/src/styles'/name).read_text('utf-8') for name in ['tokens.css','standards.css'])
 text=re.sub(r'<style>.*?</style>',lambda _: '<style>'+theme+'</style>',text,count=1,flags=re.S)
 if 'name="viewport"' not in text:text=text.replace('<meta charset="utf-8">','<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',1)
 standard.write_text(text,'utf-8')
