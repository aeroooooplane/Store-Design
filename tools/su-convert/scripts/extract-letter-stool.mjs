// 从四张字母凳中保留完整的450mm实例；只在隔离资源目录生成，不写共享源。
import {readFile,realpath,mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {dequantize,prune} from '@gltf-transform/functions'
import {MeshoptDecoder} from 'meshoptimizer'
import {readLibrary,webModelDirFor} from '../server/model-library-paths.mjs'

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..')
const sourceId='asset-15903874',id='asset-90000003'
const expected={w:.45,d:.45,h:.45}
const expectedSourceSha='e73311a01e665cbf9f0e57b8e89aa7c6889b3a6ee8bdf82efc35356a019a76c6'
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex')
if(!process.env.RESOURCE_ROOT)throw Error('请显式设置隔离 RESOURCE_ROOT，禁止直接重建共享资源')
const library=await readLibrary(repo)
if(await realpath(library.root)===await realpath(path.join(repo,'资源库/04_模型库')))throw Error('RESOURCE_ROOT必须与共享资源目录隔离')
const sourceAsset=library.manifest.assets.find(a=>a.asset_id===sourceId)
const targetAsset=library.manifest.assets.find(a=>a.asset_id===id)
if(!sourceAsset?.web_model||!targetAsset)throw Error('缺少字母凳组合或单凳manifest条目')
const source=path.join(library.root,sourceAsset.web_model,'model.glb')
const bytes=await readFile(source)
const sourceRecord=JSON.parse(await readFile(path.join(path.dirname(source),'conversion.json'),'utf8'))
if(sha256(bytes)!==expectedSourceSha||sha256(bytes)!==sourceRecord.glbSha256||bytes.length!==sourceRecord.bytes)throw Error('组合GLB与已验收源或conversion不一致')
const skp=await readFile(path.join(library.root,sourceAsset.named_skp))
if(sha256(skp)!==sourceAsset.named_sha256)throw Error('源SKP与manifest不一致')

await MeshoptDecoder.ready
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder})
const document=await io.readBinary(bytes)
await document.transform(dequantize())
for(const ext of document.getRoot().listExtensionsUsed())if(ext.extensionName==='EXT_meshopt_compression')ext.dispose()
function meshNodes(node){return [node,...node.listChildren().flatMap(meshNodes)].filter(n=>n.getMesh())}
function bounds(nodes){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],p=[]
  let triangles=0
  for(const n of nodes){
    const matrix=n.getWorldMatrix()
    for(const primitive of n.getMesh().listPrimitives()){
      if(primitive.getMode()!==4)throw Error('源模型含非三角面')
      const position=primitive.getAttribute('POSITION'),indices=primitive.getIndices()
      const count=indices?.getCount()??position.getCount()
      triangles+=count/3
      for(let i=0;i<count;i++){
        position.getElement(indices?indices.getScalar(i):i,p)
        for(let axis=0;axis<3;axis++){
          const value=matrix[axis]*p[0]+matrix[4+axis]*p[1]+matrix[8+axis]*p[2]+matrix[12+axis]
          min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value)
        }
      }
    }
  }
  if(!min.every(Number.isFinite))throw Error('模型无有效网格')
  return {min,max,dimensions:{w:max[0]-min[0],h:max[1]-min[1],d:max[2]-min[2]},triangles}
}
const groups=document.getRoot().listNodes().filter(n=>n.getName()==='group_0')
if(groups.length!==1)throw Error('组合根实例不唯一')
const instances=groups[0].listChildren()
if(instances.length!==4)throw Error('源组合不是四张完整凳')
const measurements=instances.map(n=>{
  const meshes=meshNodes(n),box=bounds(meshes)
  if(meshes.length!==2||box.triangles!==576)throw Error('凳体或软垫部件发生变化')
  return {instance:n.getName(),scale:n.getScale(),...box}
})
// 首张在源组合中被竖向压至421.875mm；选择未变形的450mm完整实例，不放大或拉伸。
const selected=instances.find(n=>n.getName()==='SketchUp_Instance_1')
if(!selected||selected.getScale().some(v=>Math.abs(v-1)>1e-6))throw Error('未找到未变形的完整单凳')
const selectedName=selected.getName(),world=selected.getWorldMatrix()
const alignAngle=-Math.atan2(-world[2],world[0])
const keep=new Set()
function retain(n){keep.add(n);n.listChildren().forEach(retain)}
retain(selected);selected.getParentNode().removeChild(selected);selected.setMatrix(world)
for(const n of document.getRoot().listNodes())if(!keep.has(n))n.dispose()
const root=document.createNode('字母凳单张 · 450mm').setRotation([0,Math.sin(alignAngle/2),0,Math.cos(alignAngle/2)]).addChild(selected)
const scene=document.getRoot().listScenes()[0]
scene.addChild(root);document.getRoot().setDefaultScene(scene)
const box=bounds(meshNodes(root))
const offset=[-(box.min[0]+box.max[0])/2,-box.min[1],-(box.min[2]+box.max[2])/2]
root.setTranslation(offset)
await document.transform(prune())
const output=Buffer.from(await io.writeBinary(document))
const reloaded=await io.readBinary(output),meshes=reloaded.getRoot().listNodes().filter(n=>n.getMesh()),checked=bounds(meshes)
for(const key of ['w','d','h'])if(Math.abs(checked.dimensions[key]-expected[key])>.001)throw Error('回读尺寸失败')
if(meshes.length!==2||checked.triangles!==576)throw Error('回读部件或三角面不完整')
if(Math.abs(checked.min[1])>1e-6||Math.abs(checked.min[0]+checked.max[0])>1e-6||Math.abs(checked.min[2]+checked.max[2])>1e-6)throw Error('底部中心原点校验失败')
const folder=webModelDirFor(library.root,targetAsset)
await mkdir(folder,{recursive:true})
const report={id,name:'字母凳 · 单凳',category:'软装道具',siVersion:'SI2.0',facing:'any',
  url:`/assets/su/${id}/model.glb`,unit:'m',upAxis:'Y',origin:'bottom-center',dimensions:checked.dimensions,
  source:`资源库/04_模型库/${sourceAsset.web_model}/model.glb`,sourceSha256:sha256(bytes),glbSha256:sha256(output),bytes:output.length,
  expectedDimensions:expected,textures:{count:reloaded.getRoot().listTextures().length},warnings:[],
  extraction:{sourceAssetId:sourceId,sourceSkp:sourceAsset.named_skp,sourceSkpSha256:sha256(skp),
    method:'完整凳体与软垫实例提取，保留材质和贴图；仅水平转正及底部居中，不缩放、不按连通体切割',
    selectedInstance:selectedName,sourceInstances:measurements,rotationYRad:alignAngle,translationM:offset,triangles:576,
    nativeSkpNote:'本机无SketchUp；由已验证GLB完整实例拆分，未生成独立SKP，原组合SKP不变'},
  status:'converted-dimensions-checked-visual-review-pending',convertedAt:new Date().toISOString()}
await writeFile(path.join(folder,'model.glb'),output,{flag:'wx'})
await writeFile(path.join(folder,'conversion.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({id,bytes:output.length,dimensions:checked.dimensions,selectedInstance:selectedName}))
