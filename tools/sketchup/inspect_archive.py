"""Read archive metadata/previews only; never decode geometry or change the SKP."""
from pathlib import Path
import json, zipfile, xml.etree.ElementTree as ET, html

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / '资源库/04_模型库/_原始整包/影石通用模型.skp'
OUT = ROOT / '资源库/04_模型库/_原始模型预检'
OUT.mkdir(parents=True, exist_ok=True)
rows, materials = [], []
with zipfile.ZipFile(SOURCE) as archive:
    entries = archive.infolist()
    for entry in entries:
        name = entry.filename
        if name.startswith('thumbnails/') and name.endswith('.png'):
            if entry.file_size > 5_000_000:
                continue
            asset_id = f'preview-{len(rows)+1:03d}'
            filename = asset_id + '.png'
            (OUT / filename).write_bytes(archive.read(entry))
            rows.append(dict(id=asset_id, sourceEntry=name, name=Path(name).stem,
                             preview=filename, category='待人工核对', si='待确认',
                             geometryStatus='未提取', dimensions=None,
                             note='嵌入缩略图，可能是产品或子组件；不代表完整道具，也不能据此确认实例数量。'))
        elif name.startswith('materials/') and name.endswith('/material.xml'):
            if entry.file_size > 2_000_000:
                continue
            doc = ET.fromstring(archive.read(entry))
            material = next((el for el in doc.iter() if el.tag.endswith('}material')), None)
            if material is not None:
                materials.append(dict(sourceEntry=name, **material.attrib))
    for name in ['model_thumbnail.png', 'preview_thumbnail.png']:
        (OUT / name).write_bytes(archive.read('meta/' + name))
    geometry = archive.getinfo('model.dat')
    report = dict(source=str(SOURCE.relative_to(ROOT)), sourceBytes=SOURCE.stat().st_size,
                  sourceVersion='26.1.189', archiveEntries=len(entries),
                  geometryBytes=geometry.file_size, geometryCompressedBytes=geometry.compress_size,
                  geometryStatus='not-decoded', embeddedPreviewCount=len(rows), materialCount=len(materials),
                  caveat='材质条目与缩略图数量不是道具数量；无组件层级、实例变换、精确尺寸或可加载网格。')
for filename, data in [('source-report.json', report), ('preview-index.json', rows), ('materials.json', materials)]:
    (OUT / filename).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
cards=''.join(f'<article><a href="{r["preview"]}" target="_blank"><img src="{r["preview"]}" alt="{html.escape(r["name"],quote=True)}"></a><b>{r["id"]}</b><p>{html.escape(r["name"])}</p><small>类别 / SI / 尺寸：待确认</small></article>' for r in rows)
page=f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SU 原始模型预检</title><style>body{{font:16px/1.6 system-ui;background:#eef1ee;color:#20372e;margin:30px}}main{{max-width:1400px;margin:auto}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px}}article{{background:white;padding:16px;border-radius:12px;overflow-wrap:anywhere}}img{{width:100%;max-width:256px}}.notice{{background:#fff1d7;padding:18px}}a{{color:#12634c}}</style><main><h1>影石通用模型 · 源文件预检</h1><p>SKP {report['sourceVersion']} · 原文件 {report['sourceBytes']/1024**3:.2f} GiB · {len(rows)} 张嵌入组件缩略图 · {len(materials)} 个材质条目</p><p class="notice">真实网格尚未提取。缩略图可能是产品或子组件，不是完整软装目录；不能据此确定数量、尺寸或 SI 版本。model.dat 解压约 {geometry.file_size/1024**3:.2f} GiB，尚未解压，需兼容的 SketchUp / SDK 读取。</p><p><a href="source-report.json">源文件检查</a> · <a href="preview-index.json">缩略图索引</a> · <a href="materials.json">原始材质信息</a></p><h2>模型保存时的总览</h2><img src="preview_thumbnail.png" alt="源模型总览"><h2>嵌入组件预览</h2><div class="grid">{cards}</div></main></html>'''
(OUT/'index.html').write_text(page,encoding='utf-8')
print(json.dumps(report,ensure_ascii=True))
