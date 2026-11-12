// 只组装本地交付页，无服务调用；审核答案独立保存，不改写输入/既有审核包。
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const out = path.resolve(process.argv[2] ?? '')
assert.ok(process.argv[2], '用法：node tools/recognition/usable-review.mjs 外置样例目录')
const read = async (p) => JSON.parse(await readFile(path.join(out, p), 'utf8'))
const provenance = await read('来源与限制.json')
assert.equal(provenance.storeId, 'PDF-231', '此交付页的尺寸说明仅适用于武汉样例，其他门店须独立编写依据')
const proof = await read('验证结果.json')
const project = await read('完整样例.store-design.json')
assert.equal(proof.passed, true, '先完成真实编辑器验证')
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const embedded = JSON.stringify({ storeId: provenance.storeId, questions: provenance.unresolved }).replace(/</g, '\\u003c')
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'">
<title>识图样例 · ${esc(project.project.name)}</title>
<style>
:root{color-scheme:light;--yellow:#ffd400;--ink:#171717;--line:#dedbd2}*{box-sizing:border-box}body{margin:0;background:#f5f4ef;color:var(--ink);font:15px/1.7 system-ui,'Microsoft Yahei',sans-serif}main{max-width:1160px;margin:auto;padding:32px 24px 70px}header{border-bottom:3px solid var(--ink);padding-bottom:22px;margin-bottom:24px}.tag{background:var(--yellow);padding:5px 10px;font-weight:700;border-radius:5px}h1{font-size:30px;line-height:1.3;margin:14px 0 10px}h2{font-size:21px;margin:0 0 12px}p{margin:8px 0}.muted{color:#615e55}.actions{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}a{color:inherit;text-decoration-thickness:1px;text-underline-offset:3px}.btn,button{display:inline-block;background:#171717;color:white;border:1px solid #171717;border-radius:7px;padding:10px 16px;font:inherit;text-decoration:none;cursor:pointer}.primary{background:var(--yellow);color:#111}.secondary{background:white;color:#111}section,details{background:white;border:1px solid var(--line);border-radius:12px;padding:22px;margin:20px 0}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.stat{border-left:4px solid var(--yellow);padding:8px 15px;background:white}.stat strong{display:block;font-size:23px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pair img{width:100%;border:1px solid var(--line);border-radius:6px}figure{margin:0}figcaption{color:#615e55;margin-top:8px}select,textarea{display:block;width:100%;font:inherit;padding:10px;border:1px solid #aaa;border-radius:6px;margin:6px 0 14px}textarea{min-height:72px}summary{cursor:pointer;font-weight:700}.status{background:#fff5bc;padding:10px 14px;border-radius:6px}li{margin:7px 0}code{overflow-wrap:anywhere}button:focus-visible,a:focus-visible{outline:3px solid #b39000;outline-offset:3px}@media(max-width:720px){.pair,.stats{grid-template-columns:1fr}main{padding:20px 14px}h1{font-size:25px}}
</style><main>
<header id="top"><span class="tag">可导入 · 可改尺寸 · 可看三维</span><h1>${esc(project.project.name)}</h1><p>首个完整空间样例。复用原图描点并校正入口，已通过工作台真实页面往返验证。</p><p class="muted">代理辅助校正，尚非全自动识别；道具由你手动摆放。原图版与尺寸演示版同时保留。</p>
<div class="actions"><a class="btn primary" href="完整样例.store-design.json" download>下载完整样例</a><a class="btn secondary" href="#review">查看待确认项（${provenance.unresolved.length}）</a><a class="btn secondary" href="原图空间.store-design.json" download>仅下载原图空间</a></div></header>
<div class="stats"><div class="stat"><strong>2 个空间版本</strong>原图版 + 设计演示版</div><div class="stat"><strong>${proof.checks.length} 项通过</strong>导入、尺寸、保存、三维、往返</div><div class="stat"><strong>0 次外发</strong>云端关闭，45 家保持隔离</div></div>
<section><h2>怎么用</h2><ol><li>工作台“项目列表” → “导入项目”，选择下载的 JSON。</li><li>打开项目，在历史中选“原图空间”或“设计演示”。</li><li>点“修改空间”调整边长或层高，再点“保存空间”；新版本保留在历史中。</li><li>点“三维”查看空间；需要家具时使用“手动排布”。</li></ol><p class="status">已验证：首边 ${proof.originalLengthMm} → 6800 mm，层高 4000 → 3800 mm。改动只用于演示，不代表原图或现场尺寸变化。</p></section>
<section><h2>实际运行结果</h2><div class="pair"><figure><a href="01-导入平面.png" target="_blank"><img src="01-导入平面.png" alt="原图空间导入工作台后的平面"></a><figcaption>原图空间 · 入口已按图示 5661 mm 校正</figcaption></figure><figure><a href="03-三维预览.png" target="_blank"><img src="03-三维预览.png" alt="修改尺寸、保存刷新后的工作台三维"></a><figcaption>设计演示版 · 保存刷新后的真实三维</figcaption></figure></div><p><a href="02-修改尺寸.png" target="_blank">尺寸编辑过程</a> · <a href="04-重新导入三维.png" target="_blank">导出再导入后的三维</a> · <a href="验证结果.json" target="_blank">验证明细</a></p></section>
<section><h2>这次已处理</h2><p>保留斜边与左下折返；邻铺、文字和尺寸线未作为店内实体。保留休息室两段隔墙。</p><p>旧入口约 5414 mm，依据砌墙定位图及门头展开图的 5661 mm 修正。毫米取整后的入口为 5660.6 mm。</p><p class="muted">边界仍是描点近似：右端余量与图示约差 6 mm；原生几何精度到毫米，不代表现场测量精度。图纸与侧车来源资料一并保留。</p><p><a href="原图.png" target="_blank">平面原图</a> · <a href="原图第12页.png" target="_blank">砌墙定位图</a> · <a href="原图第19页.png" target="_blank">入口尺寸依据</a> · <a href="来源与限制.json" target="_blank">来源与限制</a></p></section>
<section id="review"><h2>需要你确认</h2><p class="muted">不必重复填审核人。答案保存在本页；导出后发回即可。不会覆盖你此前的 48 家审核。</p><div id="questions"></div><div class="actions"><button id="confirm" class="primary">保存答复并返回顶部</button><button id="undo" class="secondary">撤销更改</button><button id="export">导出本页答复</button></div><p id="status" role="status"></p></section>
<details><summary>云端方案：服务商与发送内容（未启用）</summary><p><strong>拟选阿里云百炼（DashScope）视觉理解服务。</strong>模型版本、地域和保存策略在启用前固定并展示；当前没有调用。</p><p>拟发送：选中的主平面图片、必要局部放大图、相关尺寸文字、匿名样本编号与输出字段规则。裁去标题栏、签名、联系方式和无关页；保留的门店布局仍会发送到外部服务商。</p><p>本轮不发送整本 PDF、45 家验收数据、审核答案、模型库或账号信息。图纸预览与清单经确认后才允许单次调用，开关继续默认关闭。</p><p><a href="云端方案.md">完整发送清单与启用条件</a> · <a href="https://help.aliyun.com/zh/model-studio/vision/" target="_blank" rel="noreferrer">服务商官方文档</a></p></details>
<details><summary>当前限制与下一步</summary><p>这一份证明空间可编辑和预览；不代表 24 家试点或全自动识别完成。室内门洞、门头结构、材质、灯光、家具和施工节点不在本样例完成范围。</p><p>外轮廓变长时，隔墙保持原位，需按设计调整；现有多边形隔墙在空间表单里只能保留或删除。灯箱与广告机后续使用贴墙面，不做内嵌实体块。</p><p>下一步按同一套产品验收处理独立中岛、黑底和复杂邻铺样本，记录导入成功、修改用时和需要人判断的次数，再决定哪个步骤值得模型化。</p></details></main>
<script>
const data=${embedded},key='recognition-usable-review-20261112-v2-'+data.storeId;
let saved={},undo=[];try{saved=JSON.parse(localStorage.getItem(key)||'{}')}catch{};
const root=document.getElementById('questions'),status=document.getElementById('status');
function persist(){try{localStorage.setItem(key,JSON.stringify(saved));status.textContent='答复已保存在本机；请导出备份。'}catch{status.textContent='浏览器不允许本地保存，请立即导出答复。'}}
function update(id,patch){undo.push(JSON.stringify(saved));saved[id]={...(saved[id]||{}),...patch,updatedAt:new Date().toISOString()};persist()}
function render(){root.replaceChildren();for(const q of data.questions){const box=document.createElement('div'),label=document.createElement('label'),hint=document.createElement('p'),select=document.createElement('select'),note=document.createElement('textarea');label.textContent=q.question;hint.textContent=q.current;hint.className='muted';select.id='answer-'+q.id;label.htmlFor=select.id;select.setAttribute('aria-label',q.question);for(const o of ['未确认',...q.options]){const opt=document.createElement('option');opt.textContent=o;opt.value=o==='未确认'?'':o;select.append(opt)}select.value=saved[q.id]?.answer||'';note.placeholder='补充说明或高度（毫米）';note.setAttribute('aria-label','补充说明');note.value=saved[q.id]?.note||'';select.onchange=()=>update(q.id,{answer:select.value});note.onchange=()=>update(q.id,{note:note.value});box.append(label,hint,select,note);root.append(box)}}
document.getElementById('undo').onclick=()=>{if(!undo.length){status.textContent='没有可撤销的更改。';return}saved=JSON.parse(undo.pop());persist();render()};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();document.getElementById('undo').click()}});
document.getElementById('confirm').onclick=()=>{persist();document.getElementById('top').scrollIntoView({behavior:'smooth'})};
document.getElementById('export').onclick=()=>{const pack={schemaVersion:1,kind:'usable-sample-review',storeId:data.storeId,exportedAt:new Date().toISOString(),answers:saved,cloudEnabled:false};const url=URL.createObjectURL(new Blob([JSON.stringify(pack,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='武汉样例审核答复.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};render();
</script></html>`
await writeFile(path.join(out, '审核页.html'), html, { flag: 'wx' })
console.log('已生成本地审核页')
