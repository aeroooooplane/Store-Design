// Verifies actual original bytes and rendered material state, not just the viewer's labels.
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {chromium} from '@playwright/test'

const [sourceArg,viewerArg,outArg]=process.argv.slice(2)
if(!sourceArg||!viewerArg||!outArg)throw Error('Usage: node verify-mm93-original.mjs original.glb viewer.html output-directory')
const source=await readFile(sourceArg),html=await readFile(viewerArg,'utf8'),out=path.resolve(outArg)
const sha256=createHash('sha256').update(source).digest('hex')
if(sha256!=='46ed38fb4e5a774e91e10264b20874a4c0a8584e655b5c680792c9b9e8700fef')throw Error('Unexpected source')
const match=html.match(/data:model\/gltf-binary;base64,([A-Za-z0-9+/=]+)/)
if(!match||!Buffer.from(match[1],'base64').equals(source))throw Error('Embedded model differs from the original')
await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
try{
 const page=await browser.newPage({viewport:{width:1280,height:960}}),errors=[],external=[]
 page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:/,route=>{external.push(route.request().url());return route.abort()})
 await page.goto(pathToFileURL(path.resolve(viewerArg)).href,{timeout:60000});await page.waitForFunction(()=>window.__mm93,{timeout:60000})
 const observed=await page.evaluate(()=>{const r={dimensions:window.__mm93.dimensions,meshes:0,triangles:0,vertices:0,materials:[]};window.__mm93.model.traverse(o=>{if(!o.isMesh)return;r.meshes++;r.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;r.vertices+=o.geometry.attributes.position.count;const m=o.material;r.materials.push({roughness:m.roughness,metalness:m.metalness,normalScale:m.normalScale.toArray(),maps:['map','normalMap','roughnessMap','metalnessMap'].map(slot=>({slot,w:m[slot]?.image.width,h:m[slot]?.image.height,colorSpace:m[slot]?.colorSpace}))})});return r})
 if(observed.meshes!==1||observed.triangles!==501846||observed.vertices!==284680)throw Error('Original geometry changed')
 // GLTFLoader flips normalScale.y for derivative tangents when the original has no TANGENT attribute.
 for(const m of observed.materials)if(m.roughness!==1||m.metalness!==1||m.normalScale[0]!==1||m.normalScale[1]!==-1||m.maps.some(t=>t.w!==4096||t.h!==4096))throw Error('Original material state changed')
 for(const label of ['整体','车头','侧面','车尾']){await page.getByRole('button',{name:label,exact:true}).click();await page.waitForTimeout(200);await page.screenshot({path:path.join(out,'原版-'+label+'.png')})}
 await page.getByRole('button',{name:'整体',exact:true}).click();const b=await page.locator('canvas').boundingBox();await page.mouse.move(b.x+b.width*.5,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width*.65,b.y+b.height*.55,{steps:10});await page.mouse.up();await page.mouse.wheel(0,-150);await page.waitForTimeout(200)
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}))
 const report={passed:true,sourceSha256:sha256,sourceBytes:source.length,embeddedBytesEqual:true,...observed,errors,external,checks:['原始GLB逐字节比较','4K贴图及原PBR值','完整网格与顶点数','四个视角','拖转与缩放','离线本地文件']}
 await writeFile(path.join(out,'original-validation.json'),JSON.stringify(report,null,2),{flag:'wx'})
 console.log('PASS original bytes, 4K maps, PBR, geometry and offline interaction')
}finally{await browser.close()}
