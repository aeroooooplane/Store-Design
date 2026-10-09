"""Actual visual readings on NEW-006 p2/p16. ROIs select original vectors, not metric guesses."""
from sync_sources import OUT,write
from pathlib import Path
def main():
 p=OUT/'视觉批次-001.json'
 if p.exists():return
 write(p,dict(method='vision',generator=dict(script='vision_batch001.py',version='1.0.0'),records=[dict(
  source_id='NEW-006',page=16,canvas=[1888,1334],boundary_action='retain',boundary_kind='lease_line',
  inspected_overlay=str(OUT.parent/'_cache/全量续跑-02/geometry-r2/plan-overlays/NEW-006/p016.png'),
  dimensions=[dict(axis='x',value_mm=7000,endpoints_canvas=[[483,360],[1269,360]]),dict(axis='z',value_mm=4500,endpoints_canvas=[[1322,413],[1322,919]])],
  replace_items=[
   ['1.8米配件边柜（带托盘）','accessory_cabinet',[526,465,582,667],.9],
   ['1.8米配件边柜（带托盘）','accessory_cabinet',[526,667,582,869],.9],
   ['1.8米中岛桌','island_table',[750,423,840,625],.9],
   ['1.8米中岛桌','island_table',[750,708,840,910],.9],
   ['1.8米中岛桌','island_table',[1009,708,1098,910],.9],
   ['1.8米收银台','cashier',[1009,438,1076,641],.9],
   ['75寸广告机（横向）','screen',[1238,438,1261,630],None],
   ['电子水牌','screen',[1221,849,1261,910],None]],
  fixed_seeds=[['储物柜（硬装部分）','storage',[1182,531,1234,630],None]],
  obstacle_seeds=[['配电箱','other',[1204,448,1228,484],None]],
  count_agreement=None,auto_status='partial',training_eligible=False,
  needs_human=['同一家具的原生与OCR标签重复，已按视觉物体重组。','入口开敞边的确切范围、矮墙/灯箱/LOGO全部范围尚待标注。','固定储物柜不能计入可移动软装。'],
  version_relation=dict(other_page=2,same_layout=True,method='vision',basis='同样的三张中岛、两张左侧边柜、收银及右上储物/电箱；租赁尺寸均7000×4500。',
   other_inspected_overlay=str(OUT.parent/'_cache/全量续跑-02/geometry-r2/plan-overlays/NEW-006/p002.png'),version_confirmed=False))]))
if __name__=='__main__':main()
