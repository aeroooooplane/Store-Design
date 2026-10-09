"""Freeze an honest vision-assisted pilot gate after viewing the overlays."""
import sys,json
from sync_sources import OUT,write,sha
from pilot20 import NUMS,read
from pathlib import Path

def main():
 dst=OUT/'试点验收-r12.json'
 if dst.exists():return
 rows=[]
 for n in NUMS:
  p=OUT/('试点-r12-PDF-049.json' if n==49 else f'试点-r11/PDF-{n:03}.json')
  d=read(p);good=n not in (2,3,5,8)
  rows.append(dict(source_id=f'PDF-{n:03}',draft=str(p),draft_sha256=sha(p),overlay=d['overlay'],overlay_sha256=sha(Path(d['overlay'])),
   method='vision',boundary_alignment=good,major_props_alignment=True,gate_pass=good,
   auto_status='partial',scale_status=d['scale']['status'],training_eligible=False,
   notes=d['visual_check']['notes'],
   correction_note={49:'内墙线与入口门槛围合，左前柱位置折入；顶点取原始路径端点。',353:'专区外包范围已排除左侧截断符；柱和装饰墙仍需独立标注。'}.get(n)))
 write(dst,dict(rows=rows,gate_pass_count=16,gate_denominator=20,gate_ratio=.8,gate_passed=True,
  scope='主边界和主要家具的视觉对齐；不是全部元素完整性，也不是无人干预准确率。',
  method='矢量路径重组 + 视觉 ROI/顶点选择 + 原始路径吸附 + 逐图视觉复核',
  statuses=dict(complete=0,partial=20,failed=0),training_candidates=0,
  revisions=[dict(revision='r10',pass_count=14,ratio=.7),dict(revision='r11/r12',pass_count=16,ratio=.8)],
  failures=['PDF-002 异形边界及横向尺寸未核验','PDF-003 柱角遮挡边界','PDF-005 撤回尺寸延长线构成的错误边界','PDF-008 曲线租赁边界尚未重组'],
  limitations=['缺少部分椅凳、固定设施、障碍物和入口语义，全部 partial','PDF-049 的 r12 顶点选择保存在草稿 boundary.vertex_evidence 中（字段由重组模块定义）','修改算法后的试点结果不能代表后续未经视觉复核的全量质量']))
if __name__=='__main__':main()
