"""Persist the assistant's actual visual audit; creates files exclusively."""
import html
import json
from pathlib import Path
from compare import ROOT, RUN, META, read, write, digest

OUT=RUN/'方法对比-01'
AUDITS={
 'PDF-043':dict(aligned_ids=[1,2,3,4,5,6],unresolved_ids=[7,8],boundary_alignment=True,
     observations=['6件家具轮廓与原图明显一致，圆角平台外边线也对齐。',
       '两个广告机尚无可靠闭合候选；本页没有从文字抽取获得家具定位，视觉选择提供了增益。',
       '平台外边线类型仍待确认，不能据此宣称租赁边界已认证。']),
 'PDF-051':dict(aligned_ids=[2,3,4,5,6,7],unresolved_ids=[1],boundary_alignment=True,
     observations=['两张桌、右侧配件柜、收银、开箱及水牌轮廓均对齐。',
       '左侧配件柜在现有候选库中缺失，视觉选择也没有解决。',
       '与A相比无数量提升，说明应改进轮廓构建而非继续放宽文字匹配。']),
 'PDF-239':dict(aligned_ids=[2,3,4,5,6,7,8],unresolved_ids=[1],boundary_alignment=True,
     observations=['7件物体对齐，广告机与配件柜已分离，未再将柱体组合框当作家具。',
       '上侧H1300mm储物柜仍缺闭合候选。',
       '柱内净尺寸不详，平台外线对齐不等于柱和障碍物已完成。']),
 'PDF-293':dict(aligned_ids=[1,2,3],unresolved_ids=[4,5,6,7],boundary_alignment=True,
     observations=['两张中岛桌及收银边柜对齐，弧形平台候选外边线对齐。',
       '3个弧形定制柜未通过选择阈值；未强行接收近似矩形。',
       '显示屏尚未可靠定位；去掉A中的重叠误配，但正确物体数量没有增加。',
       '收银边柜中英文名义长度冲突仍存在。']),
 'PDF-353':dict(aligned_ids=[1,3,4,5,6,7,8,9],unresolved_ids=[2],boundary_alignment=None,
     observations=['配件柜、两张中岛桌、圆桌、四椅共8件与图上位置轮廓一致。',
       '四椅提取的是外侧投影轮廓，仍不代表座向/模型尺寸已经确认。',
       '80寸显示屏缺少候选，专区边界语义不确定，均保留未解决。'])
}

def exclusive_text(p,s):
    with p.open('x',encoding='utf-8') as f:f.write(s)

