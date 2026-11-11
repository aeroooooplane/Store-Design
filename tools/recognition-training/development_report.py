"""48家模型复评报告；原审核标签只读，补充意见另存。"""

import argparse
import html
from pathlib import Path
from dataset import load, save, sha, need


def build(root):
    root = Path(root)
    need(not (root / "复评审核.html").exists(), "报告已存在，保留旧版")
    result = load(root / "results.json")
    freeze = load(root / "frozen-candidate.json")
    counts = freeze.get("trainingCounts", {"train": 17, "internal_val": 3})
    question_count = (
        len(load(root / "annotation-review-evidence.json")["questions"])
        if (root / "annotation-review-evidence.json").exists()
        else 0
    )
    question_note = (
        f'新增{question_count}处范围归属待确认，相关样本未训练。<a href="补充标注审核.html">打开补充标注审核</a>'
        if question_count
        else "本轮暂无需你确认的新问题，旧审核保留。"
    )
    if not question_count and (root / "annotation-review-evidence.json").exists():
        question_note += ' <a href="补充标注审核.html">查看已确认范围及新增标注</a>'
    if (root / "内部验证.html").exists():
        question_note += (
            f' <a href="内部验证.html">查看{counts["internal_val"]}家内部验证</a>'
        )
    s = result["summary"]
    promotion_note = ""
    if (root / "promotion-decision.json").exists():
        decision = load(root / "promotion-decision.json")
        promotion_note = (
            '<section class="box"><strong>'
            + html.escape(decision["message"])
            + "</strong></section>"
        )
    rows = result["rows"]
    focus_ids = set(freeze.get("priorRegressionStoreIds", []))
    focus_rows = [r for r in rows if r["store_id"] in focus_ids]
    focus_table = ""
    if focus_rows:
        entries = "".join(
            f'<tr><td><a href="#{r["store_id"]}">{r["store_id"]}</a></td>'
            f'<td>{r["metrics"]["baseline-raw"]["iou"]:.1%}</td>'
            f'<td>{r["metrics"]["candidate-raw"]["iou"]:.1%}</td></tr>'
            for r in focus_rows
        )
        focus_table = (
            '<section class="box"><details open><summary>上一轮退化样本跟踪</summary><table><tr><th>门店</th><th>上一轮</th><th>本轮</th></tr>'
            + entries
            + "</table></details></section>"
        )
    notes = (
        load(root / "visual-review.json")
        if (root / "visual-review.json").exists()
        else {}
    )
    revision_note = (
        html.escape(
            load(root / "frozen-candidate.json").get(
                "preprocessingReason", "开发集反馈后修正预处理。"
            )
        )
        + " 旧/新模型使用同一预处理比较，全部早期结果保留。"
        if s.get("developmentInformedPreprocessing")
        else "模型和评分方案在首次开发复评前冻结。"
    )
    metrics = "".join(
        f'<tr><td>{title}</td><td>{s["metrics"][key]["meanIoU"]:.1%}</td><td>{s["metrics"][key]["iouAtLeast90"]}/48</td></tr>'
        for key, title in [
            ("baseline-raw", "上一轮原始预测"),
            ("baseline-clean", "上一轮＋清理"),
            ("candidate-raw", "本轮原始预测"),
            ("candidate-clean", "本轮＋清理"),
        ]
    )
    cards = []
    for r in sorted(rows, key=lambda r: r["metrics"]["candidate-raw"]["iou"]):
        id = r["store_id"]
        old = r["metrics"]["baseline-raw"]["iou"]
        new = r["metrics"]["candidate-raw"]["iou"]
        msg = notes.get(
            id,
            "算法待改进："
            + (
                "多识别较多"
                if r["metrics"]["candidate-raw"].get("falsePositivePixels", 0)
                > r["metrics"]["candidate-raw"].get("falseNegativePixels", 0)
                else "漏识别较多"
            ),
        )
        buttons = "".join(
            f'<button data-view="{key}">{title}</button>'
            for key, title in [
                ("original", "原图"),
                ("reference", "参考"),
                ("baseline-raw", "旧预测"),
                ("candidate-raw", "新预测"),
                ("candidate-clean", "新预测＋清理"),
            ]
        )
        cards.append(
            f'<article id="{id}" data-store="{id}"><h2>{id}</h2><p>旧 {old:.1%} → 新预测 <b>{new:.1%}</b></p><div class="switch">{buttons}</div><a target="_blank" href="images/{id}-candidate-raw.jpg"><img loading="lazy" src="images/{id}-candidate-raw.jpg" alt="{id}预测与参考叠图"></a><p class="note">{html.escape(msg)}</p></article>'
        )
    before = s["metrics"]["baseline-raw"]["meanIoU"]
    after = s["metrics"]["candidate-raw"]["meanIoU"]
    improved = sum(
        r["metrics"]["candidate-raw"]["iou"] > r["metrics"]["baseline-raw"]["iou"]
        for r in rows
    )
    regressed = sum(
        r["metrics"]["candidate-raw"]["iou"] < r["metrics"]["baseline-raw"]["iou"]
        for r in rows
    )
    key = "outline-development-" + sha(root / "frozen-candidate.json")[:16]
    page = f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>48家轮廓复评</title>
