// S2：从已校验的四件组合中保留一个完整实例；不改源 SKP / GLB。
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {dequantize,prune} from '@gltf-transform/functions'
import {MeshoptDecoder} from 'meshoptimizer'
import {readLibrary,webModelDirFor} from '../server/model-library-paths.mjs'

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..')
const sourceId='asset-569180',id='asset-90000002'
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex')
const library=await readLibrary(repo)
const sourceAsset=library.manifest.assets.find(a=>a.asset_id===sourceId)
const targetAsset=library.manifest.assets.find(a=>a.asset_id===id)
if(!sourceAsset?.web_model||!targetAsset)throw Error('缺少组合款或单凳 manifest 条目')
const source=path.join(library.root,sourceAsset.web_model,'model.glb')
const bytes=await readFile(source)
const sourceRecord=JSON.parse(await readFile(path.join(path.dirname(source),'conversion.json'),'utf8'))
if(sha256(bytes)!==sourceRecord.glbSha256||bytes.length!==sourceRecord.bytes)throw Error('源模型与转换记录不一致')

await MeshoptDecoder.ready
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder})
const document=await io.readBinary(bytes)
// 读取 meshopt 后还原量化坐标，后续重新走既定压缩流程。
await document.transform(dequantize())
for(const extension of document.getRoot().listExtensionsUsed()){
  if(extension.extensionName==='EXT_meshopt_compression')extension.dispose()
}

function meshNodes(node){
  return [node,...node.listChildren().flatMap(meshNodes)].filter(n=>n.getMesh())
}
function bounds(nodes){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],p=[]
  for(const n of nodes){
    const matrix=n.getWorldMatrix()
    for(const primitive of n.getMesh().listPrimitives()){
      if(primitive.getMode()!==4)throw Error('源模型含非三角面')
      const position=primitive.getAttribute('POSITION'),indices=primitive.getIndices()
      for(let i=0;i<(indices?.getCount()??position.getCount());i++){
        position.getElement(indices?indices.getScalar(i):i,p)
        for(let axis=0;axis<3;axis++){
          const v=matrix[axis]*p[0]+matrix[4+axis]*p[1]+matrix[8+axis]*p[2]+matrix[12+axis]
          min[axis]=Math.min(min[axis],v);max[axis]=Math.max(max[axis],v)
        }
      }
    }
  }
  if(!min.every(Number.isFinite))throw Error('模型无有效网格')
  return {min,max,dimensions:{w:max[0]-min[0],h:max[1]-min[1],d:max[2]-min[2]}}
}
const groups=document.getRoot().listNodes().filter(n=>n.getName()==='SketchUp_Instance_0')
if(groups.length!==1)throw Error('组合根实例不唯一')
const instances=groups[0].listChildren()
if(instances.length!==4)throw Error('源组合不是四件独立实例')
const expected={w:.45,d:.45,h:.35}
const measurements=instances.map(n=>{
  const meshes=meshNodes(n),box=bounds(meshes)
  const triangles=meshes.reduce((total,m)=>total+m.getMesh().listPrimitives().reduce((sum,p)=>sum+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0)
  if(meshes.length!==3||triangles!==504)throw Error('单凳部件或三角面数量发生变化')
  for(const k of ['w','d','h'])if(Math.abs(box.dimensions[k]-expected[k])>.001)throw Error('单凳尺寸不符合预期')
  return {instance:n.getName(),...box,meshes:meshes.length,triangles}
})
const selected=instances[0],selectedName=selected.getName(),world=selected.getWorldMatrix()
const keep=new Set()
function retain(n){keep.add(n);n.listChildren().forEach(retain)}
retain(selected)
selected.getParentNode().removeChild(selected)
selected.setMatrix(world)
for(const node of document.getRoot().listNodes())if(!keep.has(node))node.dispose()
const box=measurements[0]
const offset=[-(box.min[0]+box.max[0])/2,-box.min[1],-(box.min[2]+box.max[2])/2]
const root=document.createNode('培训坐凳单只 · H350').setTranslation(offset).addChild(selected)
const scene=document.getRoot().listScenes()[0]
scene.addChild(root)
document.getRoot().setDefaultScene(scene)
await document.transform(prune())
const output=Buffer.from(await io.writeBinary(document))
const reloaded=await io.readBinary(output)
const checked=bounds(reloaded.getRoot().listNodes().filter(n=>n.getMesh()))
for(const k of ['w','d','h'])if(Math.abs(checked.dimensions[k]-expected[k])>.001)throw Error('回读尺寸失败')
if(Math.abs(checked.min[1])>1e-6||Math.abs(checked.min[0]+checked.max[0])>1e-6||Math.abs(checked.min[2]+checked.max[2])>1e-6)throw Error('底部中心原点校验失败')
const folder=webModelDirFor(library.root,targetAsset)
await mkdir(folder,{recursive:true})
const relative=file=>path.relative(repo,file).replaceAll('\\','/')
const report={id,name:'培训坐凳 · 单凳 · 白色空心款 H350',category:'软装道具',siVersion:'SI1.0',facing:'any',
  url:`/assets/su/${id}/model.glb`,unit:'m',upAxis:'Y',origin:'bottom-center',dimensions:checked.dimensions,
  source:relative(source),sourceSha256:sha256(bytes),glbSha256:sha256(output),bytes:output.length,
  expectedDimensions:expected,textures:{count:0},warnings:[],
  extraction:{sourceAssetId:sourceId,sourceSkp:sourceAsset.named_skp,sourceSkpSha256:sourceAsset.named_sha256,
    method:'meshopt 解码、dequantize 后按完整实例提取，保留三件网格及全部材质；不按连通体切割、不缩放',
    selectedInstance:selectedName,sourceInstances:measurements,translationM:offset,triangles:504},
  status:'converted-dimensions-checked-visual-review-pending',convertedAt:new Date().toISOString()}
await writeFile(path.join(folder,'model.glb'),output,{flag:'wx'})
await writeFile(path.join(folder,'conversion.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({id,bytes:output.length,dimensions:checked.dimensions,selectedInstance:selectedName}))
