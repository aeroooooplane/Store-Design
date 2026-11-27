import {readFile,writeFile,access} from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {dedup,weld,prune,simplify,meshopt,getBounds} from '@gltf-transform/functions'
import {MeshoptDecoder,MeshoptEncoder,MeshoptSimplifier} from 'meshoptimizer'

const [inputArg,outArg]=process.argv.slice(2)
if(!inputArg||!outArg)throw Error('Usage: node optimize-mm93.mjs input.glb output.glb')
const input=path.resolve(inputArg),out=path.resolve(outArg)
if(input===out)throw Error('Source must remain unchanged')
for(const file of [out,out+'.json'])try{await access(file);throw Error('Output already exists: '+file)}catch(e){if(e.code!=='ENOENT')throw e}
await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready,MeshoptSimplifier.ready])
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder})
const bytes=await readFile(input),doc=await io.readBinary(bytes)
const hash=b=>createHash('sha256').update(b).digest('hex')
const triangles=d=>d.getRoot().listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((n,p)=>n+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0)
const bounds=d=>getBounds(d.getRoot().listScenes()[0])
const before={bytes:bytes.length,sha256:hash(bytes),triangles:triangles(doc),bounds:bounds(doc)}
await doc.transform(dedup(),weld(),simplify({simplifier:MeshoptSimplifier,ratio:.25,error:.0005}),prune(),meshopt({encoder:MeshoptEncoder,level:'medium',quantizePosition:16}))
const encoded=await io.writeBinary(doc),check=await io.readBinary(encoded),after={bytes:encoded.length,sha256:hash(encoded),triangles:triangles(check),bounds:bounds(check)}
for(const end of ['min','max'])for(let axis=0;axis<3;axis++)if(Math.abs(before.bounds[end][axis]-after.bounds[end][axis])>.001)throw Error('Bounds drift exceeds 1mm')
if(after.triangles>=before.triangles||after.bytes>=before.bytes)throw Error('Optimization did not reduce the draft')
await writeFile(out,encoded,{flag:'wx'})
await writeFile(out+'.json',JSON.stringify({before,after,operations:['weld','simplify ratio .25 error .0005','meshopt 16-bit position'],notes:['Lossy reduction is subject to visual review','Existing material textures retained','Display scale is provisional']},null,2),{flag:'wx'})
console.log(JSON.stringify({before,after}))
