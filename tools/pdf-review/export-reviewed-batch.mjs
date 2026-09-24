import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createCanvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
const root=new URL('../../',import.meta.url);
const read=async p=>JSON.parse(await fs.readFile(new URL(p,root),'utf8'));
const rows=await read('素材库/01_catalog/classification/training-shortlist.json');
const stores=await read('素材库/01_catalog/classification/stores.json');
const out='素材库/03_training_candidates/batch01/';
// Physical PDF pages (1 based); crop coordinates normalized to rendered page.
const config={
 'PDF-159':[1,[2,3],68.3,'异形边厅；前区多组体验桌，后区培训座位与仓储；保留商场柱体。'],
 'PDF-160':[1,[2,3],20.3,'小型边厅；中央单体验桌，沿墙配件陈列，侧边独立仓储。'],
 'PDF-194':[1,[2,4],21,'小型边厅；两张体验桌平行布置，侧墙配件柜；保留既有玻璃及局部高度条件。'],
 'PDF-051':[1,[2,3],16,'狭长中岛；两张体验桌沿长边展开，背侧低柜与灯箱；周边柱体需独立建模。'],
 'PDF-171':[1,[2,4],19.5,'扶梯旁异形中岛；体验桌落在可用开敞区，高柜/标识围绕既有障碍布置。'],
 'PDF-239':[1,[2,3],19.1,'带柱中岛；柱侧配件与灯箱，后侧服务柜，前区两张体验桌。'],
 'PDF-079':[2,[3,4],null,'纵深边厅；前场场景展示，中段多张体验桌，后段洽谈/服务；面积暂未录入。'],
 'PDF-083':[3,[6,7],null,'纵深边厅；体验桌沿纵深串列，左右墙面广告与配件陈列；柱位挤占边缘空间。'],
 'PDF-071':[7,[],38,'机场边厅；体验桌沿纵深排列，后侧保留设备/储物空间；效果图未确认。'],
 'PDF-417':[3,[6,8],null,'开放中岛；三张体验桌并列，周边门架与标识形成边界；面积暂未录入。'],
 'PDF-293':[2,[4,5],12,'小型中岛；两张体验桌，侧边配件及服务柜；柜长中英文标注不一致，不取作标准尺寸。'],
 'PDF-296':[2,[4,5],24,'中岛；两张体验桌，侧边高配件柜及收银拆箱柜；商场吊顶高度是外部条件。']
};
const manifests=[];
for(const row of rows){
 const [plan,renders,area,observation]=config[row.id];
 const dir=out+row.id+'/';await fs.mkdir(new URL(dir,root),{recursive:true});
 const bytes=await fs.readFile(new URL('各门店图纸/'+row.file,root));
 const hash=createHash('sha256').update(bytes).digest('hex');
 const task=getDocument({data:new Uint8Array(bytes),verbosity:0,useSystemFonts:true});const pdf=await task.promise;
 const assets=[];
 for(const [role,n] of [['plan',plan],...renders.map(n=>['render',n])]){
  const page=await pdf.getPage(n),v=page.getViewport({scale:1}),vp=page.getViewport({scale:(role==='plan'?2600:1600)/v.width});
  const c=createCanvas(Math.ceil(vp.width),Math.ceil(vp.height));await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
  const full=role+'-p'+n+'-full.png';await fs.writeFile(new URL(dir+full,root),c.toBuffer('image/png'));
  const box=role==='plan'?(row.id==='PDF-079'?[.34,0,.34,1]:['PDF-293','PDF-296'].includes(row.id)?[0,0,1,1]:[0,0,.87,1]):[0,0,1,1];
  let file=full;
  if(role==='plan'){const [x,y,w,h]=box;const crop=createCanvas(Math.round(c.width*w),Math.round(c.height*h));crop.getContext('2d').drawImage(c,Math.round(x*c.width),Math.round(y*c.height),crop.width,crop.height,0,0,crop.width,crop.height);file='plan-p'+n+'-crop.png';await fs.writeFile(new URL(dir+file,root),crop.toBuffer('image/png'));}
  assets.push({role,page:n,file,fullPage:full,cropNormalized:box,fullWidth:c.width,fullHeight:c.height});page.cleanup();
 }
 await task.destroy();const source=stores.find(s=>s.id===row.id);
 const m={id:row.id,file:row.file,tag:row.tag,recordId:row.recordId,sourceUrl:source.sourceUrl,sourceSha256:hash,labelSource:'飞书总表；尚未逐店核对历史设计版本',reviewedAt:'2026-09-23',areaM2:area,areaSource:area===null?null:'图纸文字标注；非实测',observation,assets,trainingEligible:false,status:renders.length?'已视觉选页，待几何标注及版本核验':'仅平面；效果图待补充',limitations:['同一PDF内配对，不保证平面与效果图每个道具完全一致','尚无道具坐标、朝向与精确外轮廓标注','本地哈希用于追溯，不表示已与飞书附件内容比对']};
 await fs.writeFile(new URL(dir+'manifest.json',root),JSON.stringify(m,null,2));manifests.push(m);console.log(row.id+' exported');
}
await fs.writeFile(new URL(out+'manifest.json',root),JSON.stringify(manifests,null,2));
const ignored=stores.filter(s=>s.labelConflict).map(s=>({id:s.id,file:s.file,decision:'按用户要求忽略冲突，排除本批样本，不纠正原标签',date:'2026-09-23'}));
await fs.writeFile(new URL('素材库/01_catalog/classification/ignored-conflicts.json',root),JSON.stringify(ignored,null,2));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>影石布局规则库 · 首批图纸样本</title><style>body{font:16px/1.7 system-ui;margin:0;background:#f3f4f6;color:#18212c}header,main{max-width:1280px;margin:auto;padding:28px}h1{margin:0}article{background:white;border-radius:14px;padding:24px;margin:24px 0}small{color:#596574}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}img{width:100%;height:260px;object-fit:contain;background:#eee}a{color:#126181}select{padding:10px;font:inherit}@media(max-width:760px){.grid{grid-template-columns:1fr}}</style><header><h1>影石门店 · 首批布局样本</h1><p>12 家｜11 组平面与效果图配对＋1 家仅平面｜6 份冲突已排除</p><p>标签来自飞书总表；观察来自原始图纸。当前是参考样本库，尚非可训练数据集。</p><select id="filter"><option value="">全部类型</option>${[...new Set(manifests.map(m=>m.tag))].map(t=>`<option>${esc(t)}</option>`).join('')}</select></header><main>${manifests.map(m=>`<article data-tag="${esc(m.tag)}"><h2>${esc(m.file.replace('.pdf',''))}</h2><small>${esc(m.tag)} · ${m.areaM2===null?'面积待录入':m.areaM2+'㎡（图纸标注）'} · ${esc(m.status)}</small><p>${esc(m.observation)}</p><div class="grid">${m.assets.map(a=>`<div><a href="${m.id}/${a.file}"><img loading="lazy" src="${m.id}/${a.file}"></a><p>${a.role==='plan'?'平面':'效果图'} · PDF 第 ${a.page} 页 · <a href="${m.id}/${a.fullPage}">完整原页</a></p></div>`).join('')}</div><p><a href="${m.id}/manifest.json">来源与裁切记录</a> · <a href="${esc(m.sourceUrl)}">飞书记录</a> · <a href="../../../各门店图纸/${encodeURIComponent(m.file)}">原始 PDF</a></p></article>`).join('')}</main><script>document.querySelector('#filter').onchange=e=>document.querySelectorAll('article').forEach(a=>a.hidden=!!e.target.value&&a.dataset.tag!==e.target.value)</script></html>`;
await fs.writeFile(new URL(out+'index.html',root),html);
console.log(JSON.stringify({stores:manifests.length,plans:manifests.length,renders:manifests.reduce((n,m)=>n+m.assets.filter(a=>a.role==='render').length,0),ignored:ignored.length}));