<style>*{{box-sizing:border-box}}body{{margin:0;background:#f5f5f2;color:#161616;font:16px/1.65 system-ui,"Microsoft YaHei",sans-serif}}main{{max-width:1300px;margin:auto;padding:24px}}header{{border-top:8px solid #ffd200;padding-top:20px}}h1{{margin:0;font-size:30px}}h2{{font-size:20px;margin:0}}.box,article{{background:#fff;padding:20px;border:1px solid #ddd;border-radius:8px;margin:18px 0}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr));gap:18px}}article{{margin:0}}article img{{width:100%;height:320px;object-fit:contain;margin-top:12px}}.switch{{display:flex;flex-wrap:wrap;gap:6px}}button{{font:inherit;font-size:14px;background:#ffd200;color:#111;border:1px solid #111;border-radius:5px;padding:6px 10px;cursor:pointer}}a{{color:#111}}table{{width:100%;border-collapse:collapse}}td,th{{text-align:left;padding:8px;border-bottom:1px solid #ddd}}textarea{{width:100%;min-height:90px;font:inherit;padding:10px}}.note,small{{color:#555}}.pill{{display:inline-block;background:#ffd200;padding:6px 12px;border-radius:5px}}@media(max-width:600px){{main{{padding:14px}}.box,article{{padding:14px}}}}</style>
<main><header><h1>48家轮廓复评</h1><p>模型先冻结，再评分 · 45家验收未使用 · 旧审核结果保留</p><span class="pill">仍是试验模型，尚未接入项目</span></header>
<section class="box"><p>平均轮廓IoU：<b>{before:.1%} → {after:.1%}</b>（原始预测，同预处理）。改善{improved}家，退化{regressed}家。完整保留48家分母；可评分参考{s['scorable']}家。</p><table><tr><th>方案</th><th>平均IoU</th><th>IoU≥90%</th></tr>{metrics}</table><details><summary>评估口径与限制</summary><p><small>{revision_note}</small></p><p><small>IoU是区域交并比，不是门店完整通过率。按原图像素比较，未平移对齐；栅格指标不直接等同旧矢量引擎的精确多边形指标。入口、量尺、家具、墙柱分类本轮未重评分。</small></p><p><small>清理仅保留最大连通块、填内部孔洞，保留外侧凹口。它能去掉离散文字，也可能误删多块平面；不能修复所有边界外扩。原始预测同时保留。清理会误删有效区域，本轮不设为默认。</small></p></details></section>
{promotion_note}<p>{question_note} <a href="#feedback-block">补充意见</a></p>{focus_table}
<p>按本轮结果从弱到强排列。黄色为参考，青色为预测；点击图可放大。</p><div class="grid">{''.join(cards)}</div><section class="box" id="feedback-block"><h2>补充意见（选填）</h2><p>{question_note} 已有48家审核不要求重做。识别错误继续由我处理。</p><label>补充意见（选填，自动保存）<textarea id="feedback" placeholder="例如：门店编号＋你发现的问题"></textarea></label><p><button id="export-feedback">导出补充意见</button> <span id="saved" role="status"></span></p><small>只保存本页新意见，不修改原整店审核包。</small></section>
<section class="box"><p>训练为独立{counts["train"]}家，{counts["internal_val"]}家仅作内部模型选择。48家用于开发复评和预处理诊断，未进入训练；45家只保留身份隔离索引，未读原图、几何或分数。云识别默认关闭，本轮全部本机完成。</p><a href="results.json">逐店结果JSON</a> · <a href="frozen-candidate.json">冻结版本记录</a></section></main>
<script>const key={key!r};document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{{const card=b.closest('article'),a=card.querySelector('a');a.href='images/'+card.dataset.store+'-'+b.dataset.view+'.jpg';a.querySelector('img').src=a.href}});const field=document.querySelector('#feedback');try{{field.value=localStorage.getItem(key)||''}}catch{{}}field.oninput=()=>{{try{{localStorage.setItem(key,field.value);document.querySelector('#saved').textContent='已保存'}}catch{{document.querySelector('#saved').textContent='请导出保存'}}}};document.querySelector('#export-feedback').onclick=()=>{{const data={{task:'outline-development-review',batch:key,feedback:field.value,createdAt:new Date().toISOString()}};const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{{type:'application/json'}}));const a=document.createElement('a');a.href=u;a.download='48家轮廓复评-补充意见.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}};const id=new URLSearchParams(location.search).get('store');if(id)document.getElementById(id)?.scrollIntoView();</script></html>"""
    (root / "复评审核.html").write_text(page, encoding="utf-8")
    save(
        root / "report-file-hashes.json",
        {
            p.relative_to(root).as_posix(): sha(p)
            for p in root.rglob("*")
            if p.is_file() and p.name != "report-file-hashes.json"
        },
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    build(ap.parse_args().root)
