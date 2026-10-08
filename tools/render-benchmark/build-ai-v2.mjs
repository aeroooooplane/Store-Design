import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
const root=new URL('../../素材库/05_render_benchmark/s03-v2/',import.meta.url)
const read=async name=>JSON.parse(await fs.readFile(new URL(name,root),'utf8'))
const manifest=await read('manifest.json'),review=await read('ai-review.json')
manifest.assets=manifest.assets.filter(a=>a.kind!=='ai-concept')
for(const view of [0,2]){
  const file=`AI-SI1.0-view${view}.png`,bytes=await fs.readFile(new URL(file,root))
  manifest.assets.push({kind:'ai-concept',style:'SI1.0',view,file,sha256:createHash('sha256').update(bytes).digest('hex')})
}
manifest.aiStatus='two-SI1.0-concepts-generated-not-geometry-approved'
await fs.writeFile(new URL('manifest.json',root),JSON.stringify(manifest,null,2))
const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const card=(file,title)=>`<figure><a href="${file}" target="_blank"><img src="${file}" alt="${title}"></a><figcaption>${title}</figcaption></figure>`
await fs.writeFile(new URL('ai.html',root),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>S03 v2 · AI 材质验证</title><style>body{font:16px/1.7 system-ui;margin:0;background:#edf0ed;color:#203c33}main{max-width:1440px;margin:auto;padding:28px}section{background:white;padding:24px;margin:24px 0;border-radius:16px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}figure{margin:0}img{width:100%;display:block}a{color:#17604e}.notice{background:#fff1d7;padding:20px}.overlay{position:relative;max-width:800px}.overlay img:last-child{position:absolute;inset:0;opacity:.5}input{display:block;width:min(800px,100%)}@media(max-width:800px){.grid{grid-template-columns:1fr}}</style><main><h1>新版道具 · 双机位 AI 材质验证</h1><p>SI1.0 灰色风格 · 内置 image_gen · 两张图独立生成 · 本轮没有模型训练</p><p class="notice">${escape(review.summary)}<br>结论：尚未通过几何交付验收。以下为助手目视初审，需设计人员复核。</p><p><a href="index.html">白膜与程序材质</a> · <a href="ai-prompts.json">完整提示词与输入角色</a> · <a href="ai-review.json">检查记录</a> · <a href="manifest.json">文件校验值</a></p>${review.cases.map(c=>`<section><h2>${c.view===0?'正面':'右前方'}机位</h2><div class="grid">${card(`white-view${c.view}.png`,'输入白膜')}${card(`SI1.0-view${c.view}.png`,'程序材质基准')}${card(`AI-SI1.0-view${c.view}.png`,'AI 材质增强')}</div><ul>${c.notes.map(n=>`<li>${escape(n)}</li>`).join('')}</ul><details><summary>叠加检查轮廓</summary><p>按相同比例显示，未做配准。拖动透明度检查位移；这不是自动几何评分。</p><div class="overlay"><img src="white-view${c.view}.png" alt="白膜底图"><img id="overlay-${c.view}" src="AI-SI1.0-view${c.view}.png" alt="AI叠加"></div><label>AI 透明度<input type="range" min="0" max="100" value="50" oninput="document.getElementById('overlay-${c.view}').style.opacity=this.value/100"></label></details></section>`).join('')}<section><h2>判断与下一步</h2><p>${escape(review.decision)}</p><p>程序材质图有墙面标识、灯带；本轮 AI 输入只有白膜，提示词明确要求不新增这些内容。原店效果图仅作为灰色材料参考，其 SI 版本仍待品牌确认。参数化白膜的构造假设也尚未通过实物核对。</p></section></main></html>`)
console.log('Saved two AI assets to manifest and built ai.html')
