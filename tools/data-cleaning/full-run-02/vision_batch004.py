from sync_sources import OUT,write
def main():
 rows=[]
 def add(sid,page,canvas,items,dims,boundary,kind,**kw):
  rows.append(dict(source_id=sid,page=page,canvas=canvas,replace_items=items,dimensions=dims,boundary_action=boundary,boundary_kind=kind,
   inspected_overlay=str(OUT.parent/f'_cache/全量续跑-02/geometry-r2/plan-overlays/{sid}/p{page:03}.png'),
   needs_human=['原图边界口径与入口线段需确认。','道具朝向、高度与固定设施缺项保留null。','未审核的版本和商场铺位信息不得用于训练。'],training_eligible=False,**kw))
 add('NEW-008',2,[1888,1334],[
  ['1.8米收银+开箱储物柜','cashier',[491,428,697,535],None],['1.8米边桌+储物柜','side_cabinet',[681,477,891,583],None],
  ['1.8米中岛桌','island_table',[409,555,630,719],None],['1.8米中岛桌','island_table',[701,643,915,786],None],
  ['1.6米配件柜','accessory_cabinet',[1009,556,1061,732],None],['98寸屏幕(竖向)+钢化玻璃','screen',[1333,575,1355,713],None],
  ['电子水牌','screen',[1286,757,1346,805],None]],
  [dict(axis='x',value_mm=2840,endpoints_canvas=[[697,828],[1009,828]]),dict(axis='z',value_mm=2500,endpoints_canvas=[[1406,537],[1406,812]])],
  'reject',None,obstacle_seeds=[['包柱','other',[1084,512,1288,717],None]],fixed_seeds=[['灯箱','other',[1072,740,1292,752],None]])
 add('NEW-010',1,[1888,1334],[
  ['1.8M中岛桌','island_table',[655,140,894,273],None],['1.8M中岛桌','island_table',[655,418,894,551],None],
  ['1.8M开箱桌','unboxing_table',[708,696,842,935],None],['成品电子水牌','screen',[983,156,1029,230],None],
  ['储物柜','storage',[963,924,1029,1163],None],['配件柜','accessory_cabinet',[549,1093,735,1154],2.0],
  ['全息风扇','other',[834,1098,927,1163],None],
  *[[None,'seating',b,None] for b in [[661,708,702,769],[661,787,702,846],[847,708,887,769],[847,787,887,846],[745,941,804,982]]]],
  [dict(axis='x',value_mm=4000,endpoints_canvas=[[509,76],[1039,76]]),dict(axis='z',value_mm=8000,endpoints_canvas=[[1099,129],[1099,1190]])],
  'retain','inner_platform_outline',obstacle_seeds=[['120*120立柱','other',[520,651,536,668],None],['120*120立柱','other',[1013,651,1029,668],None]],fixed_seeds=[])
 add('NEW-011',1,[1888,1335],[
  ['配件柜','accessory_cabinet',[712,446,813,503],None],['配件柜','accessory_cabinet',[813,446,913,503],None],
  ['成品电子水牌','screen',[238,463,284,535],None],['98寸广告机','screen',[947,477,1225,503],None],
  ['1.8米中岛桌','island_table',[396,655,625,783],None],['1.8米中岛桌','island_table',[815,655,1045,783],None],
  [None,'other',[1235,600,1312,829],None],['底部储物柜','storage',[1413,608,1477,821],None]],
  [dict(axis='x',value_mm=9830,endpoints_canvas=[[226,253],[1477,253]]),dict(axis='z',value_mm=3910,endpoints_canvas=[[1547,439],[1547,935]])],
  'retain','outer_platform_edging_outline',obstacle_seeds=[['配电箱','other',[1257,439,1348,503],None]],fixed_seeds=[])
 write(OUT/'视觉批次-004.json',dict(records=rows,method='vision',generator=dict(script='vision_batch004.py',version='1.0.0')))
if __name__=='__main__':main()
