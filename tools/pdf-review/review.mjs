import fs from 'node:fs/promises';
import path from 'node:path';
import {createCanvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
const root=path.resolve('../..');
const files=['佛山创意产业园授权专卖店.pdf','上海万象城授权体验店（边厅）.pdf','上海星光摄影城照材专卖店.pdf','上海七宝领展授权体验店.pdf'];
const results=[];
for(let i=0;i<files.length;i++){
 const file=files[i],out=path.join(root,'素材库/02_previews',`S0${i+1}`);await fs.mkdir(out,{recursive:true});
 const task=getDocument({data:new Uint8Array(await fs.readFile(path.join(root,'各门店图纸',file))),useSystemFonts:true});
 const doc=await task.promise;
 const pages=[];const thumbs=[];
 for(let p=1;p<=doc.numPages;p++){
  const page=await doc.getPage(p);const text=(await page.getTextContent()).items.map(x=>x.str).join(' ');pages.push({page:p,text});
  const v=page.getViewport({scale:1});const viewport=page.getViewport({scale:500/v.width});const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
  await fs.writeFile(path.join(out,`page-${p}.png`),canvas.toBuffer('image/png'));thumbs.push(canvas);page.cleanup();
 }
 const cellH=Math.max(...thumbs.map(c=>c.height))+30;const sheet=createCanvas(1000,cellH*Math.ceil(thumbs.length/2));const ctx=sheet.getContext('2d');ctx.fillStyle='#eeeeee';ctx.fillRect(0,0,sheet.width,sheet.height);ctx.font='16px sans-serif';
 thumbs.forEach((c,j)=>{const x=(j%2)*500,y=Math.floor(j/2)*cellH;ctx.drawImage(c,x,y+25);ctx.fillStyle='#111';ctx.fillText(`S0${i+1} / page ${j+1}`,x+10,y+19)});
 await fs.writeFile(path.join(out,'contact.png'),sheet.toBuffer('image/png'));await fs.writeFile(path.join(out,'pages.json'),JSON.stringify(pages,null,2));results.push({id:`S0${i+1}`,file,pages:doc.numPages,textPages:pages.filter(p=>p.text.length>40).length});await task.destroy();console.log(JSON.stringify(results.at(-1)));
}
await fs.writeFile(path.join(root,'素材库/01_catalog/review-summary.json'),JSON.stringify(results,null,2));

