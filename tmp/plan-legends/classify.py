from pathlib import Path
import json,fitz
r=Path(r'E:\效果图生成器\Store-Design');b=r/'素材库/04_assets/按SI标准命名-20261001';f=b/'平面图例/index.json';rows=json.loads(f.read_text('utf-8'))
for a in rows:
 if a['id'] in ['screen98','screen55v']:
  d=fitz.open(r/a['source_pdf']);p=d[a['page']-1]
  xy,size=([561,238,736,279],[1263,893]) if a['id']=='screen98' else ([246,378,329,492],[1787,1263])
  rect=fitz.Rect(xy[0]/size[0]*p.rect.width,xy[1]/size[1]*p.rect.height,xy[2]/size[0]*p.rect.width,xy[3]/size[1]*p.rect.height);p.get_pixmap(matrix=fitz.Matrix(7,7),clip=rect).save(b/a['file']);a['crop_pdf_points']=list(rect)
f.write_text(json.dumps(rows,ensure_ascii=False,indent=2),'utf-8')
mfile=b/'manifest.json';m=json.loads(mfile.read_text('utf-8'))
legend_map={2:'si1-cab1600',3:'si1-island',4:'si1-island',6:'si1-stool',8:'si1-storage-unbox',9:'si1-storage',21:'si1-unbox',23:'edge-cash',25:'screen98',27:'water-sign',14:'water-sign',28:'screen75v',29:'si1-cab1200',30:'screen55v',33:'screen86',34:'screen65',38:'si2-cab2400',45:'screen86',48:'si2-cab3600',49:'si2-stool',50:'si2-unbox',51:'flight',53:'si2-island',54:'si2-cash-left',58:'edge-cash',63:'edge-accessory',64:'edge-cash',70:'si2-island',72:'edge-accessory',74:'si2-cab3600',76:'si2-avbu2400',77:'si2-cab2400',78:'si2-avbu2400',79:'leica1200',88:'si2-island',89:'si2-unbox'}
for n in [1,13,22,41,42,61,90]:legend_map[n]='screen75'
legends={a['id']:a for a in rows}
for a in m['assets']:
 n=a['n'];name=a['standard_name'];si=a['si_family']
 soft=(si in ['SI1.0','SI2.0'] and n not in [84,85]) or n in [36,59]
 info=name in ['广告机','电子水牌','LED门头屏','曲面LED屏']
 a['material_category']='软装物料' if soft else '信息化物料' if info else '展陈物料'
 a['material_si']=si if soft and si in ['SI1.0','SI2.0'] else 'SI待确认' if soft else None
 if soft:
  order=next((i for i,k in enumerate(['普通中岛桌','亮脚中岛桌','普通开箱桌','亮脚开箱桌','收银桌','收银台','配件柜','边桌','边柜','开箱储物柜','凳','徕卡墙','试飞台','展示台','沙发','陈列柜']) if k in name),99)
 else:order=next((i for i,k in enumerate(['广告机','电子水牌','LED','橱窗','产品','LOGO','侧招','灯箱','KV','射灯','挡板','消防']) if k in name),99)
 a['material_sort']=order
 key=legend_map.get(n);a['plan_legend']=dict(legends[key]) if key else None
 if n==79:a['plan_legend']['status']='局部对应（仅1.2米墙面位置）'
 elif key:a['plan_legend']['status']='同类平面图例'
 if n==78:a['plan_legend']['note']+='；本模型为AVBU+影石混合陈列，仅外轮廓参考'
 a['plan_legend_missing_reason']=None if key else ('本轮未找到可确认的同规格、同用途平面图例；不使用相近尺寸冒充' if soft or info else '本轮未找到可确认的独立平面符号')
m['material_categories']=['软装物料','信息化物料','展陈物料'];m['classification_updated']='2026-10-02';m['plan_legend_note']='原PDF裁片，不是模型生成俯视图；普通与亮脚在原图不能区分时共用图例并标注'
mfile.write_text(json.dumps(m,ensure_ascii=False,indent=2),'utf-8')
from collections import Counter
print(Counter(a['material_category'] for a in m['assets']));print('mapped',sum(bool(a['plan_legend']) for a in m['assets']))
