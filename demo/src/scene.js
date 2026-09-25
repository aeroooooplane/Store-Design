import * as THREE from 'three'
import { furnitureParts } from './furniture.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {findRealAsset} from './real-assets.js'
import {assetPose} from './asset-contract.js'
import {loadVerifiedAsset,neutralMaterial,release} from './asset-viewer.js'
import {cameraFor} from './camera-presets.js'

export function createScene(canvas, layout, style='white', interactive=false) {
  // Reject corrupt/unknown asset references before allocating a WebGL context.
  const realItems=layout.items.filter(i=>i.assetId).map(item=>{const asset=findRealAsset(item.assetId);return {item,asset,pose:assetPose(item,asset)}})
  let disposed=false,loaded=realItems.length===0,failed=null
  const abort=new AbortController(),assetGeometry=[]
  const renderer = new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true})
  renderer.setSize(960,640,false)
  renderer.shadowMap.enabled=true
  renderer.shadowMap.type=THREE.PCFSoftShadowMap
  renderer.toneMapping=THREE.ACESFilmicToneMapping
  const scene=new THREE.Scene(); scene.background=new THREE.Color('#e8eaed')
  const {w,d,h}=layout.room; const dark=style==='SI2.0'; const white=style==='white'
  const colors={floor:white?'#f4f4f4':dark?'#45484b':'#a9adb0',wall:white?'#ffffff':dark?'#24282c':'#bfc2c4',prop:white?'#ffffff':dark?'#33383b':'#c7cacc'}
  const box=(x,y,z,bw,bh,bd,color,metalness=0)=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),new THREE.MeshStandardMaterial({color,roughness:.55,metalness}))
    mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);return mesh
  }
  box(w/2,-.08,d/2,w,.16,d,colors.floor)
  // Edge shops use a front opening and cutaway sides; islands have no perimeter walls.
  const island=layout.room.shopType==='中岛店'
  if(!island){
    box(w/2,h/2,-.08,w,h,.16,colors.wall)
    box(-.08,.35,d/2,.16,.7,d,colors.wall)
    box(w+.08,.35,d/2,.16,.7,d,colors.wall)
  }
  const furnitureGeometry=[]
  layout.items.forEach(item=>{
    if(item.assetId)return
    for(const part of furnitureParts(item)){
      const {role,x,y,z,w:pw,h:ph,d:pd}=part
      furnitureGeometry.push({itemId:item.id,...part,x:item.x+x,z:item.z+z})
      const color=white?'#ffffff':role==='top'?'#e3e5e4':colors.prop
      const mesh=box(item.x+x,y,item.z+z,pw,ph,pd,color,white?0:.12)
      mesh.userData={itemId:item.id,role}
    }
  })
  if(!island){
    const label=document.createElement('canvas');label.width=1024;label.height=256
    const ctx=label.getContext('2d');ctx.fillStyle=dark?'#24282c':'#bfc2c4';ctx.fillRect(0,0,1024,256);ctx.fillStyle='#fff';ctx.font='bold 100px Arial';ctx.textAlign='center';ctx.fillText('Insta360',512,165)
    const texture=new THREE.CanvasTexture(label)
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(Math.min(3,w*.5),.75),new THREE.MeshBasicMaterial({map:white?null:texture,color:0xffffff}));if(white)texture.dispose();sign.position.set(w/2,h*.76,.012);scene.add(sign)
    box(w/2,h-.15,.18,w*.85,.025,.06,'#fff5db')
  }
  scene.add(new THREE.HemisphereLight('#ffffff','#808894',2))
  const light=new THREE.DirectionalLight('#fff4df',3.4);light.position.set(w*.4,h*3,d*.8);light.castShadow=true
  light.shadow.mapSize.set(2048,2048); const span=Math.max(w,d); Object.assign(light.shadow.camera,{left:-span,right:span,top:span,bottom:-span,far:span*8});scene.add(light)
  const camera=new THREE.PerspectiveCamera(48,1.5,.05,300)
  const target=new THREE.Vector3(w/2,h*.25,d/2)
  function view(index){ if(disposed)throw Error('场景已关闭');const preset=cameraFor(layout.room,index);camera.position.fromArray(preset.position);camera.lookAt(target);renderer.render(scene,camera) }
  view(0)
  let controls,raf
  if(interactive){controls=new OrbitControls(camera,canvas);controls.target.copy(target);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49; const tick=()=>{controls.update();renderer.render(scene,camera);raf=requestAnimationFrame(tick)};tick()}
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
  })).then(()=>{if(disposed)throw Error('场景已关闭');loaded=true;renderer.render(scene,camera)}).catch(error=>{failed=error;abort.abort();throw error})
  ready.catch(()=>{}) // Consumer awaits ready; avoid an unhandled rejection on early unmount.
  return {view,ready,assetGeometry,furnitureGeometry,
    geometryManifest:()=>{scene.updateMatrixWorld(true);const meshes=[];scene.traverseVisible(o=>{if(o.isMesh)meshes.push({itemId:o.userData.itemId??null,type:o.geometry.type,vertices:o.geometry.attributes.position.count,indices:o.geometry.index?.count??0,parameters:o.geometry.parameters??null,matrix:o.matrixWorld.toArray()})});return meshes},
    image:()=>{if(disposed||failed||!loaded)throw failed||Error('真实模型尚未载入完成');return renderer.domElement.toDataURL('image/png')},
    dispose:()=>{if(disposed)return;disposed=true;abort.abort();cancelAnimationFrame(raf);controls?.dispose();release(scene);renderer.dispose();renderer.forceContextLoss()}}
}
