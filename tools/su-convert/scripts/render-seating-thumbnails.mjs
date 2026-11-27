// 用实际模型重绘坐凳缩略图；透明背景沿用模型卡片底色，灰色仅作用于SI1缩略图。
import {mkdir,readFile,writeFile,realpath} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'
import {readLibrary} from '../server/model-library-paths.mjs'

const tool=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=path.resolve(tool,'../..')
const library=await readLibrary(repo),output=process.argv[2]
if(!output)throw Error('请指定隔离缩略图输出目录')
const out=path.resolve(output),port=Number(process.env.SU_THUMBNAIL_PORT||5257)
await mkdir(out,{recursive:true})
const server=await createServer({root:tool,cacheDir:path.join(out,'.vite'),logLevel:'error',server:{host:'127.0.0.1',port,strictPort:true,fs:{allow:[repo,library.root,await realpath(path.join(repo,'资源库'))]}}})
let browser
const results=[]
try{
 await server.listen()
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 const page=await browser.newPage()
 await page.goto(`http://127.0.0.1:${port}/`)
 await page.evaluate(()=>{const s=document.createElement('script');s.type='importmap';s.textContent=JSON.stringify({imports:{three:'/node_modules/three/build/three.module.js'}});document.head.appendChild(s)})
 for(const id of ['asset-90000002','asset-569180','asset-90000003','asset-15903874']){
  const dir=library.webModels.get(id),conversion=JSON.parse(await readFile(path.join(dir,'conversion.json'),'utf8'))
  const bytes=(await readFile(path.join(dir,'model.glb'))).toString('base64')
  const result=await page.evaluate(async({id,bytes})=>{
   const THREE=await import('/node_modules/three/build/three.module.js')
   const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js')
   const {MeshoptDecoder}=await import('/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js')
   const {RoomEnvironment}=await import('/node_modules/three/examples/jsm/environments/RoomEnvironment.js')
   const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true})
   renderer.setSize(640,480);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0,0)
   const scene=new THREE.Scene(),env=new THREE.PMREMGenerator(renderer)
   scene.environment=env.fromScene(new RoomEnvironment(),.04).texture
   scene.add(new THREE.HemisphereLight(0xffffff,0x999999,.6))
   const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,4,3);scene.add(light)
   const data=Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)).buffer
   const model=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(data,'')).scene
   const gray=id==='asset-90000002'||id==='asset-569180'
   if(gray)model.traverse(o=>{if(o.isMesh)o.material=new THREE.MeshStandardMaterial({color:0x8c8c8c,roughness:.8,metalness:0,side:THREE.DoubleSide})})
   scene.add(model)
   const box=new THREE.Box3().setFromObject(model,true),center=box.getCenter(new THREE.Vector3()),dims=box.getSize(new THREE.Vector3())
   const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,100)
   camera.position.copy(center).add(new THREE.Vector3(1,1.05,1.4).normalize().multiplyScalar(5));camera.lookAt(center);camera.updateMatrixWorld()
   let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity
   for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse);minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y)}
   const half=Math.max((maxY-minY)/2,(maxX-minX)/2/(4/3))*1.1,cx=(minX+maxX)/2,cy=(minY+maxY)/2
   camera.left=cx-half*4/3;camera.right=cx+half*4/3;camera.top=cy+half;camera.bottom=cy-half;camera.updateProjectionMatrix()
   const expected=id==='asset-569180'?'SketchUp_Instance_0':id==='asset-15903874'?'group_0':null
   const instances=expected?model.getObjectByName(expected)?.children.length:1
   renderer.render(scene,camera)
   const png=renderer.domElement.toDataURL('image/png'),ctx=document.createElement('canvas').getContext('2d');ctx.canvas.width=640;ctx.canvas.height=480;ctx.drawImage(renderer.domElement,0,0)
   const alpha=ctx.getImageData(0,0,1,1).data[3]
   renderer.dispose();env.dispose()
   return {id,png,dimensions:{w:dims.x,d:dims.z,h:dims.y},instances,grayThumbnailOnly:gray,cornerAlpha:alpha}
  },{id,bytes})
  for(const key of ['w','d','h'])if(Math.abs(result.dimensions[key]-conversion.dimensions[key])>.001)throw Error(`${id}缩略图模型尺寸不一致`)
  if(result.cornerAlpha!==0||result.instances!==(id==='asset-569180'||id==='asset-15903874'?4:1))throw Error(`${id}背景或坐凳数量不正确`)
  await writeFile(path.join(out,id+'.png'),Buffer.from(result.png.split(',')[1],'base64'))
  results.push({...result,png:undefined})
  console.log('rendered',id)
 }
 // 单凳的平面真实外轮廓为450mm正方形，输出与SVG一致的透明PNG。
 const symbol=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=450;c.height=450;const g=c.getContext('2d');g.strokeStyle='#333';g.lineWidth=2;g.strokeRect(1,1,448,448);return c.toDataURL('image/png')})
 await writeFile(path.join(out,'asset-90000003-plan.png'),Buffer.from(symbol.split(',')[1],'base64'))
 await writeFile(path.join(out,'render-results.json'),JSON.stringify(results,null,2)+'\n')
}finally{await browser?.close();await server.close()}
