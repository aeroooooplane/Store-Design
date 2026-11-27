// Retired appearance experiment. It changes the source's decals and PBR and is not a fidelity pass.
import {readFile,mkdir,writeFile,access} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {createServer} from 'vite'
import {chromium} from '@playwright/test'

const [sourceArg,outArg]=process.argv.slice(2)
if(!process.argv.includes('--allow-appearance-changes'))throw Error('旧外观实验已撤回：会改写贴花、PBR和贴图分辨率。保留原版请使用 build-mm93-viewer.mjs；实验复现必须显式传 --allow-appearance-changes。')
if(!sourceArg||!outArg)throw Error('Usage: node repair-mm93.mjs source.glb output-directory')
const source=path.resolve(sourceArg),out=path.resolve(outArg)
const bytes=await readFile(source),sha=createHash('sha256').update(bytes).digest('hex')
if(sha!=='46ed38fb4e5a774e91e10264b20874a4c0a8584e655b5c680792c9b9e8700fef')throw Error('Unexpected source: this repair is specific to the reviewed Tripo draft')
await mkdir(out,{recursive:true})
const target=path.join(out,'repaired-uncompressed.glb')
for(const file of [target,path.join(out,'repair.json')])try{await access(file);throw Error('Output already exists: '+file)}catch(e){if(e.code!=='ENOENT')throw e}
const tool=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=path.resolve(tool,'../..')
const art=JSON.parse(await readFile(path.join(repo,'packages/shared/src/facade/logo-art.json'),'utf8')).overseas
const server=await createServer({root:tool,cacheDir:path.join(out,'.vite'),logLevel:'error',server:{host:'127.0.0.1',port:5259,strictPort:true,fs:{allow:[repo,path.dirname(source)]}}})
let browser
try{
 await server.listen()
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5259/')
 await page.evaluate(()=>{const m=document.createElement('script');m.type='importmap';m.textContent=JSON.stringify({imports:{three:'/node_modules/three/build/three.module.js'}});document.head.appendChild(m)})
 const result=await page.evaluate(async({url,art})=>{
  const THREE=await import('/node_modules/three/build/three.module.js')
  const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js')
  const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js')
  const {DecalGeometry}=await import('/node_modules/three/examples/jsm/geometries/DecalGeometry.js')
  const gltf=await new GLTFLoader().loadAsync(url);gltf.scene.updateMatrixWorld(true)
  const meshes=[];gltf.scene.traverse(o=>{if(o.isMesh)meshes.push(o)})
  if(meshes.length!==1)throw Error('Expected the reviewed single-mesh draft')
  const mesh=meshes[0],root=new THREE.Group();root.name='MM93_Insta360_2100mm_provisional';root.add(gltf.scene)
  // The source's generated normals and near-mirror highlights exaggerate reconstruction ripples.
  mesh.material.normalScale.set(.3,.3);mesh.material.roughnessMap=null;mesh.material.roughness=.5;mesh.material.metalness=.2
  const changes=[]
  // Limit projected vinyl to painted fairings; do not recolour exposed metal or black vents.
  const image=mesh.material.map.image,maskCanvas=document.createElement('canvas');maskCanvas.width=image.width;maskCanvas.height=image.height
  const maskContext=maskCanvas.getContext('2d',{willReadFrequently:true});maskContext.drawImage(image,0,0)
  const pixels=maskContext.getImageData(0,0,image.width,image.height).data,originalUV=mesh.geometry.getAttribute('uv'),originalIndex=mesh.geometry.index,painted=[]
  const pixel=(u,v)=>{const x=Math.max(0,Math.min(image.width-1,Math.floor(u*image.width))),y=Math.max(0,Math.min(image.height-1,Math.floor(v*image.height))),i=(y*image.width+x)*4;return [pixels[i],pixels[i+1],pixels[i+2]]}
  const red=([r,g,b])=>r>25&&r>g*1.5&&r>b*1.3
  for(let i=0;i<originalIndex.count;i+=3){const a=originalIndex.getX(i),b=originalIndex.getX(i+1),c=originalIndex.getX(i+2),u=(originalUV.getX(a)+originalUV.getX(b)+originalUV.getX(c))/3,v=(originalUV.getY(a)+originalUV.getY(b)+originalUV.getY(c))/3,color=pixel(u,v)
   let keep=red(color)
   if(!keep&&Math.min(...color)>90&&Math.max(...color)-Math.min(...color)<100)for(const [du,dv]of [[.012,0],[-.012,0],[0,.012],[0,-.012],[.006,.006],[-.006,-.006]])if(red(pixel(u+du,v+dv))){keep=true;break}
   if(keep)painted.push(a,b,c)
  }
  const paintedGeometry=mesh.geometry.clone();paintedGeometry.setIndex(painted);const paintedMesh=new THREE.Mesh(paintedGeometry,mesh.material);paintedMesh.matrixWorld.copy(mesh.matrixWorld)
  // Solid red vinyl underlays cover hallucinated lettering. Vector art is the same source as façade logos.
  function texture(kind){
   const canvas=document.createElement('canvas');canvas.width=kind==='brand'?2048:512;canvas.height=kind==='brand'?700:320
   const ctx=canvas.getContext('2d');ctx.fillStyle='#d00a13';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#fff'
   if(kind==='brand'){
    const scale=Math.min(canvas.width*.75/art.width,canvas.height*.55/art.height)
    ctx.translate((canvas.width-art.width*scale)/2,(canvas.height-art.height*scale)/2);ctx.scale(scale,scale)
    for(const item of art.paths)ctx.fill(new Path2D(item.d),item.evenOdd?'evenodd':'nonzero')
   }else{ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='italic 900 290px Arial';ctx.fillText('93',canvas.width/2,canvas.height*.52,canvas.width*.88)}
   const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.flipY=true;t.anisotropy=8;return t
  }
  const brand=texture('brand'),number=texture('number')
  function decal(name,center,size,rotation,kind,normal){
   const geometry=new DecalGeometry(paintedMesh,new THREE.Vector3(...center),new THREE.Euler(...rotation),new THREE.Vector3(...size))
   const pos=geometry.getAttribute('position'),norm=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv')
   const p=[],n=[],t=[],direction=new THREE.Vector3(...normal)
   for(let i=0;i<pos.count;i+=3){
    for(let j=0;j<3;j++){const k=i+j;const x=new THREE.Vector3().fromBufferAttribute(pos,k),normalVector=new THREE.Vector3().fromBufferAttribute(norm,k);x.addScaledVector(direction,.002);p.push(...x.toArray());n.push(...normalVector.toArray());t.push(uv.getX(k),uv.getY(k))}
   }
   if(p.length===0)throw Error('No decal surface: '+name)
   const clipped=new THREE.BufferGeometry();clipped.setAttribute('position',new THREE.Float32BufferAttribute(p,3));clipped.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));clipped.setAttribute('uv',new THREE.Float32BufferAttribute(t,2))
   const patch=new THREE.Mesh(clipped,new THREE.MeshStandardMaterial({map:kind==='brand'?brand:number,roughness:.4,metalness:.08}));patch.name=name;root.add(patch);changes.push({name,center,size,triangles:p.length/9})
  }
  for(const side of [1,-1]){
   decal('Insta360_'+(side>0?'left':'right'),[-.10,.275,side*.105],[.40,.132,.105],[0,side>0?0:Math.PI,0],'brand',[0,0,side])
   decal('93_tail_'+(side>0?'left':'right'),[.385,.438,side*.063],[.14,.064,.1],[0,side>0?0:Math.PI,0],'number',[0,0,side])
  }
  decal('93_front',[-.395,.387,0],[.17,.108,.12],[0,-Math.PI/2,0],'number',[-1,0,0])
  root.rotation.y=Math.PI/2;root.scale.setScalar(2.1);root.updateMatrixWorld(true)
  let box=new THREE.Box3().setFromObject(root,true);root.position.set(-(box.min.x+box.max.x)/2,-box.min.y,-(box.min.z+box.max.z)/2);root.updateMatrixWorld(true)
  box=new THREE.Box3().setFromObject(root,true)
  const binary=await new GLTFExporter().parseAsync(root,{binary:true,maxTextureSize:2048})
  const array=new Uint8Array(binary);let binaryString='';for(let i=0;i<array.length;i+=32768)binaryString+=String.fromCharCode(...array.subarray(i,i+32768))
  return {base64:btoa(binaryString),changes,bounds:{min:box.min.toArray(),max:box.max.toArray()},dimensions:{w:box.max.x-box.min.x,d:box.max.z-box.min.z,h:box.max.y-box.min.y}}
 },{url:'/@fs/'+source.replaceAll('\\','/'),art})
 await writeFile(target,Buffer.from(result.base64,'base64'),{flag:'wx'})
 delete result.base64
 await writeFile(path.join(out,'repair.json'),JSON.stringify({sourceSha256:sha,sourceGenerator:'Tripo',nominalLengthM:2.1,dimensionStatus:'provisional display scale, not measured from a manufacturer drawing',...result},null,2),{flag:'wx'})
 console.log(JSON.stringify(result))
}finally{await browser?.close();await server.close()}
