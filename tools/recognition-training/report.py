"""生成本地黑白黄试训审核页；只读既有审核包，不写回旧记录。"""

import argparse
import html
import shutil
from pathlib import Path
from dataset import load, save, sha, validate, need


def build(data, run, out, question_image=None):
    from PIL import Image

    data, run, out = Path(data), Path(run), Path(out)
    need(not out.exists(), "报告已存在，请换新版本目录")
    m = validate(data)
    summary = load(run / "summary.json")
    best = load(run / "best-metrics.json")
    prior = load(run / "layout-prior-metrics.json")
    decisions = load(data / "decisions.json")["records"]
    out.mkdir(parents=True)
    (out / "assets").mkdir()

    def small(src, name):
        im = Image.open(src).convert("RGB")
        im.thumbnail((1200, 1200))
        im.save(out / "assets" / name)
        return "assets/" + name

    question_visual = ""
    if question_image:
        asset = small(question_image, "PDF-356-question.png")
        question_visual = f'<p><a href="{asset}" target="_blank"><img src="{asset}" alt="遵义柱边原图局部，点击放大" style="max-width:100%;max-height:480px"></a></p>'
    cards = []
    for s in m["samples"]:
        id = s["store_id"]
        metric = next(r for r in best if r["store_id"] == id)
        raw = small(data / s["image"], id + "-original.png")
        review = small(data / id / "review.png", id + "-label.png")
        pred = small(
            run / "predictions" / f"{id}-comparison.png", id + "-prediction.png"
        )
        cards.append(
            f'<article><h3>{html.escape(id+" · "+s["name"])}</h3><p>{"内部验证" if s["split"]=="internal_val" else "训练"} · IoU {metric["iou"]:.1%}</p><div class="switch"><button data-img="{raw}">原页</button><button data-img="{review}">标签</button><button data-img="{pred}">预测</button></div><a href="{review}" target="_blank"><img src="{review}" alt="{id}轮廓标签" loading="lazy"></a></article>'
        )
    val = [r for r in best if r["split"] == "internal_val"]
    pval = [r for r in prior if r["split"] == "internal_val"]
    failures = {
        "PDF-402": "轮廓明显外扩，斜角未辨清；表现低于版式基线。",
        "NEW-069": "两侧内凹并漏标，底边外扩，未还原准确矩形。",
        "PDF-188": "把文字、尺寸注记识别成店铺，出现多个离散区域。",
    }
    table = "".join(
        f'<tr><td>{r["store_id"]}</td><td>{r["iou"]:.1%}</td><td>{next(p["iou"] for p in pval if p["store_id"]==r["store_id"]):.1%}</td><td>{html.escape(failures.get(r["store_id"],"逐图核查"))}</td></tr>'
        for r in val
    )
    deferred = "".join(
        f'<tr><td>{r["store_id"]}</td><td>{html.escape(r["reason"])}</td><td>{"需你确认" if r["resolutionOwner"]=="user" else "代理继续处理"}</td></tr>'
        for r in decisions
        if r["status"] != "admitted"
    )
    prior_mean = sum(p["iou"] for p in pval) / len(pval)
    body = f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>首批轮廓试训</title>
