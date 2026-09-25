import * as T from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js'
import {validateAsset} from './asset-contract.js'
import {meshBounds} from './asset-normalization.js'

export function release(root){
  const geometries=new Set(),materials=new Set(),textures=new Set()
  root?.traverse(o=>{
    if(o.geometry)geometries.add(o.geometry)
    for(const m of [].concat(o.material||[])){
      materials.add(m)
      for(const value of Object.values(m))if(value?.isTexture)textures.add(value)
    }
  })
  for(const g of geometries)g.dispose()
  for(const m of materials)m.dispose()
  for(const texture of textures){texture.dispose();texture.source?.data?.close?.()}
}

export function neutralMaterial(m){
  const copy=m.clone()
  copy.color?.set('#ffffff');copy.emissive?.set('#000000')
  if('metalness' in copy)copy.metalness=0
  if('roughness' in copy)copy.roughness=1
  copy.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb = vec3(1.0);')}
  copy.customProgramCacheKey=()=> 'asset-white-preserve-alpha-v1'
  return copy
}

export async function loadVerifiedAsset(asset,signal){
  validateAsset(asset)
  const response=await fetch(asset.url,{signal})
  if(!response.ok)throw Error(`真实资产加载失败（${response.status}）：${asset.name}`)
  const gltf=await new GLTFLoader().parseAsync(await response.arrayBuffer(),'')
  const model=gltf.scene
  try{
    if(signal?.aborted)throw Error('模型加载已取消')
    const bounds=meshBounds(model),size=bounds.getSize(new T.Vector3()),actual={w:size.x,h:size.y,d:size.z}
    if(bounds.isEmpty()||!Object.keys(actual).every(k=>Math.abs(actual[k]-asset.dimensions[k])<=.001))throw Error('GLB 尺寸不符合资产记录')
    if(Math.abs(bounds.min.y)>.001||Math.abs(bounds.min.x+bounds.max.x)>.002||Math.abs(bounds.min.z+bounds.max.z)>.002)throw Error('GLB 原点不符合底部中心约定')
    return model
  }catch(error){release(model);throw error}
}

export function createAssetViewer(canvas,asset){
  validateAsset(asset)
  const renderer=new T.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true})
  renderer.setSize(960,640,false)
  renderer.toneMapping=T.ACESFilmicToneMapping
  const scene=new T.Scene();scene.background=new T.Color('#e8eaed')
  scene.add(new T.HemisphereLight(0xffffff,0x626874,2.3))
  const lamp=new T.DirectionalLight(0xffffff,3);lamp.position.set(3,5,4);scene.add(lamp)
  const camera=new T.PerspectiveCamera(40,1.5,.01,100)
  const span=Math.max(...Object.values(asset.dimensions))
  camera.position.set(span*1.4,span,span*1.6)
  const controls=new OrbitControls(camera,canvas)
  controls.target.set(0,asset.dimensions.h/2,0);controls.update()
  const abort=new AbortController(),originals=new Map(),whites=new Map()
  let model,disposed=false,loaded=false,white=false
  const draw=()=>{if(!disposed)renderer.render(scene,camera)}
  controls.addEventListener('change',draw)
  const assertReady=()=>{if(disposed||!loaded)throw Error('真实资产尚未就绪，不能导出占位图')}
  const setWhite=value=>{
    white=Boolean(value)
    if(!model||disposed)return
    for(const [mesh,original] of originals){
      if(!whites.has(mesh)){
        // Keep alpha-tested cutouts while replacing only the material appearance.
        whites.set(mesh,Array.isArray(original)?original.map(neutralMaterial):neutralMaterial(original))
      }
      mesh.material=white?whites.get(mesh):original
    }
    draw()
  }
  const ready=(async()=>{
    const loadedModel=await loadVerifiedAsset(asset,abort.signal)
    if(disposed){release(loadedModel);throw Error('模型预览已关闭')}
    model=loadedModel
    model.traverse(o=>{if(o.isMesh)originals.set(o,o.material)})
    scene.add(model);loaded=true;setWhite(white)
  })()
  return {ready,setWhite,
    image(){assertReady();draw();return canvas.toDataURL('image/png')},
    inspect(){assertReady();const bounds=meshBounds(model);return {bounds:[bounds.min.toArray(),bounds.max.toArray()],meshCount:originals.size,opacities:[...originals.keys()].flatMap(mesh=>[].concat(mesh.material).map(m=>m.opacity))}},
    dispose(){
      if(disposed)return
      disposed=true;loaded=false;abort.abort();controls.dispose()
      for(const [mesh,original] of originals)mesh.material=original
      for(const material of whites.values())for(const m of [].concat(material))m.dispose()
      release(model);renderer.dispose();renderer.forceContextLoss()
    }
  }
}
