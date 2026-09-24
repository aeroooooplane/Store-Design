import fs from 'node:fs/promises';import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
const [file,out]=process.argv.slice(2);const task=getDocument({data:new Uint8Array(await fs.readFile(file)),verbosity:0,useSystemFonts:true});const doc=await task.promise;const pages=[];
for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n);const text=(await page.getTextContent()).items.map(x=>x.str).join(' ');let kinds=[];
 if(/家具定位图|平面布置图|原始结构图|原始平面图|FURNISHING PLAN/i.test(text)) kinds.push('平面候选');
 if(/立面图|天花|节点图|配电|铺装|施工说明|物料表|大样图/.test(text))kinds.push('施工候选');
 if(/效果图|效果展示|RENDERING/i.test(text))kinds.push('效果候选');
 if(/图纸目录|图 纸 目 录/.test(text))kinds=['目录'];
 if(text.replace(/\s/g,'').length<40)kinds.push('图像页待视觉核验');
 pages.push({page:n,kinds,text});page.cleanup();
}
await fs.writeFile(out,JSON.stringify({pageCount:doc.numPages,pages}));await task.destroy();
