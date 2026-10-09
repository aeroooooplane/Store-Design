"""Selections from the actually opened PDF-006/009/010 full overlays."""
from sync_sources import OUT,write
def rec(sid,page,items,dims,**kw):
 return dict(source_id=sid,page=page,canvas=[1888,1335 if sid=='PDF-006' else 1334],replace_items=items,dimensions=dims,boundary_action='reject',
  inspected_overlay=str(OUT.parent/f'_cache/全量续跑-02/geometry-r2/plan-overlays/{sid}/p{page:03}.png'),
  needs_human=['入口线段与正面朝向待确认。','固定设施及消防设施不完整。','同一PDF的相邻布置/定位页关系待核对，版本未确认。'],training_eligible=False,**kw)
def main():
 a=rec('PDF-006',7,[
 ['收银','cashier',[529,315,719,379],None],['储物柜','storage',[380,340,428,447],None],
 ['70寸广告机','screen',[863,448,1029,470],None],['配件柜','accessory_cabinet',[380,464,428,546],None],
 ['配件柜','accessory_cabinet',[380,547,428,631],None],['1.8米开箱桌','unboxing_table',[539,464,730,569],None],
 ['2.2米中岛桌','island_table',[518,654,751,760],None],['2.2米中岛桌','island_table',[518,845,751,951],None],
 ['成品电子水牌','screen',[976,708,1034,746],None],['98寸广告机','screen',[406,648,428,880],None],
 ['办公桌','other',[856,384,1016,450],None],
 *[[None,'seating',b,None] for b in [[550,417,593,459],[613,417,656,459],[677,417,720,459],[847,575,889,618],[916,575,958,618],[985,575,1027,618],[847,645,889,687],[916,645,958,687],[985,645,1027,687]]]],
 [dict(axis='x',value_mm=8140,endpoints_canvas=[[379,164],[1241,164]]),dict(axis='z',value_mm=4800,endpoints_canvas=[[1323,237],[1323,746]])],
 obstacle_seeds=[['结构柱','other',[380,885,419,982],None],['配电箱','other',[380,239,428,340],None]],fixed_seeds=[['灯箱','other',[1103,508,1222,659],None]])
 b=rec('PDF-010',1,[
 ['1.8米边桌配件柜','accessory_cabinet',[646,185,969,275],.9],['1.8米边桌配件柜','accessory_cabinet',[970,185,1291,275],.9],
 ['1.8米边桌收银台','cashier',[499,311,589,632],.9],['1.8米开箱桌','unboxing_table',[499,633,589,955],.9],
 ['1.8米go系列中岛桌','island_table',[793,454,1115,634],.9],['1.8米X系列中岛桌','island_table',[793,803,1115,983],.9],
 ['75寸屏幕(横向)','screen',[1292,288,1328,590],None],['75寸屏幕(横向)','screen',[1303,661,1325,966],None],
 ['电子水牌','screen',[1191,1024,1291,1087],None]],
 [dict(axis='x',value_mm=4800,endpoints_canvas=[[475,70],[1334,70]]),dict(axis='z',value_mm=5150,endpoints_canvas=[[345,167],[345,1087]])],
 boundary_trace=[[637,167],[1334,167],[1334,1087],[654,1087],[654,966],[475,966],[475,238],[637,238],[637,167]],
 obstacle_seeds=[['结构柱','other',[475,167,637,238],None],['结构柱','other',[475,966,654,1087],None]],fixed_seeds=[['灯箱','other',[475,480,498,785],None]])
 c=rec('PDF-009',1,[
 ['电子水牌','screen',[295,475,358,516],None],['1.8米中岛桌','island_table',[493,377,606,579],.9],
 ['1.2米配件柜','accessory_cabinet',[333,577,384,710],2.4],['1.2米配件柜','accessory_cabinet',[333,710,384,844],2.4],
 ['1.8米中岛桌','island_table',[681,721,794,922],.9],['1.8米中岛桌','island_table',[887,721,999,922],.9],
 ['1.8米洽谈桌','negotiation_table',[1091,721,1204,922],.9],['1.8米收银台','cashier',[923,450,1106,601],.9],
 *[['培训坐凳','seating',v,None] for v in [[417,713,467,761],[491,713,541,761],[563,713,612,761]]],
 *[[None,'seating',v,None] for v in [[1049,755,1091,799],[1049,855,1091,900],[1203,755,1246,799],[1203,855,1246,900]]],
 ['75寸屏幕(横向)','screen',[405,874,566,892],None],['75寸屏幕(横向)','screen',[1264,666,1374,883],None],
 ['55寸屏幕(竖向)','screen',[743,399,837,532],None],['98寸屏幕(横向)','screen',[916,310,1200,479],None]],
 [dict(axis='x',value_mm=9335,endpoints_canvas=[[333,1142],[1377,1142]]),dict(axis='z',value_mm=5400,endpoints_canvas=[[165,431],[165,1034]])],
 obstacle_seeds=[['结构柱','other',[470,919,575,1023],None],['结构柱','other',[749,393,901,544],None]])
 write(OUT/'视觉批次-003.json',dict(records=[a,b,c],method='vision',generator=dict(script='vision_batch003.py',version='1.0.0')))
if __name__=='__main__':main()
