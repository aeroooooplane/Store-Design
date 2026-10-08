import fs from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {chromium} from '../../demo/node_modules/@playwright/test/index.mjs';
const version=process.argv[2];if(!/^s03-v[2-9][0-9]*$/.test(version||''))throw Error('Pass a new version, e.g. s03-v2; v1 is frozen');
const out=new URL(`../../素材库/05_render_benchmark/${version}/`,import.meta.url);
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
try{const page=await browser.newPage();await page.goto('http://127.0.0.1:5179/');const result=await page.evaluate(async()=>{
 const {realSample}=await import('/src/sample.js'),{createScene}=await import('/src/scene.js'),{issues}=await import('/src/layout.js');const renders=[];let geometry;
 for(const style of ['white','SI1.0','SI2.0']){const scene=createScene(document.createElement('canvas'),realSample,style);geometry=scene.furnitureGeometry;for(const view of [0,2]){scene.view(view);renders.push({style,view,data:scene.image()})}scene.dispose()}
 return {layout:realSample,issues:issues(realSample),renders,geometry};
});if(result.issues.length)throw Error(result.issues.join(';'));
await fs.mkdir(out);
await fs.writeFile(new URL('geometry.json',out),JSON.stringify(result.geometry,null,2));
const raw=JSON.stringify(result.layout,null,2);await fs.writeFile(new URL('layout.json',out),raw);
const manifest={case:version,scope:'geometry preservation pilot, not validated reconstruction',source:result.layout.source,layoutSha256:createHash('sha256').update(raw).digest('hex'),objects:result.layout.items.map(({id,name,type,profile,x,z,w,d,h})=>({id,name,type,profile,x,z,w,d,h})),cameraViews:[{index:0,name:'front elevated',relative:[.5,1.15,1.8]},{index:2,name:'right-front elevated',relative:[1.7,1,1.4]}],baselineRenderer:'demo/src/scene.js',aiStatus:'not-started',assets:[]};
for(const r of result.renders){const name=r.style+'-view'+r.view+'.png';await fs.writeFile(new URL(name,out),Buffer.from(r.data.split(',')[1],'base64'));manifest.assets.push({kind:'baseline',style:r.style,view:r.view,file:name,sha256:createHash('sha256').update(Buffer.from(r.data.split(',')[1],'base64')).digest('hex')})}
await fs.writeFile(new URL('manifest.json',out),JSON.stringify(manifest,null,2));console.log(JSON.stringify({output:fileURLToPath(out),images:result.renders.length,objects:manifest.objects.length,geometryIssues:result.issues}));
}finally{await browser.close()}
