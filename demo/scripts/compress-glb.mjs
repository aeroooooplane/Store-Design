// Geometry compression for converted web models (EXT_meshopt_compression + quantisation).
// Lossless steps first (dedup, weld), then meshopt. Every result is re-read, decoded and measured;
// it replaces model.glb only if size and bottom-centre origin still match conversion.json within 1 mm.
// Usage: node scripts/compress-glb.mjs [asset-id ...]   (no ids = every converted asset not yet compressed)
import {readdir,readFile,rename,rm,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {dedup,meshopt,prune,weld} from '@gltf-transform/functions'
import {MeshoptDecoder,MeshoptEncoder} from 'meshoptimizer'

const TOOL='@gltf-transform/core@4.5.1 + meshoptimizer@1.3.0'
// 16-bit positions (≈0.03 mm over 2 m): the 14-bit default collapses the sub-0.1 mm gap between
// logo decals and the panel behind them, which then z-fight.
const POSITION_BITS=16
const STEPS=['dedup','weld','prune',`meshopt(level=medium, position=${POSITION_BITS}bit)`]
const TOLERANCE_M=.001

const demo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=path.dirname(demo)
const models=path.join(repo,'资源库/04_软装道具模型/网页模型')
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex')

await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready])
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder,
})

/** World-space AABB of all triangle meshes, with quantised positions decoded. */
function meshBounds(document){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],p=[0,0,0]
  for(const node of document.getRoot().listNodes()){
    const mesh=node.getMesh();if(!mesh)continue
    const m=node.getWorldMatrix()
    for(const prim of mesh.listPrimitives()){
      if(prim.getMode()!==4)throw Error('Non-triangle primitive found')
      const position=prim.getAttribute('POSITION');if(!position)continue
      for(let i=0;i<position.getCount();i++){
        position.getElement(i,p) // denormalised for quantised accessors
        for(let axis=0;axis<3;axis++){
          const v=m[axis]*p[0]+m[4+axis]*p[1]+m[8+axis]*p[2]+m[12+axis]
          if(v<min[axis])min[axis]=v
          if(v>max[axis])max[axis]=v
        }
      }
    }
  }
  if(!min.every(Number.isFinite))throw Error('Model has no geometry')
  return {min,max}
}

function checkShape(bounds,expected,label){
  const size={w:bounds.max[0]-bounds.min[0],h:bounds.max[1]-bounds.min[1],d:bounds.max[2]-bounds.min[2]}
  for(const k of ['w','d','h'])if(Math.abs(size[k]-expected[k])>TOLERANCE_M)throw Error(`${label}: ${k} ${size[k]} ≠ ${expected[k]}`)
  if(Math.abs(bounds.min[1])>TOLERANCE_M)throw Error(`${label}: bottom not at y=0`)
  if(Math.abs(bounds.min[0]+bounds.max[0])>2*TOLERANCE_M||Math.abs(bounds.min[2]+bounds.max[2])>2*TOLERANCE_M)throw Error(`${label}: not centred`)
  return size
}

const requested=process.argv.slice(2)
const ids=requested.length?requested:(await readdir(models)).filter(name=>/^asset-\d+$/.test(name)).sort()
let before=0,after=0
for(const id of ids){
  const dir=path.join(models,id),glbPath=path.join(dir,'model.glb'),reportPath=path.join(dir,'conversion.json')
  const report=JSON.parse(await readFile(reportPath,'utf8'))
  if(report.compression){if(requested.length)throw Error(`${id} is already compressed`);continue}
  // Temp files can only be left by a crash between write and rename; the originals are still valid.
  for(const file of [glbPath,reportPath])await rm(file+'.tmp',{force:true})
  const original=await readFile(glbPath)
  if(sha256(original)!==report.glbSha256||original.length!==report.bytes)throw Error(`${id}: model.glb does not match conversion.json`)

  const document=await io.readBinary(original)
  checkShape(meshBounds(document),report.dimensions,`${id} before`)
  await document.transform(dedup(),weld(),prune(),meshopt({encoder:MeshoptEncoder,level:'medium',quantizePosition:POSITION_BITS}))
  const compressed=Buffer.from(await io.writeBinary(document))

  // Measure what a browser will see: decode the written file from scratch.
  const size=checkShape(meshBounds(await io.readBinary(compressed)),report.dimensions,`${id} after`)

  const next={...report,bytes:compressed.length,glbSha256:sha256(compressed),
    compression:{tool:TOOL,steps:STEPS,requires:'EXT_meshopt_compression, KHR_mesh_quantization',
      bytesBefore:original.length,glbSha256Before:report.glbSha256,dimensionsAfter:size,compressedAt:new Date().toISOString()}}
  // Write both files beside the originals, then swap; a failure leaves the original pair intact.
  await writeFile(glbPath+'.tmp',compressed,{flag:'wx'})
  await writeFile(reportPath+'.tmp',JSON.stringify(next,null,2)+'\n',{flag:'wx'})
  await rename(glbPath+'.tmp',glbPath)
  await rename(reportPath+'.tmp',reportPath)
  before+=original.length;after+=compressed.length
  console.log(`${id}: ${(original.length/1048576).toFixed(1)} MB → ${(compressed.length/1048576).toFixed(1)} MB`)
}
if(before)console.log(`Total ${(before/1048576).toFixed(0)} MB → ${(after/1048576).toFixed(0)} MB`)
