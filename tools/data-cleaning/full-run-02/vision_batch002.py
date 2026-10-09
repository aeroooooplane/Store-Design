"""Visual selections from individually opened NEW-007 and PDF-004 overlays."""
from sync_sources import OUT,write
def main():
 file=OUT/'视觉批次-002.json'
 if file.exists():return
 write(file,dict(method='vision',generator=dict(script='vision_batch002.py',version='1.0.0'),records=[
 dict(source_id='NEW-007',page=1,canvas=[1888,1335],boundary_action='retain',boundary_kind='inner_clear_outline_candidate',
  inspected_overlay=str(OUT.parent/'_cache/全量续跑-02/geometry-r2/plan-overlays/NEW-007/p001.png'),
  dimensions=[dict(axis='x',value_mm=5560,endpoints_canvas=[[259,342],[1437,342]]),dict(axis='z',value_mm=1965,endpoints_canvas=[[122,450],[122,866]])],
  replace_items=[['75寸广告机','screen',[354,450,709,496],None],['配件柜','accessory_cabinet',[772,461,1280,496],None],
   ['边桌储物柜','storage',[296,496,677,603],None],['边桌配件柜','accessory_cabinet',[677,496,1058,603],None],
   ['收银+开箱','cashier',[1058,496,1313,603],None],['储物柜','storage',[1331,450,1437,747],None],
   ['成品电子水牌','screen',[689,782,807,855],None],[None,'seating',[1074,610,1164,670],None]],
  fixed_seeds=[['灯箱','other',[291,657,304,777],None]],obstacle_seeds=[],
  needs_human=['临入口的玻璃/门槛线与租赁红线不同，边界口径需确认。','标注面积11.1平方米需与提取净轮廓面积核对，不能用于反推比例。','组合收银开箱只计一件；虚线凳子与电子水牌的组合投影需要进一步确认。'],
  auto_status='partial',training_eligible=False),
 dict(source_id='PDF-004',page=11,canvas=[1888,1334],boundary_action='reject',boundary_kind=None,
  inspected_overlay=str(OUT.parent/'_cache/全量续跑-02/geometry-r2/plan-overlays/PDF-004/p011.png'),
  dimensions=[dict(axis='x',value_mm=8455,endpoints_canvas=[[439,1165],[1360,1165]]),dict(axis='z',value_mm=5310,endpoints_canvas=[[365,444],[365,1021]])],
  replace_items=[['1.8米收银台','cashier',[495,556,690,621],None],['配件柜（单门）','accessory_cabinet',[440,643,495,774],None],
   ['1.6米配件柜','accessory_cabinet',[443,795,495,971],None],['1.8米X4中岛桌','island_table',[649,779,758,976],None],
   ['1.8米GO3S中岛桌','island_table',[878,779,987,976],None],['1.8米开箱桌','unboxing_table',[847,449,1058,659],None],
   [None,'seating',[956,433,1011,489],None],[None,'seating',[1018,500,1074,554],None],
   [None,'seating',[832,557,889,612],None],[None,'seating',[894,619,950,675],None],[None,'seating',[622,630,666,671],None],
   ['培训坐凳','seating',[1104,628,1171,696],None],['培训坐凳','seating',[1034,698,1102,767],None],
   ['培训坐凳','seating',[1173,701,1238,767],None],['培训坐凳','seating',[1104,765,1171,834],None],
   ['75寸屏幕（竖向）','screen',[1146,953,1253,976],None],['电子水牌','screen',[494,988,554,1027],None],
   ['75寸屏幕（横向）','screen',[930,267,1149,507],None],['75寸屏幕（横向）','screen',[1140,484,1325,664],None]],
  obstacle_seeds=[['结构柱','other',[1128,784,1283,937],None]],
  needs_human=['斜向墙与圆角门面尚无可靠闭合店界，保留null。','斜向屏幕与背墙容易混合，须逐项核对；正面朝向不能强制归为直角。','消防门、休息区及墙面固定设施尚未完整。','高度未在本页可靠读出，保持null。'],
  auto_status='partial',training_eligible=False)]))
if __name__=='__main__':main()
