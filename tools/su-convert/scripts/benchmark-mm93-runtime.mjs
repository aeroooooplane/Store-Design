// Runs the actual workbench scene against isolated files, with no database or catalogue writes.
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const [runtimeArg, originalArg, reportArg] = process.argv.slice(2)
if (!runtimeArg || !originalArg || !reportArg) throw Error('Usage: node benchmark-mm93-runtime.mjs runtime-dir original.glb NEW-report-dir')
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const runtime = path.resolve(runtimeArg), original = path.resolve(originalArg), out = path.resolve(reportArg)
await mkdir(out, { recursive: false })
const files = new Map(['white', 'finish', 'model'].map((n) => [`/mm93-assets/${n}.glb`, path.join(runtime, `${n}.glb`)]))
files.set('/mm93-assets/original.glb', original)
const library = path.join(repo, '资源库/04_模型库')
const manifest = JSON.parse((await readFile(path.join(library, 'manifest.json'), 'utf8')).replace(/^\uFEFF/, ''))
const x6 = manifest.assets.find(a => a.asset_id === 'asset-90000606')
assert.ok(x6?.web_model, 'Connected X6 catalogue resource required for compatibility check')
files.set('/mm93-assets/x6-finish.glb', path.join(library, x6.web_model, 'finish.glb'))
files.set('/mm93-assets/x6-white.glb', path.join(library, x6.web_model, 'white.glb'))
const harness = `
import {WhiteScene} from '/src/features/viewer3d/white-scene.ts';
import {rectangleSpace} from '@store/shared';
const scene=new WhiteScene(document.querySelector('canvas'));
const calls=[];let phase='setup';const gl=scene.renderer.getContext();
for(const method of ['texImage2D','texSubImage2D','generateMipmap']){const original=gl[method].bind(gl);gl[method]=(...args)=>{const start=performance.now();const result=original(...args);const duration=performance.now()-start;if(duration>1)calls.push({method,duration,phase});return result;};}
const render=scene.renderer.render.bind(scene.renderer);scene.renderer.render=(...args)=>{const start=performance.now();const result=render(...args);const duration=performance.now()-start;if(duration>10)calls.push({method:'render',duration,phase});return result;};
scene.resize(1000,720);scene.setRoom(rectangleSpace(4,3,3),'side_hall',true);scene.setLook('white','SI2.0');
const assets=new Map([['asset-90000993',{id:'asset-90000993',name:'MM93性能测试',front:'-X',
 footprint:{w:1,d:.37982177734375,h:.532989501953125},
 glb:{url:'/mm93-assets/original.glb'},
 ...(location.search.includes('prepared')?{whiteGlb:{url:'/mm93-assets/white.glb'},finishGlb:{url:'/mm93-assets/finish.glb'}}:{})}]]);
const item=(i)=>({id:'bike-'+i,assetId:'asset-90000993',function:'other',name:'MM93',cx:1.4+(i%2)*1.3,cz:1+Math.floor(i/2)*.85,w:1,d:.37982177734375,h:.532989501953125,rotation:0,placeholder:false,locked:false});
let status;scene.onStatus(s=>status=s);
const longTasks=[];const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask',buffered:true});
const frame=()=>new Promise(r=>requestAnimationFrame(r));
const settle=async()=>{await scene.whenLoaded();await frame();await frame();await new Promise(r=>setTimeout(r,0));};
const measure=async(action)=>{const start=performance.now();await action();await settle();return {elapsedMs:performance.now()-start,longTasks:longTasks.filter(t=>t.start>=start),status};};
const sharing=()=>{const geometry=new Set(),textures=new Set(),materials=new Set();let meshes=0;for(const placed of scene.items.values())placed.finish?.traverse(n=>{if(!n.isMesh)return;meshes++;geometry.add(n.geometry);for(const m of Array.isArray(n.material)?n.material:[n.material]){materials.add(m);for(const s of ['map','normalMap','roughnessMap','metalnessMap'])if(m[s])textures.add(m[s]);}});return {meshes,geometries:geometry.size,textures:textures.size,materials:materials.size,gpuTextures:scene.renderer.info.memory.textures};};
const materialState=()=>{let result;for(const p of scene.items.values())p.finish?.traverse(n=>{if(n.isMesh){const m=n.material;result={roughness:m.roughness,metalness:m.metalness,side:m.side,flatShading:m.flatShading,normalScale:m.normalScale?.toArray(),maps:['map','normalMap','roughnessMap'].map(k=>({w:m[k]?.image?.width,h:m[k]?.image?.height}))};}});return result;};
window.bench={scene,settle,sharing,materialState,calls,async phase(kind,count=1){phase=kind;return measure(async()=>{if(kind==='material')scene.setLook('material','SI2.0');else scene.setItems(Array.from({length:count},(_,i)=>item(i)),assets);});},async orbit(frames=90){phase='orbit';const times=[];let prev=performance.now();for(let i=0;i<frames;i++){await frame();const now=performance.now();times.push(now-prev);prev=now;const angle=.4+i*.006;scene.showView({position:[1.4-Math.cos(angle)*2.3,1.45,1+Math.sin(angle)*2.3],target:[1.4,.3,1],fovDeg:40});}await frame();const sorted=[...times.slice(3)].sort((a,b)=>a-b);return {frames:times.length,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:Math.max(...times),approxFps:1000/(times.reduce((a,b)=>a+b,0)/times.length)};},gpu(){const gl=scene.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),parallelShaders:!!gl.getExtension('KHR_parallel_shader_compile')};}};
await settle();await new Promise(r=>setTimeout(r,300));window.ready=true;
window.bench.placement=async()=>{scene.setLook('material','SI2.0');const asset=assets.get('asset-90000993');const started=performance.now();scene.preparePlacement(asset,'domestic');await scene.finished(asset.finishGlb.url,true);const selectionMs=performance.now()-started;const placement=await measure(async()=>scene.setItems([item(0)],assets));const requestsBeforeWhite=performance.getEntriesByType('resource').filter(r=>r.name.includes('/mm93-assets/')).map(r=>r.name.split('/').at(-1));scene.showView({position:[-.6,1.45,3],target:[1.4,.3,1],fovDeg:40});const materialPng=(await scene.renderViews([scene.currentView()],800,600,'material'))[0];scene.setLook('white','SI2.0');await settle();const whitePng=(await scene.renderViews([scene.currentView()],800,600,'white'))[0];scene.setLook('material','SI2.0');await settle();return {selectionMs,placement,requestsBeforeWhite,materialPng,whitePng};};
window.bench.restore=async()=>{scene.showView({position:[-.6,1.45,3],target:[1.4,.3,1],fovDeg:40});await settle();const pixel=()=>{const gl=scene.renderer.getContext(),p=new Uint8Array(4);gl.readPixels(850,70,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];};const before=pixel(),ext=scene.renderer.getContext().getExtension('WEBGL_lose_context');if(!ext)throw Error('Context-loss extension unavailable');const restored=new Promise(r=>scene.canvas.addEventListener('webglcontextrestored',r,{once:true}));ext.loseContext();await new Promise(r=>setTimeout(r,120));ext.restoreContext();await restored;await settle();return {before,after:pixel()};};
window.bench.x6=async()=>{scene.setItems([],assets);const asset={id:'asset-90000606',name:'X6',front:'+Z',footprint:{w:.664,d:.432,h:1.501},whiteGlb:{url:'/mm93-assets/x6-white.glb'},finishGlb:{url:'/mm93-assets/x6-finish.glb'}};const map=new Map([[asset.id,asset]]);const started=performance.now();scene.preparePlacement(asset,'domestic');await scene.finished(asset.finishGlb.url,true);const selectionMs=performance.now()-started;const placed=await measure(async()=>scene.setItems([{...item(0),assetId:asset.id,...asset.footprint}],map));return {selectionMs,placed};};
`
const server = await createServer({ configFile: false, root: path.join(repo, 'apps/web'), logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: ['three', 'zod'] },
  server: { host: '127.0.0.1', port: 5268, strictPort: true, fs: { allow: [repo] } },
  plugins: [{ name: 'mm93-isolated-performance',
    resolveId(id) { if (id === '/mm93-harness.ts') return '\0mm93-harness' },
    load(id) { if (id === '\0mm93-harness') return harness },
    configureServer(s) { s.middlewares.use((req, res, next) => {
      const file = files.get(req.url?.split('?')[0])
      if (file) { res.setHeader('Content-Type', 'model/gltf-binary'); res.setHeader('Cache-Control', 'no-store'); createReadStream(file).pipe(res); return }
      if (req.url?.startsWith('/mm93-performance')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html><head><title>MM93 独立工作台性能验证</title></head><body style="margin:0;background:white"><canvas style="width:1000px;height:720px"></canvas><script type="module" src="/mm93-harness.ts"></script></body></html>'); return }
      next()
    }) },
  }],
})
let browser
try {
  await server.listen()
  console.log('isolated server ready')
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const results = []
  // Baseline and candidate each use a fresh page/cache. No simultaneous GPU/test load.
  for (const mode of ['raw', 'prepared']) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 720 } })
    const errors = [], requests = [], forbidden = []
    page.on('pageerror', e => { errors.push(e.message); console.log('page error:', e.message) })
    page.on('console', m => { if (m.type() === 'error') console.log('browser error:', m.text()) })
    page.on('request', r => { if (r.url().includes('/mm93-assets/')) requests.push(r.url().split('/').at(-1)) })
    await page.route('**/*', route => {
      const url = route.request().url()
      if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:5268/')) { forbidden.push(url); return route.abort() }
      return route.continue()
    })
    console.log('opening', mode)
    await page.goto(`http://127.0.0.1:5268/mm93-performance?${mode}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    try { await page.waitForFunction(() => window.ready, undefined, { timeout: 60000 }) }
    catch (e) { await writeFile(path.join(out, `${mode}-startup-error.json`), JSON.stringify({ errors, forbidden, html: await page.content() },null,2)); throw e }
    console.log(mode, 'scene ready')
    const white = await page.evaluate(() => window.bench.phase('white'))
    console.log(mode, 'white', white.elapsedMs)
    const whiteRequests = [...requests]
    const material = await page.evaluate(() => window.bench.phase('material'))
    console.log(mode, 'material', material.elapsedMs)
    await page.evaluate(() => window.bench.scene.showView({ position: [-.6,1.45,3], target: [1.4,.3,1], fovDeg: 40 }))
    await page.screenshot({ path: path.join(out, `${mode}-material.png`) })
    const single = await page.evaluate(() => ({ sharing: window.bench.sharing(), material: window.bench.materialState(), gpu: window.bench.gpu() }))
    const orbitSingle = await page.evaluate(() => window.bench.orbit())
    const repeated = await page.evaluate(() => window.bench.phase('repeat', 4))
    const multiple = await page.evaluate(() => window.bench.sharing())
    const orbitFour = await page.evaluate(() => window.bench.orbit())
    const remove = await page.evaluate(() => window.bench.phase('remove', 0))
    const readd = await page.evaluate(() => window.bench.phase('repeat', 1))
    assert.deepEqual(errors, [])
    assert.deepEqual(forbidden, [])
    assert.deepEqual(white.status.failed, [])
    if (mode.startsWith('prepared')) {
      assert.deepEqual(whiteRequests, ['white.glb'])
      assert.deepEqual(requests, ['white.glb', 'finish.glb'])
      assert.equal(single.material.flatShading, false)
      assert.equal(single.material.roughness, 1)
      assert.equal(single.material.metalness, 1)
      assert.deepEqual(single.material.normalScale, [1,-1])
      assert.ok(single.material.maps.every(m => m.w === 4096 && m.h === 4096))
      assert.equal(multiple.meshes, 4)
      assert.equal(multiple.geometries, 1)
      assert.equal(multiple.textures, single.sharing.textures)
      assert.equal(multiple.gpuTextures, single.sharing.gpuTextures)
    }
    const calls = await page.evaluate(() => window.bench.calls)
    results.push({ mode, white, material, repeated, remove, readd, single, multiple, orbitSingle, orbitFour, whiteRequests, requests, errors, forbidden, calls })
    await page.close()
  }
  const placementPage = await browser.newPage({ viewport: { width: 1000, height: 720 } })
  const placementErrors = [], placementRequests = []
  placementPage.on('pageerror', e => placementErrors.push(e.message))
  placementPage.on('request', r => { if (r.url().includes('/mm93-assets/')) placementRequests.push(r.url().split('/').at(-1)) })
  await placementPage.goto('http://127.0.0.1:5268/mm93-performance?prepared', { waitUntil: 'domcontentloaded' })
  await placementPage.waitForFunction(() => window.ready, undefined, { timeout: 60000 })
  const placement = await placementPage.evaluate(() => window.bench.placement())
  assert.deepEqual(placement.requestsBeforeWhite, ['finish.glb'])
  assert.deepEqual(placementRequests, ['finish.glb', 'white.glb'])
  for (const kind of ['material', 'white']) {
    const png = placement[`${kind}Png`]
    assert.ok(png.startsWith('data:image/png;base64,'))
    await writeFile(path.join(out, `${kind}-export.png`), Buffer.from(png.split(',')[1], 'base64'), { flag: 'wx' })
    delete placement[`${kind}Png`]
  }
  const x6Compatibility = await placementPage.evaluate(() => window.bench.x6())
  assert.deepEqual(x6Compatibility.placed.status.failed, [])
  assert.deepEqual(placementErrors, [])
  await placementPage.screenshot({ path: path.join(out, 'x6-compatibility.png') })
  const restored = await placementPage.evaluate(() => window.bench.restore())
  assert.ok(restored.before.slice(0,3).every(v => v > 60))
  assert.ok(restored.after.every((v,i) => Math.abs(v-restored.before[i]) <= 5))
  await placementPage.screenshot({ path: path.join(out, 'restored-floor.png') })
  await placementPage.close()
  await writeFile(path.join(out, 'browser-performance.json'), JSON.stringify({ passed: true, viewport: [1000,720], results, placement, restored, x6Compatibility, placementErrors, placementRequests }, null, 2), { flag: 'wx' })
  console.log(JSON.stringify(results.map(r => ({ mode:r.mode, whiteMs:r.white.elapsedMs, materialMs:r.material.elapsedMs, repeatedMs:r.repeated.elapsedMs, singleFps:r.orbitSingle.approxFps, fourFps:r.orbitFour.approxFps, gpu:r.single.gpu }))))
} finally { await browser?.close(); await server.close() }
