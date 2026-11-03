import { readFile, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
const arg = (k) => {
    const i = process.argv.indexOf('--' + k)
    return i < 0 ? null : process.argv[i + 1]
  },
  json = async (p) => JSON.parse(await readFile(p, 'utf8'))
for (const k of ['review', 'evaluation', 'references']) if (!arg(k)) throw new Error('缺少 --' + k)
const root = path.resolve(arg('review')),
  evaluation = await json(path.join(arg('evaluation'), '复评结果.json')),
  refs = await json(arg('references')),
  data = await json(path.join(root, 'candidates.json'))
if ([evaluation.datasetFingerprint, refs.datasetFingerprint].some((f) => f !== data.fingerprint))
  throw new Error('汇总数据版本不一致')
const esc = (s) =>
    String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;'),
  pct = (x) => (x === null ? '不可判定' : (x * 100).toFixed(1) + '%'),
  decision = refs.samples.filter((s) => s.question),
  regressions = evaluation.rows.filter(
    (r) => r.baseline.iou !== null && r.candidate.iou < r.baseline.iou - 0.02,
  )
const rowLink = (r) => `开发集审核.html?store=${encodeURIComponent(r.id)}`
const questionCards = decision
  .map((r, i) => {
    const s = data.samples.find((s) => s.id === r.id)
    return `<article id="${r.id}"><h3>${i + 1}. ${esc(r.id)} · ${esc(s.name)}</h3><p class="question">${esc(r.question)}</p><p>${esc(r.notes)}</p><p><a href="${rowLink(r)}" target="_blank">打开可编辑草稿</a> · <a href="images/${r.id}.png" target="_blank">原图大图</a> · <a href="overlays/${r.id}.png" target="_blank">候选与参照叠图</a></p><details><summary>展开原图</summary><img loading="lazy" src="images/${r.id}.png" alt="${r.id} 原图"></details><label>你的确认意见<textarea data-answer="${r.id}" placeholder="可直接写边界范围、入口侧或补充说明；也可在聊天中按编号回复。"></textarea></label></article>`
  })
  .join('')
const metricRows = [
  ['生成闭合边界', 'closed', 48],
  ['边界 IoU ≥ 0.90', 'boundary', 37],
  ['比例误差 ≤ 2%', 'scale', 48],
  ['主入口所在边', 'entrance', 31],
  ['三项同时满足', 'allThree', 31],
]
  .map(
    ([label, key, total]) =>
      `<tr><td>${label}</td>${['baseline', 'candidate']
        .map((v) => {
          const m = evaluation.versions[v][key]
          return `<td>${typeof m === 'number' ? m + '/' + total : m.passed + '/' + m.eligible}</td>`
        })
        .join('')}</tr>`,
  )
  .join('')
const sampleRows = evaluation.rows
  .map(
    (r) =>
      `<tr><td><a href="${rowLink(r)}" target="_blank">${r.id}</a></td><td>${esc(r.name)}</td><td>${pct(r.baseline.iou)} → ${pct(r.candidate.iou)}</td><td>${pct(r.candidate.scaleError)}</td><td>${r.candidate.entrance === null ? '待确认' : r.candidate.entrance ? '通过' : '未通过'}</td><td>${r.question ? `<a href="#${r.id}">待确认</a>` : r.candidate.allThree ? '三项通过' : '需修复'}${r.candidate.nearThreshold ? ' · 临界抽审' : ''}</td><td><a href="overlays/${r.id}.png" target="_blank">看叠图</a></td></tr>`,
  )
  .join('')
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>48 家开发集：复评与集中歧义</title><style>body{margin:0;background:#f5f5f2;color:#202020;font:16px/1.6 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:32px}h1{font-size:30px}h2{margin-top:36px}article,section{background:white;border:1px solid #ddd;border-radius:12px;padding:24px;margin:18px 0}a{color:#175bb5}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}th{background:#f4f4ed}.question{font-weight:650;color:#7b3e00}textarea{display:block;width:100%;min-height:82px;box-sizing:border-box;margin-top:8px;padding:12px;font:inherit}button{background:#ffd200;border:0;border-radius:8px;padding:12px 20px;font:inherit;cursor:pointer}.notice{border-left:5px solid #d39b00;padding:14px;background:#fff6d9}img{width:100%;height:auto}details{margin:12px 0}.scroll{overflow:auto}.muted{color:#666}nav{display:flex;gap:20px;flex-wrap:wrap}</style><main><h1>48 家开发集：复评与集中歧义</h1><p>2026-10-30 · 31 家完成代理对图校正，17 家需确认（11 家边界归属，6 家仅入口侧）。全部 48 家已有量尺参照。</p><nav><a href="#questions">处理 17 家歧义</a><a href="#all">查看全部 48 家</a><a href="开发集审核.html">进入描点审核页</a><a href="逐店复评.csv">下载逐店复评 CSV</a><a href="复评结果.json">下载完整结果 JSON</a></nav><section><h2>修复前后复评</h2><p>固定输入相同；基线 ${evaluation.baselineRevision.slice(0, 8)} → 候选 ${evaluation.candidateRevision.slice(0, 8)}。</p><table><tr><th>指标</th><th>基线</th><th>候选</th></tr>${metricRows}</table><p class="notice">这是代理独立对图参照下的开发复评，尚未由用户签核。45 家金标准未读取或评分。歧义按项目排除，缺少识别结果仍按失败计入可判定分母；不是整店合格率。道具、柱/管井扣面积和门净宽不在本轮评价范围。</p><p>描点位置约 ±6 原图像素；IoU 0.88–0.92 或比例误差 1%–3% 标为抽审优先。比例无法标定时显示“不可判定”数值，但通过统计按失败计数。</p><p><b>需要修复的明显退化：</b>${regressions.map((r) => `${r.id} ${pct(r.baseline.iou)} → ${pct(r.candidate.iou)}`).join('；')}。PDF-098 候选纳入外围虚线及相邻区域；PDF-090 缩到后加矮墙/柜内侧。PR156 保持草稿，不进入合并。</p><p>其他已核查失败：PDF-259 误选电井；PDF-245 误取外围大框；NEW-024、PDF-003、PDF-411 选错局部轮廓。五家比例未达标：NEW-019、NEW-096、PDF-073、PDF-079、PDF-417。八家未闭合的运行清单见运行对比文件。</p></section><h2 id="questions">需要你确认的 17 家</h2><p>能确定的部分已先处理。可在下方填写并导出答复，也可直接在聊天里按门店编号回复。不会自动把确认意见转换成“审核通过”。</p><p><button id="export">导出确认意见 JSON</button> <span id="progress"></span></p>${questionCards}<h2 id="all">全部 48 家逐店结果</h2><p>叠图：蓝色为当前候选识别，绿色为本次对图参照/待确认提案。绿色待确认边界不计入准确率。</p><div class="scroll"><table><tr><th>编号</th><th>门店</th><th>边界 IoU：前→后</th><th>候选比例误差</th><th>入口边</th><th>状态</th><th>图证</th></tr>${sampleRows}</table></div><p class="muted">输入指纹 ${evaluation.inputsIndexSha256}<br>参照指纹 ${evaluation.referenceSha256}</p></main><script>const meta=${JSON.stringify({ datasetFingerprint: data.fingerprint, referenceSha256: evaluation.referenceSha256, questionIds: decision.map((s) => s.id) }).replaceAll('<', '\\u003c')};const key='recognition-decisions:'+meta.referenceSha256;let answers={};try{answers=JSON.parse(localStorage.getItem(key)||'{}')}catch{}const fields=[...document.querySelectorAll('[data-answer]')];function update(){document.getElementById('progress').textContent='已填写 '+fields.filter(f=>f.value.trim()).length+' / '+fields.length+' 家'}for(const f of fields){f.value=typeof answers[f.dataset.answer]==='string'?answers[f.dataset.answer]:'';f.oninput=()=>{answers[f.dataset.answer]=f.value;localStorage.setItem(key,JSON.stringify(answers));update()}}update();document.getElementById('export').onclick=()=>{const blob=new Blob([JSON.stringify({...meta,answers:fields.map(f=>({id:f.dataset.answer,response:f.value.trim()}))},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='开发集歧义确认-20261030.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};</script></html>`
await writeFile(path.join(root, '复评与歧义.html'), html)
for (const file of ['复评结果.json', '逐店复评.csv'])
  await copyFile(path.join(arg('evaluation'), file), path.join(root, file))
await writeFile(
  path.join(root, '待确认问题.json'),
  JSON.stringify(
    {
      datasetFingerprint: data.fingerprint,
      referenceSha256: evaluation.referenceSha256,
      questions: decision.map((s) => ({
        id: s.id,
        name: data.samples.find((d) => d.id === s.id).name,
        question: s.question,
        proposal: s.notes,
      })),
    },
    null,
    2,
  ),
)
console.log('汇总页已生成：' + path.join(root, '复评与歧义.html'))