def main():
    rows=[]
    for sid,a in AUDITS.items():
        d=read(OUT/sid/'comparison.json')
        actual=[o['id'] for o in d['items'] if o['polygon']]
        assert actual==a['aligned_ids'],(sid,actual)
        for method,path in d['overlays'].items():
            assert Path(path).exists()
        audit=dict(**a,method='vision',source_id=sid,auto_status='partial',training_eligible=False,
          version_confirmed=False,training_ready_auto=False,reviewer=None,
          inspected_images=[dict(method=m,path=p,sha256=digest(Path(p))) for m,p in d['overlays'].items()],
          scope='本轮助手打开A/B完整叠加图逐页目视检查；不是人工审批或独立盲测。',
          needs_human=['完整道具清点、边界语义、入口障碍物、尺寸双轴验证、版本及资产对应尚未全部完成。'])
        write(OUT/sid/'visual-audit.json',audit)
        rows.append(dict(source_id=sid,objects=d['reference_objects'],A=d['baseline_spatial_matches'],B=len(actual)))
    total=sum(r['objects'] for r in rows);a=sum(r['A'] for r in rows);b=sum(r['B'] for r in rows)
    write(OUT/'conclusion.json',dict(status='experiment_completed',method='vision_audit',training_eligible=False,
      cases=rows,object_scope_total=total,A_spatial_recovery=a,B_spatial_recovery=b,
      recommended_method='vision_semantics_then_vector_geometry_then_independent_scale_check',
      complete=0,partial=5,failed=0,candidate_training_versions=0,
      caution='空间找回数不是独立准确率，不是门店完成率；五张问题页不能外推418家。',
      next_priority=['分割/重组柜体矢量轮廓','尺寸文字视觉读取与两方向尺寸线配对','扩展回20家完整试点并重新验收']))
    table='\n'.join(f"| {r['source_id']} | {r['objects']} | {r['A']} | {r['B']} |" for r in rows)
    report=f'''# 方法对比：五张问题平面页

建议采用“视觉确认物体与语义 → 矢量提取精确位置轮廓 → 尺寸双轴核验 → 叠图复查”。本轮完成两种定位方法对比，尚未完成全部418家清洗。

## 实际结果

| 来源 | 选定物体数 | A：文字邻近矢量 | B：视觉选择矢量 |
|---|---:|---:|---:|
{table}
| 合计 | {total} | {a} | {b} |

数字表示预先选定范围内、一对一匹配到图上位置的物体数。A、B共10张叠加图均已由助手打开目视核对。B的30个候选在本次目视检查中与对应图形对齐；还余9件未定位。A中有22条几何记录，仅对应17个选定物体的位置，存在误配和重复。B新增13个正确位置，主要来自转线条文字页、柱旁物体和无标签桌椅。

这不是独立测试准确率：B的选择窗口由本轮看图给出，也用于空间统计，属于辅助标注可行性实验。五页有目的挑选，并非随机样本；不得用30/39推算全量自动成功率或原任务80%门店验收率。小范围找回不等于门店完成。

4页的平台/外边线候选目视对齐，PDF-353边界保持未知；四者的租赁线/净尺寸等语义仍未确证。全部5页为partial，complete=0，failed=0，候选训练版本=0，training_eligible=false。

## 方法选择依据

- 文字与矢量自动规则适合首轮候选生成。PDF-051表现稳定，但左配件柜未构建成候选，视觉选择也无法弥补。
- 视觉能补充类别、标签与分组。PDF-043找回6件主要家具；PDF-353补出无标签圆桌和4把椅子；PDF-239不再将柱子组合框充当3件道具。
- 精确坐标继续取自PDF矢量。选择窗口只指示位置，未按图片比例猜米制尺寸；没有生成或补画原图。
- 弧形柜、被对角线切分的柜体、极薄屏幕需要局部轮廓构建。PDF-293仍只有3/7定位成功，现阶段不能宣称混合方法已经全覆盖。

## 尺度和完整性

本轮仅比较定位方法，没有重新认证比例，也没有进行米制换算。图上有可读数字，并不等于找到了正确的尺寸线：下一轮需保存数字截图、两方向尺寸线端点、两个比例和相对误差。误差不超过2%后才输出米制数据。已有PDF-051的双轴证据仍留在原标注目录，本轮未改动。

尚未完成的工作包括：39件范围之外的完整物体清点，入口/柱/固定设施，版本关系，资产映射，全部尺寸、朝向和高度核验。屏幕是否属于固定设施也应另审，不能因列入本实验就认定可移动。

## 下一轮最值得做的改进

1. 在视觉确定的小区域内，按端点连接、共线性、曲率和线型重组柜体轮廓；保留原始路径编号。优先攻克PDF-051左柜、PDF-239储物柜、PDF-293弧形柜。
2. 独立完成两方向尺寸核验，避免把位置对齐与尺度可信混在一个分数里。
3. 扩回原20家试点，完整清点边界和物体；达到原定门店验收门槛后再全量运行。

## 文件与复现

- [查看A/B图像对比](对比查看.html)：红色为A、绿色为B、青色为边界候选，可切换和并排看。
- 每页 comparison.json 保存坐标、候选编号、输入散列和未识别项；visual-audit.json 是本轮视觉检查记录；conclusion.json 汇总最终结论。
- vision-selections.json 保存看图选择窗口；summary.json保留初始待审统计，最终状态以conclusion.json为准。
- 图像在 ../_cache/方法对比-01/，脚本在 tools/data-cleaning/method-comparison-01/。
- 运行命令见脚本目录README。compare.py只读取冻结缓存及原图；finalize.py保存本次已完成的视觉观察，重新渲染或改变候选后不得直接复用这些观察作为新审核。
- 原PDF、原试点文件均未改写。所有新增JSON均有schemaVersion、generatedAt和generator。
'''
    exclusive_text(OUT/'README.md',report)
    cards=[]
    for r in rows:
        sid=r['source_id'];notes='；'.join(AUDITS[sid]['observations'])
        cards.append(f'<section><h2>{sid} — {r["A"]} → {r["B"]} / {r["objects"]} 件</h2><p>{html.escape(notes)}</p><div class="pair"><figure class="a"><figcaption>A 文字邻近矢量</figcaption><a href="../_cache/方法对比-01/{sid}-A.png"><img src="../_cache/方法对比-01/{sid}-A.png" loading="lazy"></a></figure><figure class="b"><figcaption>B 视觉定位后选择矢量</figcaption><a href="../_cache/方法对比-01/{sid}-B.png"><img src="../_cache/方法对比-01/{sid}-B.png" loading="lazy"></a></figure></div></section>')
    page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>五页平面提取方法对比</title><style>body{font:16px/1.6 system-ui;margin:24px;background:#f5f6f8;color:#17212e}header{position:sticky;top:0;background:#f5f6f8;padding:8px;z-index:2}h1{font-size:25px;margin:0}h2{font-size:20px}section{background:white;padding:16px;margin:20px 0;border-radius:12px}.pair{display:flex;gap:12px}figure{margin:0;flex:1;min-width:0}img{width:100%}figcaption{font-weight:700}.a figcaption{color:#b91c1c}.b figcaption{color:#138a36}button{padding:8px 16px;cursor:pointer;margin-right:8px}body.onlyA .b,body.onlyB .a{display:none}@media(max-width:800px){.pair{flex-direction:column}}</style><header><h1>平面数据提取 · 五页方法实验</h1><p>39件选定物体：A找回17件，B找回30件。辅助标注实验，不是独立准确率；5页均为草稿，不可直接训练。</p><button onclick="document.body.className=''">并排</button><button onclick="document.body.className='onlyA'">仅A</button><button onclick="document.body.className='onlyB'">仅B</button><small>点击图像打开原尺寸，浏览器可放大。</small></header>'''+''.join(cards)+'</html>'
    exclusive_text(OUT/'对比查看.html',page)
    write(OUT/'artifact-manifest.json',dict(files=[dict(path=str(p.relative_to(ROOT)),sha256=digest(p))
        for folder in [OUT,RUN/'_cache/方法对比-01',Path(__file__).parent]
        for p in sorted(folder.rglob('*')) if p.is_file() and '__pycache__' not in p.parts],training_eligible=False))
    print(json.dumps(dict(cases=rows,total=total,A=a,B=b,complete=0,partial=5,failed=0)))

if __name__=='__main__':main()
