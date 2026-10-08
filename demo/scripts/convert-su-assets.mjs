// Local-only conversion. Originals remain untouched; existing outputs are never overwritten.
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'

const demo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=path.dirname(demo)
const source=path.join(repo,'素材库/04_assets/incoming/split-20260925-v2')
const manifest=JSON.parse(await readFile(path.join(source,'manifest.json'),'utf8'))
const validation=JSON.parse(await readFile(path.join(source,'validation-summary.json'),'utf8'))
const ids=process.argv.slice(2)
if(!ids.length)throw Error('Pass explicit asset IDs; no automatic whole-library conversion.')
const server=await createServer({root:demo,server:{host:'127.0.0.1',port:5183,strictPort:true,fs:{allow:[repo]}}})
let browser
try{
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage()
  await page.goto('http://127.0.0.1:5183/')
  for(const id of ids){
    const entry=manifest.assets.find(a=>a.asset_id===id),check=validation.results.find(a=>a.asset_id===id)
    if(entry?.status!=='passed'||check?.status!=='passed')throw Error('Unverified asset: '+id)
    const dae=path.join(source,entry.folder,'prop.dae'),raw=await readFile(dae)
    const [w,d,h]=check.source_tight_face_bounds_m
    const result=await page.evaluate(async({url,expected})=>{
      const {LoadingManager}=await import('/node_modules/three/build/three.module.js')
      const {ColladaLoader}=await import('/node_modules/three/examples/jsm/loaders/ColladaLoader.js')
      const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js')
      const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js')
      const {normalizeAssetScene,meshBounds}=await import('/src/asset-normalization.js')
      const failures=[],warnings=[],originalWarn=console.warn
      console.warn=(...args)=>{warnings.push(args.map(String).join(' '));originalWarn(...args)}
      try{
        const manager=new LoadingManager()
        const loaded=new Promise(resolve=>{manager.onLoad=resolve})
        manager.onError=url=>failures.push(url)
        const dae=await new ColladaLoader(manager).loadAsync(url)
        await loaded
        if(failures.length)throw Error('Missing source resources: '+failures.join(', '))
        const {scene,dimensions}=normalizeAssetScene(dae.scene,expected)
        const buffer=await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true})
        const reloaded=await new GLTFLoader().parseAsync(buffer,'')
        const bounds=meshBounds(reloaded.scene)
        const sizes={w:bounds.max.x-bounds.min.x,h:bounds.max.y-bounds.min.y,d:bounds.max.z-bounds.min.z}
        if(Object.keys(sizes).some(k=>Math.abs(sizes[k]-expected[k])>.001))throw Error('GLB reload dimensions mismatch')
        if(Math.abs(bounds.min.y)>.001||Math.abs(bounds.max.x+bounds.min.x)>.002||Math.abs(bounds.max.z+bounds.min.z)>.002)throw Error('GLB origin mismatch')
        const bytes=new Uint8Array(buffer);let binary=''
        for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768))
        return {base64:btoa(binary),dimensions,reloadedDimensions:sizes,warnings:[...new Set(warnings)]}
      }finally{console.warn=originalWarn}
    },{url:'/@fs/'+dae.replaceAll('\\','/'),expected:{w,d,h}})
    const output=path.join(demo,'public/assets/su',id)
    await mkdir(output,{recursive:true})
    const glb=Buffer.from(result.base64,'base64')
    await writeFile(path.join(output,'model.glb'),glb,{flag:'wx'})
    const report={id,name:entry.category+' · '+id,category:entry.category,siVersion:null,facing:null,
      url:`/assets/su/${id}/model.glb`,unit:'m',upAxis:'Y',origin:'bottom-center',dimensions:result.reloadedDimensions,
      source:path.relative(repo,dae).replaceAll('\\','/'),sourceSha256:createHash('sha256').update(raw).digest('hex'),
      glbSha256:createHash('sha256').update(glb).digest('hex'),bytes:glb.length,expectedDimensions:{w,d,h},
      warnings:result.warnings,status:'converted-dimensions-checked-visual-review-pending',convertedAt:new Date().toISOString()}
    await writeFile(path.join(output,'conversion.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'})
    console.log(JSON.stringify({id,bytes:glb.length,dimensions:report.dimensions,warnings:report.warnings}))
  }
}finally{await browser?.close();await server.close()}
