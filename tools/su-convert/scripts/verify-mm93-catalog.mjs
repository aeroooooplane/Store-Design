// Full workbench verification on an isolated database; --formal does read-only checks later.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { createDatabase } from '../../../database/src/index.ts'
import { loadConfig } from '../../../apps/api/src/config/env.ts'
import { buildApp } from '../../../apps/api/src/app.ts'
import { createServer } from '../../../apps/web/node_modules/vite/dist/node/index.js'
import { chromium } from '@playwright/test'

const [outArg, mode = 'isolated'] = process.argv.slice(2)
assert.ok(outArg && ['isolated','rehearsal','formal'].includes(mode), 'Usage: node verify-mm93-catalog.mjs output [isolated|rehearsal|formal]')
const out = path.resolve(outArg), repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const id = 'asset-90000607', site = mode === 'formal' ? 'http://127.0.0.1:5173' : 'http://127.0.0.1:5267'
const api = site + '/api/v1', sha = b => createHash('sha256').update(b).digest('hex')
const delta = JSON.parse(await readFile(path.join(out,'catalog-delta.json'),'utf8'))
let database, app, vite, browser
try {
  if (mode !== 'formal') {
    Object.assign(process.env,{ API_PORT:'3097',WEB_ORIGIN:site,DATABASE_URL:'pglite://'+out+'/isolated/db',
      RESOURCE_ROOT:out+'/isolated/resources',STORAGE_ROOT:out+'/isolated/files',ARCHIVE_ROOT:out+'/isolated/archive',
      LOG_LEVEL:'silent',NODE_ENV:'test',RATE_LIMIT_MAX:'10000' })
    const config=loadConfig();database=createDatabase(config.databaseUrl)
    app=await buildApp({config,db:database.db});await app.listen({port:3097,host:'127.0.0.1'})
    vite=await createServer({root:repo+'/apps/web',configFile:repo+'/apps/web/vite.config.ts',cacheDir:mode==='isolated'?out+'/isolated/vite-cache':repo+'/apps/web/node_modules/.vite',
      server:{port:5267,host:'127.0.0.1',strictPort:true,watch:null},logLevel:'error'})
    await vite.listen()
  }
  const response=await fetch(api+'/assets/'+id);assert.equal(response.status,200)
  const asset=await response.json()
  console.log(mode, 'catalogue and files ready')
  assert.equal(asset.name,'MM93 × Insta360 赛车');assert.equal(asset.function,'other')
  assert.equal(asset.category,'非标陈列');assert.ok(asset.placeable&&!asset.retired)
  assert.equal(asset.front,'+Z');assert.equal(asset.installation,'floor')
  assert.deepEqual(asset.footprint,{w:.798,d:2.1,h:1.119})
  const hashes={}
  for(const field of ['glb','whiteGlb','finishGlb','preview','productImage','planSymbol']){
    assert.ok(asset[field]);const r=await fetch(new URL(asset[field].url,site));assert.equal(r.status,200)
    hashes[field]=sha(Buffer.from(await r.arrayBuffer()));assert.equal(hashes[field],asset[field].sha256)
  }
  const web=path.join(out,'payload/04_模型库',delta.entry.web_model)
  const expected={glb:'model.glb',whiteGlb:'white.glb',finishGlb:'finish.glb'}
  for(const [field,file] of Object.entries(expected))assert.equal(hashes[field],sha(await readFile(path.join(web,file))))
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[],rows=[]
  page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message))
  if(mode!=='isolated'){
    await page.route('**/api/v1/**',r=>{if(['GET','HEAD'].includes(r.request().method()))return r.continue();writes.push(r.request().method());return r.abort()})
    await page.route('**/mm93-picker-review',r=>r.fulfill({contentType:'text/html',body:'<meta charset="utf-8"><link rel="stylesheet" href="/src/styles/tokens.css"><link rel="stylesheet" href="/src/styles/app.css"><link rel="stylesheet" href="/src/styles/workbench.css"><div id="picker" style="width:360px;margin:30px"></div>'}))
    await page.goto(site+'/mm93-picker-review')
    await page.evaluate(async()=>{
      const refresh=await import('/@react-refresh');(refresh.default??refresh).injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>x=>x;window.__vite_plugin_react_preamble_installed__=true
      const rm=await import('/node_modules/.vite/deps/react.js'),R=rm.default??rm,dom=await import('/node_modules/.vite/deps/react-dom_client.js')
      const {ModelPicker}=await import('/src/features/workbench/ModelPicker.tsx'),{items}=await(await fetch('/api/v1/assets')).json()
      const root=(dom.default??dom).createRoot(document.querySelector('#picker'))
      window.drawMM93=(si,market)=>{window.chosen=null;root.render(R.createElement(ModelPicker,{key:si+market,assets:items,siStyle:si,market,onPick:a=>window.chosen=a.id}))}
    })
  }
  async function post(route,body){assert.equal(mode,'isolated');const r=await fetch(api+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json()}
  for(const si of ['SI1.0','SI2.0'])for(const market of ['domestic','overseas']){
    console.log('checking',si,market)
    let project,plan
    const modelRequests=[];const record=r=>{if(['whiteGlb','finishGlb','glb'].some(k=>new URL(asset[k].url,site).pathname===new URL(r.url()).pathname))modelRequests.push(new URL(r.url()).pathname)}
    if(mode==='isolated'){
      project=await post('/projects',{name:'MM93 隔离验收 '+si+' '+market,shopType:'side_hall',market,siStyle:si})
      const {node:space}=await post('/projects/'+project.id+'/nodes',{kind:'space',parentId:null,name:'测试空间',space:{schemaVersion:1,boundary:[[0,0],[8,0],[8,6],[0,6]],height:3.2,obstacles:[],entrances:[{a:[8,6],b:[0,6],kind:'main'}]}})
      ;({node:plan}=await post('/projects/'+project.id+'/nodes',{kind:'plan',parentId:space.id,name:'测试方案',siStyle:si,layout:{schemaVersion:3,items:[],planning:null,fixtures:[]}}))
      await page.goto(site+'/projects/'+project.id+'?node='+plan.id)
      page.on('request',record)
      await page.evaluate(async()=>{
        const {WhiteScene}=await import('/src/features/viewer3d/white-scene.ts'),set=WhiteScene.prototype.setItems
        WhiteScene.prototype.setItems=function(...args){window.mm93Viewer=this;return set.apply(this,args)}
      })
      await page.getByRole('tab',{name:'模型',exact:true}).click()
      await page.getByRole('button',{name:'平面',exact:true}).click()
    }else await page.evaluate(([si,market])=>window.drawMM93(si,market),[si,market])
    await page.getByRole('searchbox',{name:'搜索模型'}).fill('MM93')
    const row=page.locator('h5[data-section=other]').locator('..').getByRole('button',{name:'添加 MM93 × Insta360 赛车',exact:true})
    await row.locator('img').evaluate(img=>img.decode());assert.ok((await row.locator('img').getAttribute('src')).includes('asset-90000607.webp'))
    assert.equal(await row.locator('img').evaluate(img=>img.style.background),'transparent')
    assert.ok((await row.textContent()).includes('798 × 2100 × 1119 mm'))
    await row.click()
    if(mode!=='isolated'){
      assert.equal(await page.evaluate(()=>window.chosen),id)
      await page.locator('#picker').screenshot({path:path.join(out,`${mode}-${si}-${market}-picker.png`),timeout:60000})
      // A real main-workbench renderer with a temporary in-memory scene: no project writes.
      const displayed=await page.evaluate(async({asset,si,market})=>{
        const {WhiteScene}=await import('/src/features/viewer3d/white-scene.ts')
        const canvas=document.createElement('canvas');canvas.style.cssText='position:absolute;left:420px;top:30px;width:1000px;height:720px';document.body.appendChild(canvas)
        const v=new WhiteScene(canvas);v.resize(1000,720)
        const space={schemaVersion:1,boundary:[[0,0],[8,0],[8,6],[0,6]],height:3.2,openEdges:[],obstacles:[],entrances:[{a:[8,6],b:[0,6],kind:'main'}]}
        const item={id:'formal-mm93',assetId:asset.id,name:asset.name,function:'other',cx:4,cz:3,rotation:0,...asset.footprint,placeholder:false,locked:false}
        const assets=new Map([[asset.id,asset]])
        try{
          v.setRoom(space,'side_hall',true);v.setLook('material',si);v.setItems([item],assets,market);await v.whenLoaded()
          const p=v.items.get(item.id);if(p.finishState!=='ready')throw Error('Formal material failed')
          let originalPbr
          p.finish.traverse(n=>{if(n.isMesh){const m=n.material;originalPbr={roughness:m.roughness,metalness:m.metalness,side:m.side,flatShading:m.flatShading,normalScale:m.normalScale.toArray(),maps:['map','normalMap','roughnessMap'].map(s=>m[s].image.width)}}})
          const pose={position:[7,2.4,6],target:[4,.5,3],fovDeg:40};v.showView(pose)
          const material=(await v.renderViews([pose],800,600,'material'))[0],white=(await v.renderViews([pose],800,600,'white'))[0]
          v.setLook('material',si);await v.whenLoaded();const texturesBefore=v.renderer.info.memory.textures
          v.setItems([1,3,5,7].map((cx,i)=>({...item,id:'formal-'+i,cx})),assets,market);await v.whenLoaded()
          const geometries=new Set(),textures=new Set();let meshes=0
          for(const p of v.items.values())p.finish?.traverse(n=>{if(n.isMesh){meshes++;geometries.add(n.geometry);for(const s of ['map','normalMap','roughnessMap'])textures.add(n.material[s])}})
          const overview={position:[9,5,10],target:[4,.5,3],fovDeg:45};v.showView(overview)
          const frame=()=>new Promise(r=>requestAnimationFrame(r)),times=[];let previous=performance.now()
          for(let i=0;i<60;i++){await frame();const now=performance.now();times.push(now-previous);previous=now;v.showView({...overview,position:[9+i*.008,5,10]})}
          const fps=1000/(times.reduce((a,b)=>a+b,0)/times.length)
          const sharing={meshes,geometries:geometries.size,textures:textures.size,texturesBefore,texturesAfter:v.renderer.info.memory.textures}
          return {originalPbr,material,white,sharing,fps,failed:[...v.failed]}
        }finally{v.dispose();canvas.remove()}
      },{asset,si,market})
      assert.deepEqual(displayed.originalPbr,{roughness:1,metalness:1,side:0,flatShading:false,normalScale:[1,-1],maps:[4096,4096,4096]})
      assert.deepEqual(displayed.failed,[]);assert.equal(displayed.sharing.meshes,4);assert.equal(displayed.sharing.geometries,1);assert.equal(displayed.sharing.textures,3)
      assert.equal(displayed.sharing.texturesBefore,displayed.sharing.texturesAfter)
      for(const look of ['material','white']){await writeFile(path.join(out,`formal-${si}-${market}-${look}.png`),Buffer.from(displayed[look].split(',')[1],'base64'));delete displayed[look]}
      rows.push({si,market,section:'其他',selected:true,thumbnail:true,dimensions:true,displayed})
      continue
    }
    const point=await page.locator('.view-main svg.plan').evaluate(svg=>{const p=new DOMPoint(4,3).matrixTransform(svg.getScreenCTM());return {x:p.x,y:p.y}})
    await page.mouse.click(point.x,point.y)
    await page.waitForFunction(()=>document.querySelector('.angle-input'))
    const angle=page.getByRole('spinbutton',{name:'旋转角度（度）',exact:true})
    await angle.fill('90');await angle.blur();await angle.fill('0');await angle.blur()
    await page.getByRole('button',{name:'三维',exact:true}).click()
    await page.waitForFunction(()=>window.mm93Viewer&&[...window.mm93Viewer.items.values()].some(p=>p.item.assetId==='asset-90000607'&&p.finishState==='ready'),undefined,{timeout:60000})
    const observed=await page.evaluate(async(si)=>{
      const v=window.mm93Viewer;await v.whenLoaded();const p=[...v.items.values()].find(p=>p.item.assetId==='asset-90000607')
      const T=await import('/node_modules/three/build/three.module.js');let state
      p.finish.traverse(n=>{if(n.isMesh){const m=n.material;state={roughness:m.roughness,metalness:m.metalness,flatShading:m.flatShading,side:m.side,normalScale:m.normalScale.toArray(),imageWidths:['map','normalMap','roughnessMap'].map(s=>m[s].image.width)}}})
      const box=new T.Box3().setFromObject(p.finish,true),size=box.getSize(new T.Vector3())
      v.setLook('white',si);await v.whenLoaded();v.setLook('material',si);await v.whenLoaded()
      const pose={position:[7,2.4,6],target:[4,.5,3],fovDeg:40};v.showView(pose)
      return {state,bounds:{w:size.x,d:size.z,h:size.y},rotation:p.item.rotation,finishPrepared:p.finishPrepared}
    },si)
    assert.equal(observed.rotation,0);assert.ok(observed.finishPrepared)
    assert.deepEqual(observed.state,{roughness:1,metalness:1,flatShading:false,side:0,normalScale:[1,-1],imageWidths:[4096,4096,4096]})
    for(const k of ['w','d','h'])assert.ok(Math.abs(observed.bounds[k]-asset.footprint[k])<.001)
    if(si==='SI1.0'&&market==='domestic'){
      const exports=await page.evaluate(async()=>{const v=window.mm93Viewer,pose=v.currentView();return {material:(await v.renderViews([pose],800,600,'material'))[0],white:(await v.renderViews([pose],800,600,'white'))[0]}})
      for(const [look,data] of Object.entries(exports))await writeFile(path.join(out,`catalog-${look}-export.png`),Buffer.from(data.split(',')[1],'base64'))
    }
    await page.screenshot({path:path.join(out,`isolated-${si}-${market}-material.png`)})
    let persisted=false
    for(let attempt=0;attempt<40;attempt++){
      const {drafts}=await(await fetch(api+'/projects/'+project.id+'/drafts')).json()
      if(drafts.some(d=>d.layout?.items?.some(i=>i.assetId===id&&i.rotation===0))){persisted=true;break}
      await page.waitForTimeout(150)
    }
    assert.ok(persisted,'Placed model and restored rotation must be autosaved')
    const sourcePath=new URL(asset.glb.url,site).pathname;assert.ok(!modelRequests.includes(sourcePath),'Full source GLB must not be loaded')
    for(const field of ['whiteGlb','finishGlb'])assert.equal(modelRequests.filter(p=>p===new URL(asset[field].url,site).pathname).length,1)
    page.off('request',record)
    rows.push({si,market,section:'其他',placementSaved:true,rotation:true,observed,modelRequests})
  }
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[])
  await writeFile(path.join(out,`${mode}-catalog-validation.json`),JSON.stringify({id,asset,hashes,rows,errors,writes,formal:mode==='formal'},null,2)+'\n')
  console.log(JSON.stringify({mode,scenarios:rows.length,errors,writes,passed:true}))
}finally{await browser?.close();await vite?.close();await app?.close();await database?.close()}
