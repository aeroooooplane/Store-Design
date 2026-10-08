import {sourcePdfRoot,sourcePdfPath} from '../resource-library/paths.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';
const root=path.resolve('../..'),out=path.join(root,'资源库/00_资源索引/历史目录/classification'),cache=path.join(out,'page-index');await fs.mkdir(cache,{recursive:true});
const existing=JSON.parse(await fs.readFile(path.join(root,'资源库/00_资源索引/门店资源索引.json'),'utf8'));const stableIds=new Map(existing.sources.map(r=>[r.source_file,r.source_id]));
const files=(await fs.readdir(sourcePdfRoot())).filter(f=>f.toLowerCase().endsWith('.pdf')).sort();const rows=[];
let next=0;async function worker(){while(next<files.length){const i=next++,file=files[i];
 const id=stableIds.get(file),name=file.slice(0,-4),rel=`各门店图纸/${file}`,stat=await fs.stat(sourcePdfPath(file)),cp=path.join(cache,file+'.json');let index,error;if(!id)throw Error("新文件需要先分配稳定来源编号: "+file);
 try{index=JSON.parse(await fs.readFile(cp,'utf8'))}catch{
  const result=await new Promise(resolve=>{const p=spawn(process.execPath,['classify-worker.mjs',sourcePdfPath(file),cp],{windowsHide:true,stdio:'ignore'});const t=setTimeout(()=>{p.kill();resolve('timeout')},90000);p.on('exit',code=>{clearTimeout(t);resolve(code)});p.on('error',e=>{clearTimeout(t);resolve(e.message)})});
  if(result===0)try{index=JSON.parse(await fs.readFile(cp,'utf8'))}catch(e){error=e.message}else error=String(result);
 }
 let typeHint=/边厅改中岛/.test(name)?'中岛店':/中岛/.test(name)?'中岛店':/边厅/.test(name)?'边厅店':null;
 const row={id,file,path:rel,sizeMB:+(stat.size/1048576).toFixed(2),si:null,shopType:null,combinedTag:null,siSource:null,typeSource:null,status:'待总表匹配',filenameTypeHint:typeHint,filenameEvidence:typeHint?name:null,recordId:null,sourceUrl:'https://arashivision.feishu.cn/wiki/Ynt0wThwNiaX8Dk0Gm2c2XlJnsc?table=tbl394Uo6M3FuGaN&view=vewd4CdQN9',pageCount:index?.pageCount??null,planPages:index?.pages.filter(p=>p.kinds.includes('平面候选')).map(p=>p.page)||[],constructionPages:index?.pages.filter(p=>p.kinds.includes('施工候选')).map(p=>p.page)||[],imagePages:index?.pages.filter(p=>p.kinds.includes('图像页待视觉核验')).map(p=>p.page)||[],scanError:error||null};rows.push(row);
 console.log(`${rows.length}/${files.length} ${file} pages=${row.pageCount} ${error||''}`);
}}
await Promise.all(Array.from({length:6},()=>worker()));rows.sort((a,b)=>a.id.localeCompare(b.id));await fs.writeFile(path.join(out,'stores.json'),JSON.stringify(rows,null,2));
const summary={files:rows.length,totalPages:rows.reduce((a,r)=>a+(r.pageCount||0),0),scanErrors:rows.filter(r=>r.scanError).length,filenameIsland:rows.filter(r=>r.filenameTypeHint==='中岛店').length,filenameSide:rows.filter(r=>r.filenameTypeHint==='边厅店').length,confirmedLabels:0,generatedAt:new Date().toISOString()};await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(summary);
