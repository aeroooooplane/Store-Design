// Renders converted GLBs from five directions into one contact sheet per asset, for the human
// review of facing direction and materials (dimensions and origin are already checked on export).
// Usage: node scripts/render-glb-review.mjs <outputDir> [asset-id ...]   (no ids = every converted asset)
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {readLibrary} from '../server/model-library-paths.mjs'

const demo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=path.dirname(demo)
const library=await readLibrary(repo),webModels=library.webModels
const [outputArg,...requested]=process.argv.slice(2)
if(!outputArg)throw Error('Pass an output directory.')
const output=path.resolve(repo,outputArg)
const ids=requested.length?requested:[...webModels.keys()].sort()
const named=library.manifest
const nameOf=new Map(named.assets.map(a=>[a.asset_id,`${a.standard_name} · ${a.variant}`]))

await mkdir(output,{recursive:true})
const server=await createServer({root:demo,logLevel:'error',server:{host:'127.0.0.1',port:5184,strictPort:true,fs:{allow:[repo]}}})
let browser
const rows=[]
try{
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage()
  await page.goto('http://127.0.0.1:5184/')
  for(const id of ids){
    const conversion=JSON.parse(await readFile(path.join(webModels.get(id),'conversion.json'),'utf8'))
    const url='/@fs/'+path.join(webModels.get(id),'model.glb').replaceAll('\\','/')
    const sheet=await page.evaluate(async({url,title})=>{
      const THREE=await import('/node_modules/three/build/three.module.js')
      const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js')
      const {MeshoptDecoder}=await import('/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js')
      const {RoomEnvironment}=await import('/node_modules/three/examples/jsm/environments/RoomEnvironment.js')
      const size=480,renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true})
      renderer.setSize(size,size);renderer.outputColorSpace=THREE.SRGBColorSpace
      const scene=new THREE.Scene();scene.background=new THREE.Color(0xf2f2f2)
      scene.environment=new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(),.04).texture
      const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);scene.add(gltf.scene)
      // precise=true measures vertices; the default unions transformed boxes and overestimates.
      const box=new THREE.Box3().setFromObject(gltf.scene,true),center=box.getCenter(new THREE.Vector3()),dims=box.getSize(new THREE.Vector3())
      const radius=dims.length()/2,camera=new THREE.PerspectiveCamera(35,1,.01,100)
      const distance=radius/Math.sin(THREE.MathUtils.degToRad(17.5))*1.05
      // Labels name the axis the camera looks from; "+Z" is the model's default front in the layout contract.
      const views=[['+Z 正面',[0,0,1]],['−Z 背面',[0,0,-1]],['−X 左侧',[-1,0,0]],['+X 右侧',[1,0,0]],['斜上方 (+X+Y+Z)',[1,.8,1]]]
      const canvas=document.createElement('canvas');canvas.width=size*3;canvas.height=size*2+48
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height)
      ctx.fillStyle='#111';ctx.font='bold 22px Microsoft YaHei, sans-serif';ctx.fillText(title,16,32)
      views.forEach(([label,dir],i)=>{
        const d=new THREE.Vector3(...dir).normalize()
        camera.position.copy(center).addScaledVector(d,distance);camera.lookAt(center);renderer.render(scene,camera)
        const x=(i%3)*size,y=48+Math.floor(i/3)*size
        ctx.drawImage(renderer.domElement,x,y);ctx.strokeStyle='#ccc';ctx.strokeRect(x,y,size,size)
        ctx.fillStyle='#111';ctx.font='18px Microsoft YaHei, sans-serif';ctx.fillText(label,x+12,y+28)
      })
      ctx.fillStyle='#616161';ctx.font='16px Microsoft YaHei, sans-serif'
      ctx.fillText(`包围盒 W ${(dims.x*1000).toFixed(0)} × D ${(dims.z*1000).toFixed(0)} × H ${(dims.y*1000).toFixed(0)} mm`,size*2+16,48+size+40)
      renderer.dispose()
      return {png:canvas.toDataURL('image/png'),size:{w:dims.x,h:dims.y,d:dims.z}}
    },{url,title:`${id}  ${nameOf.get(id)??''}`})
    // What the browser loaded must still match the conversion record.
    for(const k of ['w','d','h'])if(Math.abs(sheet.size[k]-conversion.dimensions[k])>.001)throw Error(`${id}: loaded ${k} ${sheet.size[k]} ≠ ${conversion.dimensions[k]}`)
    const file=`${id}.png`
    await writeFile(path.join(output,file),Buffer.from(sheet.png.split(',')[1],'base64'))
    rows.push({id,name:nameOf.get(id)??'',file,mb:(conversion.bytes/1048576).toFixed(1),textures:conversion.textures})
    console.log('rendered',id)
  }
}finally{await browser?.close();await server.close()}

const escape=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
await writeFile(path.join(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>GLB 目视核对</title>
<style>body{font:14px/1.6 Arial,"Microsoft YaHei",sans-serif;margin:24px;color:#111}figure{margin:0 0 32px}img{max-width:100%;border:1px solid #d4d4d4}figcaption{color:#616161}</style>
<h1>GLB 目视核对（${rows.length} 件）</h1><p>核对：正面朝向是否为 +Z、材质与贴图是否正常、有无缺面或多余物体。尺寸与原点已在转换时自动校验。</p>
${rows.map(r=>`<figure id="${r.id}"><img src="${r.file}" alt="${escape(r.id)}"><figcaption>${escape(r.id)} · ${escape(r.name)} · ${r.mb} MB · 贴图 ${r.textures?.count??'?'} 张（下采样 ${r.textures?.downscaled??0}）</figcaption></figure>`).join('\n')}
</html>`)
console.log(`Review sheet: ${path.join(output,'index.html')}`)
