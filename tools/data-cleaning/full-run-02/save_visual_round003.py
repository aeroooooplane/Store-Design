"""Persist actual page/contact-sheet observations made in this session."""
from sync_sources import OUT,write,sha
from pathlib import Path

CACHE=OUT.parent/'_cache/全量续跑-02'
def main():
 observations=[]
 views={
 'NEW-006':{2:('plan_layout',None),3:('elevation','带尺寸的正面效果立面'),4:('render','A面正面'),5:('render','B面侧后方，Logo与屏幕墙'),6:('render','C面，展示与收银侧'),7:('render','D面，水牌与屏幕侧'),8:('render','俯视轴测布局'),9:('cover_index',None),18:('plan_other',None),29:('cover_index',None)},
 'PDF-001':{2:('plan_layout',None),3:('elevation','带尺寸的门头正面效果立面'),4:('render','门店正面'),5:('render','门头及入口斜侧面'),6:('render','侧入口看向室内'),7:('render','室内俯视轴测布局'),8:('cover_index',None),17:('plan_other',None),42:('cover_index',None)}}
 for sid,pages in views.items():
  for n,(kind,view) in pages.items():
   p=CACHE/'page-review'/sid/f'p{n:03}.png'
   observations.append(dict(source_id=sid,page=n,type=kind,method='vision',image=str(p),image_sha256=sha(p),frames_count=1 if kind.startswith('plan_') else None,view_description=view,same_layout=None,
    note='实际打开接触表阅读；尺寸标注的效果立面按其立面用途保留elevation。' if n==3 else '实际打开接触表阅读。'))
 write(OUT/'视觉页面复核-003.json',dict(pages=observations,date_evidence=[
  dict(source_id='NEW-006',pages=[9,29],text='2026.08',method='vision',date_precision='month'),
  dict(source_id='PDF-001',pages=[8,42],text='2026.04',method='vision',date_precision='month')],
  conflicts=[dict(source_id='PDF-001',field='stated_area',evidence=[dict(page=2,value=73),dict(page=8,value=78.9),dict(page=42,value=78.9)],unit='m2',resolution=None)],
  training_eligible=False,generator=dict(script='save_visual_round003.py',version='1.0.0')))
 ids=[1,2,3,5,8,13,19,29,32,35,43,49,51,71,88,90,239,293,296,353]
 write(OUT/'试点标准标注-r13-视觉核对.json',dict(method='vision',contact_sheets=[dict(path=str(p),sha256=sha(p)) for p in [CACHE/f'pilot-r13-contact-{i}.png' for i in range(1,6)]],
  stores=[dict(store_id=f'store-{i:04}',overlay_opened=True,geometry_alignment='partial' if i in (2,3,5,8) else 'main_boundary_and_located_props_aligned',complete=False) for i in ids],
  note='标准封装后的20张overlay已再次实际打开；位置与先前逐张复核一致。缺边界、未定位道具、入口及设施尚未完成，不改变partial状态。PDF-239图签更正见source-correction.json。',training_eligible=False))
if __name__=='__main__':main()
