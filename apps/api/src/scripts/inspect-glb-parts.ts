// Lists the parts of a GLB with their bounding boxes (mm), largest X extent first.
// Usage: node --experimental-strip-types src/scripts/inspect-glb-parts.ts <model.glb>
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { getBounds } from '@gltf-transform/core'
import { MeshoptDecoder } from 'meshoptimizer'

const [file] = process.argv.slice(2)
if (!file) throw new Error('usage: inspect-glb-parts.ts <model.glb>')
await MeshoptDecoder.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const document = await io.read(file)
const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0]
if (!scene) throw new Error('no scene')
const mm = (v: number) => Math.round(v * 1000)
const all = getBounds(scene)
console.log(
  'whole',
  all.min.map(mm),
  all.max.map(mm),
  'size',
  all.max.map((v, i) => mm(v - (all.min[i] ?? 0))),
)
const rows: { name: string; min: number[]; max: number[]; material: string }[] = []
for (const node of document.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const b = getBounds(node)
  const material = mesh
    .listPrimitives()
    .map((p) => p.getMaterial()?.getName() ?? '')
    .join('/')
  rows.push({
    name: node.getName() || mesh.getName(),
    min: b.min.map(mm),
    max: b.max.map(mm),
    material,
  })
}
rows.sort((a, b) => (b.max[0] ?? 0) - (b.min[0] ?? 0) - ((a.max[0] ?? 0) - (a.min[0] ?? 0)))
for (const r of rows.slice(0, 25)) {
  console.log(
    `${r.name.slice(0, 40).padEnd(40)} x ${r.min[0]}..${r.max[0]} (${(r.max[0] ?? 0) - (r.min[0] ?? 0)})  y ${r.min[1]}..${r.max[1]}  z ${r.min[2]}..${r.max[2]}  ${r.material}`,
  )
}
console.log('parts', rows.length)
