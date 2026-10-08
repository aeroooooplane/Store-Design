import * as THREE from 'three'
import { furnitureParts } from './furniture.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {findRealAsset} from './real-assets.js'
import {assetPose} from './asset-contract.js'
import {loadVerifiedAsset,neutralMaterial,release} from './asset-viewer.js'
import {cameraFor} from './camera-presets.js'
import {heightIssues} from './layout.js'
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js'
import {floorTexture,surfaceMaterial} from './store-materials.js'
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js'
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js'
import {SSAOPass} from 'three/addons/postprocessing/SSAOPass.js'
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js'

export function createScene(canvas, layout, style='white', interactive=false) {
  const clearanceWarnings=heightIssues(layout)
  if(clearanceWarnings.length)throw Error('请先返回平面核对：'+clearanceWarnings.join('；'))
  // Reject corrupt/unknown asset references before allocating a WebGL context.
  const realItems=layout.items.filter(i=>i.assetId).map(item=>{const asset=findRealAsset(item.assetId);return {item,asset,pose:assetPose(item,asset)}})
  let disposed=false,loaded=realItems.length===0,failed=null
  const abort=new AbortController(),assetGeometry=[]
  const renderer = new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true})
  renderer.setSize(960,640,false)
  renderer.shadowMap.enabled=true
  renderer.shadowMap.type=THREE.PCFSoftShadowMap
  renderer.toneMapping=THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure=.82
  const scene=new THREE.Scene(); scene.background=new THREE.Color('#e8eaed')
  const {w,d,h}=layout.room; const dark=style==='SI2.0'; const white=style==='white'
  const pmrem=new THREE.PMREMGenerator(renderer),environmentScene=new RoomEnvironment()
  const environment=pmrem.fromScene(environmentScene,.04)
  scene.environment=environment.texture;scene.environmentIntensity=white?.25:.45
  environmentScene.dispose();pmrem.dispose()
  const colors={floor:white?'#f4f4f4':dark?'#45484b':'#a9adb0',wall:white?'#ffffff':dark?'#24282c':'#bfc2c4',prop:white?'#ffffff':dark?'#33383b':'#c7cacc'}
  const box=(x,y,z,bw,bh,bd,color,metalness=0)=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),new THREE.MeshStandardMaterial({color,roughness:.55,metalness}))
    mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);return mesh
  }
  const floor=box(w/2,-.08,d/2,w,.16,d,colors.floor)
  floor.material.dispose();floor.material=surfaceMaterial('floor',{white,dark,map:white?undefined:floorTexture(w,d)})
  // Edge shops use a front opening and cutaway sides; islands have no perimeter walls.
  const island=layout.room.shopType==='中岛店'
  if(!island){
    box(w/2,h/2,-.08,w,h,.16,colors.wall)
    box(-.08,.35,d/2,.16,.7,d,colors.wall)
    box(w+.08,.35,d/2,.16,.7,d,colors.wall)
  }
  if(!island){
    for(let x=.15;x<w;x+=1.2){
      const trim=box(x,h/2,.012,.014,h,.018,colors.prop)
      trim.material.dispose();trim.material=surfaceMaterial('metal',{white,dark})
    }
    for(let x=.25;x<w;x+=.45){
      const batten=box(x,h-.07,.65,.045,.12,1.3,colors.prop)
      batten.material.dispose();batten.material=surfaceMaterial('fixture',{white,dark})
    }
  }
  const furnitureGeometry=[]
  layout.items.forEach(item=>{
    if(item.assetId)return
    for(const part of furnitureParts(item)){
      const {role,x,y,z,w:pw,h:ph,d:pd}=part
      furnitureGeometry.push({itemId:item.id,...part,x:item.x+x,z:item.z+z})
      const color=white?'#ffffff':role==='top'?'#e3e5e4':colors.prop
      const mesh=box(item.x+x,y,item.z+z,pw,ph,pd,color,white?0:.12)
      mesh.material.dispose();mesh.material=surfaceMaterial(role==='top'?'top':'metal',{white,dark})
      mesh.userData={itemId:item.id,role}
    }
  })
  if(!island){
    const label=document.createElement('canvas');label.width=1024;label.height=256
    const ctx=label.getContext('2d');ctx.fillStyle=dark?'#24282c':'#bfc2c4';ctx.fillRect(0,0,1024,256);ctx.fillStyle='#fff';ctx.font='bold 100px Arial';ctx.textAlign='center';ctx.fillText('Insta360',512,165)
    const texture=new THREE.CanvasTexture(label);texture.colorSpace=THREE.SRGBColorSpace
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(Math.min(3,w*.5),.75),new THREE.MeshBasicMaterial({map:white?null:texture,color:0xffffff}));if(white)texture.dispose();sign.position.set(w/2,h*.76,.012);scene.add(sign)
    const strip=box(w/2,h-.15,.18,w*.85,.025,.06,'#fff5db')
    strip.material.dispose();strip.material=surfaceMaterial('light',{white,dark})
  }
  for(let z=1.6;z<d-.8;z+=2.8){
    const rail=box(w/2,h-.12,z,Math.max(1,w-.8),.035,.04,colors.prop)
    rail.material.dispose();rail.material=surfaceMaterial('fixture',{white,dark})
    for(let x=1;x<w;x+=2.4){
      const lamp=box(x,h-.18,z,.24,.055,.12,colors.prop)
      lamp.material.dispose();lamp.material=surfaceMaterial('light',{white,dark})
      const spot=new THREE.SpotLight('#fff2df',white?5:18,Math.max(h*2,8),Math.PI/3,.65,2)
      spot.position.set(x,h-.25,z);spot.target.position.set(x,0,z);scene.add(spot,spot.target)
    }
  }
  scene.add(new THREE.HemisphereLight('#ffffff','#7b7770',white?1.1:.45))
  const light=new THREE.DirectionalLight('#fff4e8',1.6);light.position.set(w*.4,h*3,d*.8);light.castShadow=true
  light.shadow.bias=-.00015;light.shadow.normalBias=.025
  light.shadow.mapSize.set(2048,2048); const span=Math.max(w,d); Object.assign(light.shadow.camera,{left:-span,right:span,top:span,bottom:-span,far:span*8});scene.add(light)
  const camera=new THREE.PerspectiveCamera(48,1.5,.05,300)
  const renderTarget=new THREE.WebGLRenderTarget(960,640,{samples:4,type:THREE.HalfFloatType})
  const composer=new EffectComposer(renderer,renderTarget),renderPass=new RenderPass(scene,camera)
  const ao=new SSAOPass(scene,camera,960,640)
  ao.kernelRadius=4;ao.minDistance=.001;ao.maxDistance=.03
  const outputPass=new OutputPass()
  composer.addPass(renderPass);composer.addPass(ao);composer.addPass(outputPass)
  const draw=()=>composer.render()
  const target=new THREE.Vector3(w/2,h*.25,d/2)
  function view(index){ if(disposed)throw Error('场景已关闭');const preset=cameraFor(layout.room,index);camera.position.fromArray(preset.position);camera.fov=preset.fov;camera.updateProjectionMatrix();camera.lookAt(new THREE.Vector3(...preset.target));draw() }
  view(0)
  let controls,raf
  if(interactive){controls=new OrbitControls(camera,canvas);controls.target.copy(target);controls.enableDamping=false;controls.maxPolarAngle=Math.PI*.49;controls.addEventListener('change',()=>{if(!disposed)draw()});controls.update()}
  // Scene-local reuse: clones share verified geometry/materials, not placement or identity.
  // All current catalog assets are static furniture. No cross-scene cache survives disposal.
  const groups=new Map()
  for(const entry of realItems){if(!groups.has(entry.asset.id))groups.set(entry.asset.id,[]);groups.get(entry.asset.id).push(entry)}
  const ready=Promise.all([...groups.values()].map(async entries=>{
    const {asset}=entries[0]
    const model=await loadVerifiedAsset(asset,abort.signal)
    if(disposed||failed){release(model);throw Error('场景加载已取消')}
    const originals=new Set(),neutrals=new Map()
    model.traverse(o=>{
      if(!o.isMesh)return
      o.castShadow=true;o.receiveShadow=true
      if(white){
        const old=[].concat(o.material),neutral=old.map(m=>{originals.add(m);if(!neutrals.has(m))neutrals.set(m,neutralMaterial(m));return neutrals.get(m)})
        o.material=Array.isArray(o.material)?neutral:neutral[0]
      }
    })
    for(const material of originals)material.dispose()
    for(const {item,pose} of entries){
      const instance=model.clone(true)
      instance.traverse(o=>{if(o.isMesh)o.userData.itemId=item.id})
      // Wrapper preserves the normalized model's internal translation and transforms.
      const placed=new THREE.Group();placed.add(instance);placed.position.fromArray(pose.position);placed.rotation.y=pose.rotationY;scene.add(placed)
      assetGeometry.push({itemId:item.id,assetId:asset.id,...pose})
    }
  })).then(()=>{if(disposed)throw Error('场景已关闭');loaded=true;draw()}).catch(error=>{failed=error;abort.abort();throw error})
  ready.catch(()=>{}) // Consumer awaits ready; avoid an unhandled rejection on early unmount.
  return {view,ready,assetGeometry,furnitureGeometry,
    geometryManifest:()=>{scene.updateMatrixWorld(true);const meshes=[];scene.traverseVisible(o=>{if(o.isMesh)meshes.push({itemId:o.userData.itemId??null,type:o.geometry.type,vertices:o.geometry.attributes.position.count,indices:o.geometry.index?.count??0,parameters:o.geometry.parameters??null,matrix:o.matrixWorld.toArray()})});return meshes.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))},
    image:()=>{if(disposed||failed||!loaded)throw failed||Error('真实模型尚未载入完成');return renderer.domElement.toDataURL('image/png')},
    dispose:()=>{if(disposed)return;disposed=true;abort.abort();cancelAnimationFrame(raf);controls?.dispose();release(scene);environment.dispose();ao.dispose();outputPass.dispose();renderPass.dispose();composer.dispose();renderer.dispose();renderer.forceContextLoss()}}
}
