import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
const dir=new URL('../../素材库/05_render_benchmark/s03-v1/',import.meta.url);const path=new URL('manifest.json',dir),m=JSON.parse(await fs.readFile(path,'utf8'));
m.aiStatus='four-images-generated-and-visually-reviewed';m.geometryAcceptance='not-approved';m.imageTool='built-in imagegen';m.callLatencySeconds=null;m.billedCost=null;m.reviewMethod='assistant visual inspection, pending designer review';m.assets=m.assets.filter(a=>a.kind==='baseline');
for(const style of ['SI1.0','SI2.0'])for(const view of [0,2])m.assets.push({kind:'ai-concept',style,view,file:`AI-${style}-view${view}.png`,geometryApproved:false});
try{await fs.access(new URL('AI-SI1.0-view2-retry.png',dir));m.assets.push({kind:'ai-correction-trial',style:'SI1.0',view:2,file:'AI-SI1.0-view2-retry.png',geometryApproved:false})}catch{}
for(const a of m.assets)a.sha256=createHash('sha256').update(await fs.readFile(new URL(a.file,dir))).digest('hex');
await fs.writeFile(path,JSON.stringify(m,null,2));console.log(`${m.assets.length} images indexed, geometry not approved`);
