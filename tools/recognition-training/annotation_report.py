"""把新增独立轮廓及归属歧义集中成离线审核页；不写原审核包。"""

import argparse
import html
import json
import shutil
from pathlib import Path
from dataset import load, save, sha, need, within, validate


def build(source, inputs, root, training_data):
    source, inputs, root = Path(source), Path(inputs), Path(root)
    need(not (root / "补充标注审核.html").exists(), "报告已存在，保留旧版")
    decisions = load(source / "decisions.json")
    questions = load(source / "questions.json")
    resolved = decisions.get("resolvedQuestions", [])
    confirmation = None
    if resolved:
        confirmation = load(source / "user-confirmations.json")
        need(
            sha(source / "user-confirmations.json")
            == decisions.get("userConfirmationSha256"),
            "用户确认记录哈希不一致",
        )
        need(confirmation["decisions"] == resolved, "已回答问题与用户确认不一致")
    samples = load(inputs / "pilot-manifest.json")["samples"]
    manifest = validate(training_data)
    need(
        sha(source / "decisions.json") == sha(Path(training_data) / "decisions.json"),
        "审核准入记录不是训练冻结版本",
    )
    need(questions == decisions.get("newQuestions", []), "审核问题与冻结准入记录不同")
    need(
        sha(inputs / "pilot-manifest.json")
        == sha(Path(training_data) / "identity-only/pilot-manifest.json"),
        "审核输入不是训练冻结版本",
    )
    train_count = sum(s["split"] == "train" for s in manifest["samples"])
    val_count = sum(s["split"] == "internal_val" for s in manifest["samples"])
    split_by_id = {s["store_id"]: s["split"] for s in manifest["samples"]}
    question_ids = {q["store_id"] for q in questions}
    records = {r["store_id"]: r for r in decisions["records"]}
    need(
        not question_ids & {s["store_id"] for s in manifest["samples"]},
        "待决样本不得进入训练数据",
    )
    selected = [
        s for s in samples if (source / s["store_id"] / "original.png").is_file()
    ]
    need(
        question_ids <= {s["store_id"] for s in selected},
        "待决原图缺失，不得漏掉审核问题",
    )
    admitted_count = sum(
        records[s["store_id"]]["status"] == "admitted" for s in selected
    )
    old_deferred = sum(
        r["status"] != "admitted" and r["store_id"] not in question_ids
        for r in records.values()
    )
    root.mkdir(parents=True, exist_ok=True)
    image_root = root / "annotation-images"
    image_root.mkdir(exist_ok=False)
    cards = []
    for s in sorted(
        selected, key=lambda s: (s["store_id"] not in question_ids, s["store_id"])
    ):
        sid = s["store_id"]
        r = records[sid]
        original = within(source, sid + "/original.png")
        shutil.copy2(original, image_root / (sid + "-original.png"))
        review = source / sid / "review.png"
        if r["status"] == "admitted":
            need(sha(original) == r["imageSha256"], "审核原图改变")
            shutil.copy2(review, image_root / (sid + "-review.png"))
        q = next((q for q in questions if q["store_id"] == sid), None)
        if q:
            options = "".join(
                f'<option value="{html.escape(o, quote=True)}">{html.escape(o)}</option>'
                for o in q["options"]
            )
            controls = f'<h3>{html.escape(q["title"])}</h3><label>你的判断<select data-answer="{q["id"]}"><option value="">暂未选择</option>{options}</select></label><label>补充说明（选填）<textarea data-note="{q["id"]}"></textarea></label><button data-confirm="{q["id"]}">确认并看下一项</button><span data-state="{q["id"]}"></span>'
            switch = ""
            filename = sid + "-original.png"
        else:
            answer = next((x for x in resolved if x["store_id"] == sid), None)
            controls = '<p class="small">代理已校正，本轮无需逐店确认。</p>'
            if answer:
                controls = f'<p class="resolved"><strong>范围已由你确认：</strong>{html.escape(answer["answer"])}。像素边界由代理校正。</p>'
            switch = f'<button data-switch="{sid}" data-view="original">原图</button> <button data-switch="{sid}" data-view="review">标注</button>'
            filename = sid + "-review.png"
        cards.append(
            f'<article id="ann-{sid}" data-store="{sid}"><h2>{sid} · {html.escape(s["name"])}</h2><p>{"待你判断 · 未用于训练" if q else ("代理校正 · 仅内部验证，不参与训练" if split_by_id.get(sid) == "internal_val" else "代理校正 · 训练样本")}</p>{switch}<a class="picture" target="_blank" href="annotation-images/{filename}"><img src="annotation-images/{filename}" loading="lazy" alt="{sid}原图或轮廓标注"></a><p>{html.escape(r["reason"])}</p>{controls}</article>'
        )
    payload = {
        "schemaVersion": 1,
        "task": "independent-outline-ambiguities",
        "batch": sha(source / "decisions.json"),
        "questions": questions,
        "sourceDecisionsSha256": sha(source / "decisions.json"),
        "existingReviewsUnchanged": True,
        "resolvedQuestions": resolved,
        "userConfirmation": confirmation,
    }
    encoded = json.dumps(payload, ensure_ascii=False).replace("<", "\\u003c")
    page = """<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>独立难例补充审核</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f5f5f2;color:#161616;font:16px/1.65 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1100px;margin:auto;padding:24px}header{border-top:8px solid #ffd200}h1{font-size:30px}h2{font-size:22px}h3{font-size:18px}article,.box{background:white;border:1px solid #ddd;border-radius:8px;padding:22px;margin:20px 0}img{display:block;width:100%;max-height:650px;object-fit:contain;margin:15px 0}a{color:#111}button{background:#ffd200;border:1px solid #111;border-radius:5px;padding:8px 12px;font:inherit;cursor:pointer}select,textarea,input{display:block;width:100%;font:inherit;padding:9px;margin:5px 0 12px;border:1px solid #aaa;border-radius:5px}textarea{min-height:65px}.small{color:#555;font-size:14px}nav{display:flex;gap:10px;align-items:center;flex-wrap:wrap}#status{display:block}article:target{outline:3px solid #ffd200}@media(max-width:600px){main{padding:12px}article,.box{padding:14px}h1{font-size:26px}h2{font-size:19px}}</style>
<main><header><h1>独立难例补充审核</h1><p>只需判断2处范围归属，其余12家已由我校正。已有审核结果全部保留。</p></header><section class="box"><nav><a href="复评审核.html">返回48家复评</a><button id="undo">撤销（Ctrl+Z）</button><button id="export">导出本页答复</button></nav><label>审核人（选填，只填一次）<input id="reviewer" autocomplete="name"></label><span id="status" role="status"></span><p class="small">本轮总计32家独立样本：29训练、原3家内部验证。黑底为独立原图生成的增强图，不是新增真实黑底门店。两项待决样本及旧4家暂缓样本均未训练。</p></section>CARDS<footer class="box">本页答复只保存到当前浏览器；导出后交回即可。不会覆盖48家旧审核包，也不会自动把待决样本纳入训练。</footer></main>
<script>const evidence=PAYLOAD,key='outline-ambiguities-'+evidence.batch,history=[];let state={answers:{},notes:{},confirmed:{}};try{state=JSON.parse(localStorage.getItem(key))||state;document.querySelector('#reviewer').value=localStorage.getItem('store-design-reviewer')||''}catch{}const status=document.querySelector('#status');function persist(){try{localStorage.setItem(key,JSON.stringify(state));status.textContent='已自动保存'}catch{status.textContent='本地保存不可用，请导出答复'}}function draw(){for(const q of evidence.questions){document.querySelector('[data-answer="'+q.id+'"]').value=state.answers[q.id]||'';document.querySelector('[data-note="'+q.id+'"]').value=state.notes[q.id]||'';document.querySelector('[data-state="'+q.id+'"]').textContent=state.confirmed[q.id]?' 已确认':' 待确认'}}function change(f){history.push(JSON.stringify(state));f();persist();draw()}function undo(){if(history.length){state=JSON.parse(history.pop());persist();draw();status.textContent='已撤销'}}document.querySelector('#undo').onclick=undo;document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA'].includes(e.target.tagName)){e.preventDefault();undo()}});document.querySelector('#reviewer').oninput=e=>{try{localStorage.setItem('store-design-reviewer',e.target.value)}catch{}};for(const q of evidence.questions){document.querySelector('[data-answer="'+q.id+'"]').onchange=e=>{const v=e.target.value;change(()=>{state.answers[q.id]=v;delete state.confirmed[q.id]})};document.querySelector('[data-note="'+q.id+'"]').oninput=e=>{history.push(JSON.stringify(state));state.notes[q.id]=e.target.value;delete state.confirmed[q.id];persist();document.querySelector('[data-state="'+q.id+'"]').textContent=" 待确认"};document.querySelector('[data-confirm="'+q.id+'"]').onclick=()=>{if(!state.answers[q.id]&&!state.notes[q.id]){status.textContent='请先选择或填写判断';status.scrollIntoView();return}change(()=>state.confirmed[q.id]=true);const next=evidence.questions.find(x=>!state.confirmed[x.id]);if(next){location.hash='ann-'+next.store_id}else{location.hash='';scrollTo({top:0,behavior:'smooth'});status.textContent='本页问题已确认，请导出答复'}}}document.querySelectorAll('[data-switch]').forEach(b=>b.onclick=()=>{const a=b.closest('article').querySelector('.picture');a.href='annotation-images/'+b.dataset.switch+'-'+b.dataset.view+'.png';a.querySelector('img').src=a.href});document.querySelector('#export').onclick=()=>{const payload={...evidence,reviewer:document.querySelector('#reviewer').value,answers:evidence.questions.map(q=>({id:q.id,store_id:q.store_id,answer:state.answers[q.id]||'',note:state.notes[q.id]||'',confirmed:!!state.confirmed[q.id]})),exportedAt:new Date().toISOString()};const u=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='独立难例-范围确认.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};draw();</script></html>"""
    page = page.replace("CARDS", "".join(cards)).replace("PAYLOAD", encoded)
    page = page.replace(
        "只需判断2处范围归属，其余12家已由我校正。",
        f"只需判断{len(questions)}处范围归属，其余{admitted_count}家已由我校正。",
    )
    page = page.replace(
        "本轮总计32家独立样本：29训练、原3家内部验证。",
        f"本轮总计{len(manifest['samples'])}家独立样本：{train_count}训练、{val_count}家内部验证。",
    )
    page = page.replace(
        "两项待决样本及旧4家暂缓样本均未训练。",
        f"{len(questions)}项待决样本及旧{old_deferred}家暂缓样本均未训练。",
    )
    if not questions:
        page = page.replace(
            f"只需判断0处范围归属，其余{admitted_count}家已由我校正。",
            f"你已确认{len(resolved)}处范围归属。本轮{admitted_count}家标注已完成，无新增待确认问题。",
        )
        page = page.replace(
            "本页答复只保存到当前浏览器；导出后交回即可。",
            "已回答的范围结论来自聊天确认，固定保存在本页及导出记录中，无需重复填写。",
        )
    (root / "补充标注审核.html").write_text(page, encoding="utf-8")
    save(root / "annotation-review-evidence.json", payload)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    for key in ["source", "inputs", "out", "training-data"]:
        p.add_argument("--" + key, required=True)
    a = p.parse_args()
    build(a.source, a.inputs, a.out, a.training_data)
