"""Corrections from actually inspected r10 overlays; never mutate r10."""
import json,sys,copy
from pathlib import Path
import pymupdf as fitz
from PIL import Image,ImageDraw
from network_geometry import snap_trace
from pilot_seeds import BOUNDARY_TRACE
from pilot20 import NUMS,read,CACHE
from sync_sources import OUT,write,sha,meta

NOTES={1:'租赁线、9件主要道具对齐；虚线座椅仍缺少闭合轮廓。',2:'桌柜椅定位改善；异形店界尚未恢复，横向尺寸线未可靠配对。',3:'屏幕与四椅已定位；边界顶点未能可靠选取，保持未知。',5:'桌柜及三凳对齐；r10边界误沿外部尺寸延伸区闭合，必须拒绝。',8:'主要道具及8个凳子对齐；曲线租赁边界尚未恢复。',13:'展示外框与主要道具对齐；收银柜仍无可靠轮廓。',19:'外边线和桌柜对齐，新增斜向屏幕；消防物仍待完整标注。',29:'租赁线、桌柜、4凳及2货架对齐；开箱旁虚线座椅未完整。',32:'外边线、桌柜及6椅对齐；共用位置标签仍需归并，固定设施未完成。',35:'影石展示区轮廓与6件桌柜屏对齐；同物体重复的未定位旧标签待归并。',43:'圆角地台与主要桌柜对齐；竖向广告机仍未定位，橱窗内容和休息室需完整标注。',49:'r10选中了U形墙带，不能作为房间边界；r11改按明确内净尺寸边线定位。7件道具框对齐，仍缺2柜。',51:'地台及7件主要家具全部对齐；LED和固定设施未全部完成。',71:'租赁虚线范围及5件主要桌柜对齐；2张高椅未闭合。',88:'租赁线及主要桌柜对齐；开箱旁虚线座椅与障碍物未完整。',90:'地台、配件柜、桌体及2椅对齐；固定设施未完整。',239:'平台及8件道具对齐；柱子组合不再误当家具，柱净尺寸仍未知。',293:'平台曲线及6件家具对齐，3段弧形柜已定位；显示屏位置仍未知，中英文柜长冲突。',296:'平台及6件主要道具对齐；柜体与背墙分离，固定设施待审。',353:'r10轮廓包含左侧图纸截断符，拒绝；r11按尺寸与虚线明确的专区外包区域恢复；9件物体位置对齐。'}
def main():
 sys.stdout.reconfigure(encoding='utf-8');dest=OUT/'试点-r11';dest.mkdir(exist_ok=True)
 for n in NUMS:
  sid=f'PDF-{n:03}';file=dest/f'{sid}.json'
  if file.exists():continue
  d=read(OUT/f'试点-r10/{sid}/draft.json')
  original=copy.deepcopy(d['boundary'])
  if n==5:d['boundary']=None
  if n in (49,353):
   with fitz.open(d['source_pdf']) as doc:
    q=doc[d['page']-1];q.remove_rotation();w,h=q.rect.width,q.rect.height
    d['boundary'],d['boundary_error']=snap_trace(BOUNDARY_TRACE[n],q.get_drawings(),[1888,1334],w,h)
    if d['boundary']:d['boundary']['kind']='inner_clear_envelope' if n==49 else 'display_zone_envelope'
  d.update(revision='r11',visual_check=dict(method='vision',r10_overlay=d['overlay'],r10_overlay_sha256=sha(Path(d['overlay'])),
        notes=NOTES[n],boundary_alignment=n not in (2,3,5,8,49,353),major_props_alignment=True,
        corrected_overlay_pending=n in (5,49,353)),training_eligible=False,training_ready_auto=False)
  if n in (5,49,353):
   d['rejected_r10_boundary']=original
   im=Image.open(d['evidence']).convert('RGB');dr=ImageDraw.Draw(im);w,h=d['source']['frame_bbox'][2:];sx,sy=im.width/w,im.height/h
   if d['boundary']:dr.line([(x*sx,y*sy) for x,y in d['boundary']['points']],fill='#008cdd',width=5)
   for o in d['items']:
    if o['pdf_polygon']:dr.line([(x*sx,y*sy) for x,y in o['pdf_polygon']],fill='#10862b',width=4)
   image=CACHE/f'{sid}-pilot-r11.png'
   with image.open('xb') as f:im.save(f,format='PNG')
   d['overlay']=str(image)
  write(file,d);print(sid,'boundary',bool(d['boundary']),d.get('boundary_error'),flush=True)
 write(OUT/'试点-r10-视觉核对.json',dict(method='vision',inspected=NUMS,notes=NOTES,
    rejected_boundaries=['PDF-005','PDF-049','PDF-353'],missing_boundaries=['PDF-002','PDF-003','PDF-008'],
    gate_pass_count=14,gate_denominator=20,gate_ratio=.7,gate_passed=False,
    limitation='家具定位与边界对齐门槛，不是全要素完整性或训练准入；r11纠正页需再看图后重新计算。'))
if __name__=='__main__':main()
