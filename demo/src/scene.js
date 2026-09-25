import * as THREE from 'three'
import { furnitureParts } from './furniture.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {findRealAsset} from './real-assets.js'
import {assetPose} from './asset-contract.js'
import {loadVerifiedAsset,neutralMaterial,release} from './asset-viewer.js'

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
  if(!white&&!island){
    const label=document.createElement('canvas');label.width=1024;label.height=256
    const ctx=label.getContext('2d');ctx.fillStyle=dark?'#24282c':'#bfc2c4';ctx.fillRect(0,0,1024,256);ctx.fillStyle='#fff';ctx.font='bold 100px Arial';ctx.textAlign='center';ctx.fillText('Insta360',512,165)
    const texture=new THREE.CanvasTexture(label)
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(Math.min(3,w*.5),.75),new THREE.MeshBasicMaterial({map:texture}));sign.position.set(w/2,h*.76,.012);scene.add(sign)
    box(w/2,h-.15,.18,w*.85,.025,.06,'#fff5db')
  }
  scene.add(new THREE.HemisphereLight('#ffffff','#808894',2))
  const light=new THREE.DirectionalLight('#fff4df',3.4);light.position.set(w*.4,h*3,d*.8);light.castShadow=true
  light.shadow.mapSize.set(2048,2048); const span=Math.max(w,d); Object.assign(light.shadow.camera,{left:-span,right:span,top:span,bottom:-span,far:span*8});scene.add(light)
  const camera=new THREE.PerspectiveCamera(48,1.5,.05,300)
  const target=new THREE.Vector3(w/2,h*.25,d/2)
  const views=[[.5,1.15,1.8],[-.7,1,1.4],[1.7,1,1.4],[1.7,1,-.4],[-.7,1,-.4],[.5,1.3,-.85],[.5,2.4,.501],[.5,.55,1.7]]
  function view(index){ const [x,y,z]=views[index];camera.position.set(w*x,span*y,d*z);camera.lookAt(target);renderer.render(scene,camera) }
  view(0)
  let controls,raf
  if(interactive){controls=new OrbitControls(camera,canvas);controls.target.copy(target);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.49; const tick=()=>{controls.update();renderer.render(scene,camera);raf=requestAnimationFrame(tick)};tick()}
  const ready=Promise.all(realItems.map(async({item,asset,pose})=>{
    const model=await loadVerifiedAsset(asset,abort.signal)
    if(disposed||failed){release(model);throw Error('场景加载已取消')}
    model.traverse(o=>{
      if(!o.isMesh)return
      o.castShadow=true;o.receiveShadow=true;o.userData.itemId=item.id
      if(white){
        const old=[].concat(o.material),neutral=old.map(neutralMaterial)
        o.material=Array.isArray(o.material)?neutral:neutral[0]
        for(const material of old)material.dispose()
      }
    })
    // Wrapper preserves the normalized model's internal translation and transforms.
    const placed=new THREE.Group();placed.add(model);placed.position.fromArray(pose.position);placed.rotation.y=pose.rotationY;scene.add(placed)
    assetGeometry.push({itemId:item.id,assetId:asset.id,...pose})
  })).then(()=>{if(disposed)throw Error('场景已关闭');loaded=true;renderer.render(scene,camera)}).catch(error=>{failed=error;abort.abort();throw error})
  ready.catch(()=>{}) // Consumer awaits ready; avoid an unhandled rejection on early unmount.
  return {view,ready,assetGeometry,furnitureGeometry,
    image:()=>{if(disposed||failed||!loaded)throw failed||Error('真实模型尚未载入完成');return renderer.domElement.toDataURL('image/png')},
    dispose:()=>{if(disposed)return;disposed=true;abort.abort();cancelAnimationFrame(raf);controls?.dispose();release(scene);renderer.dispose();renderer.forceContextLoss()}}
}
