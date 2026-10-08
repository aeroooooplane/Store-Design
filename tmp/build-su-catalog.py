from pathlib import Path
import json,html,shutil,collections
BASE=Path(__file__).resolve().parents[1]
ROOT=BASE/'资源库/90_处理过程与审核/模型拆分/split-20260925-v2'
m=json.loads((ROOT/'manifest.json').read_text('utf8'))
summary=json.loads((ROOT/'validation-summary.json').read_text('utf8'))
checks={r['asset_id']:r for r in summary['results']}
counts=collections.Counter(a['category'] for a in m['assets'])
cards=[]
for a in m['assets']:
 aid=a['asset_id']; v=checks.get(aid,{}); folder=a.get('folder',''); meta={}
 if folder:meta=json.loads((ROOT/folder/'metadata.json').read_text('utf8'))
 dim=' × '.join(f'{d*1000:.1f}' for d in v.get('source_tight_face_bounds_m',meta.get('world_bounds_m',[])))
 label=html.escape(a['category']+' · '+a['definition'])
 badge='文件检查通过' if v.get('status')=='passed' else '待核查'
 links=' '.join(f'<a href="{html.escape(folder)}/{f}">{name}</a>' for f,name in [('prop-instance.skp','实例版 SKP'),('prop.skp','定义版 SKP'),('prop.dae','DAE'),('metadata.json','尺寸与变换')]) if folder else '导出失败'
 cards.append(f'<article data-search="{label} {aid}"><img loading="lazy" src="{aid}/preview-instance.png" alt="{label}"><h2>{label}</h2><p>{aid} · {len(a["instances"])} 个原始实例</p><p>实例网格 X/Y/Z：{dim} mm</p><p>{badge} · 贴图 {v.get("texture_count","?")} 张</p><nav>{links}</nav></article>')
html_text='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>影石软装模型拆分目录</title><style>body{font:15px/1.6 system-ui,sans-serif;margin:0;background:#f4f5f7;color:#172230}header{padding:30px;max-width:1300px;margin:auto}h1{font-size:28px;margin:0}p{margin:8px 0}.note{background:#fff1cf;padding:14px;border-radius:8px}input{padding:12px;font:inherit;width:95%;max-width:600px;border:1px solid #aaa;border-radius:6px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;max-width:1300px;margin:auto;padding:0 30px 35px}article{background:white;padding:15px;border:1px solid #ddd;border-radius:10px}article img{width:100%;height:190px;object-fit:contain}h2{font-size:17px}article p{font-size:13px;color:#536273}a{color:#0965bd;margin-right:10px}nav{margin-top:14px}</style><header><h1>影石软装模型拆分目录</h1>'''
html_text+=f'<p>{len(m["assets"])} 项资产 · 对应 {sum(len(a["instances"]) for a in m["assets"])} 个源模型实例 · SketchUp {m["sketchup_version"]}</p>'
html_text+='<p>'+ ' / '.join(f'{html.escape(k)} {v}' for k,v in counts.items())+'</p>'
html_text+='<p class="note">按源模型完整组拆分，桌上展品与桌体保持组合；桌椅组、灯具组等仍是组合资产。优先使用实例版 SKP（保留缩放、旋转及组级材质，移除源场景平移）；定义版 SKP 留作原始组件，DAE 保留代表实例的世界变换。SI版本、正面方向尚未确认，不能按颜色推断。文件检查涵盖网格尺寸和贴图完整性，未完成逐面材质验收或GLB转换。</p><p><a href="manifest.json">完整实例清单</a><a href="validation-summary.json">检查报告</a><a href="split-plan.json">174项拆分决策</a></p><input id="q" placeholder="搜索类别、原名称或资产编号" aria-label="搜索资产"></header><main>'+''.join(cards)+'</main><script>document.getElementById("q").addEventListener("input",e=>{const q=e.target.value.toLowerCase();document.querySelectorAll("article").forEach(x=>x.hidden=!x.dataset.search.toLowerCase().includes(q))})</script></html>'
(ROOT/'index.html').write_text(html_text,encoding='utf8')
for f in ['split-plan.json','root-inventory.json','component-inventory-20260925-202307-154368.json']:
 shutil.copy2(BASE/'tools/sketchup/exports'/f,ROOT/f)
rows=['# 影石软装拆分结果','',f'共 {len(m["assets"])} 项资产，对应 {sum(len(a["instances"]) for a in m["assets"])} 个源实例。','',f'结构检查通过 {summary["passed"]}/{summary["checked"]} 项。','', '入口：index.html；文件映射：manifest.json；检查报告：validation-summary.json。','', '每个 asset-编号 目录含 preview.png、validation.json 和 selected-时间目录；后者含 prop-instance.skp（推荐）、prop.skp（原定义）、prop.dae、metadata.json 及贴图目录。完整保留目录结构。','', 'prop-instance.skp 保留源实例的缩放、旋转、镜像和组级材质，仅移除根实例平移；prop.skp 是原组件定义，单独使用时不含根实例变换及根实例材质。原始变换见 metadata.json 与 manifest.json。DAE 为代表实例的世界变换。没有根据占位盒拉伸或修改道具。','', '组合道具按源分组保留：桌面陈列、桌椅、多灯和多柜组合尚未拆成更细颗粒。SI版本、正面方向未知；未做GLB转换或接入Demo。','', '未保存原模型。启动批处理前与导出后的文件SHA256记录于source-integrity.json。','', '第一次批量运行发生SketchUp退出；不完整输出保留在同级 split-20260925，并有 INTERRUPTED.json 标记。本目录为修复重入问题后的重新导出结果。']
(ROOT/'README.md').write_text('\n'.join(rows),encoding='utf8')
print(dict(counts));print('Catalog written:',ROOT/'index.html')
