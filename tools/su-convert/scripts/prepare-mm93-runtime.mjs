// Creates an isolated runtime candidate; never writes to the shared catalogue.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'
import { buildFinishModel, PRESERVE_APPEARANCE } from '../../../apps/api/src/modules/assets/finish-models.ts'
import { buildWhiteModel } from '../../../apps/api/src/modules/assets/white-models.ts'
import { getIO } from '../../../apps/api/src/modules/assets/gltf-tools.ts'

const [source, output] = process.argv.slice(2)
if (!source || !output) throw Error('Usage: node prepare-mm93-runtime.mjs original.glb NEW-output-directory')
const bytes = await readFile(source)
const hash = (value) => createHash('sha256').update(value).digest('hex')
assert.equal(hash(bytes), '46ed38fb4e5a774e91e10264b20874a4c0a8584e655b5c680792c9b9e8700fef', 'Unexpected Tripo source')
await mkdir(output, { recursive: false })
// Append opt-in metadata only. The entire original BIN chunk stays byte-for-byte unchanged.
const jsonLength = bytes.readUInt32LE(12)
const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'))
for (const material of json.materials) material.extras = { ...material.extras, [PRESERVE_APPEARANCE]: true }
const text = Buffer.from(JSON.stringify(json))
const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20)
text.copy(padded)
const binary = bytes.subarray(20 + jsonLength)
const header = Buffer.from(bytes.subarray(0, 20))
header.writeUInt32LE(20 + padded.length + binary.length, 8)
header.writeUInt32LE(padded.length, 12)
const model = path.join(output, 'model.glb')
await writeFile(model, Buffer.concat([header, padded, binary]), { flag: 'wx' })
const finish = await buildFinishModel(model, path.join(output, 'finish.glb'))
const white = await buildWhiteModel(model, path.join(output, 'white.glb'))
const io = await getIO()
const before = await io.readBinary(bytes)
const after = await io.read(path.join(output, 'finish.glb'))
const primitives = (doc) => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())
const a = primitives(before), b = primitives(after)
assert.equal(b.length, a.length)
let cyclicIndexRotations = 0
for (let i = 0; i < a.length; i++) {
  assert.deepEqual(b[i].listSemantics(), a[i].listSemantics())
  for (const semantic of a[i].listSemantics()) {
    const x = a[i].getAttribute(semantic), y = b[i].getAttribute(semantic)
    assert.equal(y.getType(), x.getType())
    assert.deepEqual(y.getArray(), x.getArray(), `${semantic} changed`)
  }
  const x = a[i].getIndices()?.getArray(), y = b[i].getIndices()?.getArray()
  assert.equal(y?.length, x?.length)
  for (let j = 0; x && j < x.length; j += 3) {
    const rotation = [0, 1, 2].find((r) => [0, 1, 2].every((k) => y[j + k] === x[j + (k + r) % 3]))
    assert.notEqual(rotation, undefined, `Triangle ${j / 3} changed`)
    if (rotation) cyclicIndexRotations++
  }
}
const appearance = (doc) => doc.getRoot().listMaterials().map((m) => ({
  name: m.getName(), color: m.getBaseColorFactor(), roughness: m.getRoughnessFactor(),
  metallic: m.getMetallicFactor(), doubleSided: m.getDoubleSided(), alpha: m.getAlphaMode(),
  alphaCutoff: m.getAlphaCutoff(), emissive: m.getEmissiveFactor(), normalScale: m.getNormalScale(),
  occlusion: m.getOcclusionStrength(),
  textures: ['BaseColor', 'Normal', 'MetallicRoughness', 'Occlusion', 'Emissive'].map((slot) => {
    const texture = m[`get${slot}Texture`]()
    const info = m[`get${slot}TextureInfo`]()
    return texture ? { sha256: hash(texture.getImage()), size: texture.getSize(),
      texCoord: info.getTexCoord(), min: info.getMinFilter(), mag: info.getMagFilter(),
      wrapS: info.getWrapS(), wrapT: info.getWrapT() } : null
  }),
}))
assert.deepEqual(appearance(after), appearance(before), 'Original texture bytes or PBR state changed')
assert.deepEqual(before.getRoot().listNodes().map((n) => n.getMatrix()), after.getRoot().listNodes().map((n) => n.getMatrix()))
await writeFile(path.join(output, 'finish.json'), JSON.stringify(finish, null, 2), { flag: 'wx' })
await writeFile(path.join(output, 'white.json'), JSON.stringify(white, null, 2), { flag: 'wx' })
const report = { sourceSha256: hash(bytes), sourceBytes: bytes.length, finish, white,
  exactFloatAttributes: true, sameTrianglesAndWinding: true, cyclicIndexRotations,
  exactTextureBytesAndPbr: true, nodeTransformsUnchanged: true,
  appearance: appearance(after), productionPublished: false }
await writeFile(path.join(output, 'runtime-validation.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ sourceBytes: bytes.length, finishBytes: finish.bytes, whiteBytes: white.bytes,
  whiteTriangles: white.trianglesAfter, finishTriangles: finish.trianglesAfter, passed: true }))