<style>body{{margin:0;background:#f5f5f2;color:#181818;font:16px/1.65 system-ui,"Microsoft YaHei",sans-serif}}main{{max-width:1200px;margin:auto;padding:32px 24px}}header{{border-top:8px solid #ffd600;padding:18px 0}}h1{{font-size:32px;margin:0}}h2{{margin-top:36px}}.pill,button{{background:#ffd600;color:#111;border:1px solid #111;border-radius:6px;padding:8px 14px}}button{{cursor:pointer;font:inherit}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}}article,.box{{background:white;border:1px solid #ddd;padding:20px;border-radius:8px}}article img{{width:100%;margin-top:12px}}h3{{margin:0}}table{{width:100%;border-collapse:collapse;background:white}}td,th{{border-bottom:1px solid #ddd;text-align:left;padding:12px}}.switch{{display:flex;gap:8px}}textarea{{width:100%;min-height:90px;box-sizing:border-box;font:inherit;padding:12px}}small{{color:#555}}a{{color:#111}}.status{{font-weight:bold}}@media(max-width:650px){{main{{padding:16px}}table{{font-size:13px}}td,th{{padding:6px}}}}</style>
<main><header><h1>首批轮廓试训</h1><p>10家独立门店 · 7家训练 / 3家内部验证 · 2026-11-05</p><span class="pill">试训已完成，尚不可直接接入生产</span></header>
<div class="box"><p>48家开发集和45家验收集均未进入训练，也未用于本次评分。旧审核结果原样保留。本页只审核轮廓，家具摆放、入口、量尺和三维建模未由此模型生成。</p><p>160轮 / 640次参数更新；内部验证最佳IoU <b>{summary['bestValIoU']:.1%}</b>，平均位置基线 {prior_mean:.1%}。仅3家，不能据此估计全量准确率。</p><small>IoU是预测与参考区域的交并比，不是门店通过率。最佳模型按内部验证选择，未进行独立验收。标签为代理核对的试训标签，不冒充人工金标准。</small></div>
<h2>3家内部验证</h2><table><tr><th>门店</th><th>模型IoU</th><th>位置基线</th><th>问题</th></tr>{table}</table><p>预测图：黄色为参考，青色为预测；两者重叠呈绿色。标签图的黄色只用于审核，不是训练输入。</p>
<h2>需要你确认：1项</h2><div class="box"><b>PDF-356 遵义：柱面灯箱外侧包板是否属于门店允许使用范围？</b><p>图纸未明确边界归属。本轮已排除，不影响已完成试训。建议有租赁或竣工依据后再纳入；其余未完成项由代理继续查证。</p>{question_visual}<label>集中回复（自动保存在当前浏览器）<textarea id="answer" placeholder="例如：属于店内范围／属于外侧附属安装／暂缺依据，继续保留未知"></textarea></label><p><button id="download">导出确认记录</button> <span id="saved" role="status"></span></p><small>仅保存本项新回复，不修改48家审核包。</small></div>
<h2>10家标签与预测</h2><div class="grid">{''.join(cards)}</div>
<h2>14家暂未纳入</h2><table><tr><th>门店</th><th>原因</th><th>处理人</th></tr>{deferred}</table>
<h2>限制与下一步</h2><p>第一次试训全背景失败已保留。当前模型仍有文字误检、边界外扩和过拟合，先补独立样本与难例，再冻结模型跑48家开发集；45家继续留作最后验收。扫描质量、尺度恢复、多入口、家具及柱洞均未在本次训练中验证。</p><p>云端识别仍默认关闭；本轮在本机CPU运行，未上传图纸。</p></main>
<script>const key='outline-trial-20261105-pdf356';const field=document.querySelector('#answer');try{{field.value=localStorage.getItem(key)||''}}catch{{}}field.addEventListener('input',()=>{{try{{localStorage.setItem(key,field.value);document.querySelector('#saved').textContent='已保存'}}catch{{document.querySelector('#saved').textContent='浏览器未允许本地保存，请导出记录'}}}});document.querySelector('#download').onclick=()=>{{const data={{schemaVersion:1,task:'outline-trial-20261105',store_id:'PDF-356',question:'柱面灯箱外侧包板的边界归属',answer:field.value,answeredAt:new Date().toISOString()}};const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{{type:'application/json'}}));const a=document.createElement('a');a.href=u;a.download='首批轮廓试训-确认记录.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}};document.querySelectorAll('[data-img]').forEach(b=>b.onclick=()=>{{const a=b.closest('article').querySelector('a');a.href=b.dataset.img;a.querySelector('img').src=b.dataset.img}});</script></html>"""
    (out / "审核页.html").write_text(body, encoding="utf-8")
    save(
        out / "results.json",
        {
            "summary": summary,
            "internalValidation": val,
            "layoutPriorMeanIoU": prior_mean,
            "failures": failures,
            "deferred": [r for r in decisions if r["status"] != "admitted"],
            "dataManifestSha256": sha(data / "manifest.json"),
        },
    )
    save(
        out / "file-hashes.json",
        {
            p.relative_to(out).as_posix(): sha(p)
            for p in sorted(out.rglob("*"))
            if p.is_file()
        },
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True)
    p.add_argument("--run", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--question-image")
    a = p.parse_args()
    build(a.data, a.run, a.out, a.question_image)
