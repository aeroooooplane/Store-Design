import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import { sha256File } from '../lib/storage.ts'

// Removes stray flat faces (zero thickness) that stick out of a web model's real body, then
// re-centres the model on its new bounding box (origin stays bottom-centre) and updates
// conversion.json. Afterwards rebuild the white model (pnpm catalog:white <asset-id>) and
// re-import the catalogue.
// Usage: trim-glb-parts.ts <网页模型目录> --box minX,minZ,maxX,maxZ (mm) --note "原因"
const args = process.argv.slice(2)
const dir = args[0]
const boxArg = args[args.indexOf('--box') + 1]
const note = args.includes('--note') ? (args[args.indexOf('--note') + 1] ?? '') : ''
if (!dir || !args.includes('--box') || !boxArg) {
  throw new Error('usage: trim-glb-parts.ts <dir> --box minX,minZ,maxX,maxZ --note "…"')
}
const [minX, minZ, maxX, maxZ] = boxArg.split(',').map((v) => Number(v) / 1000)
if ([minX, minZ, maxX, maxZ].some((v) => v === undefined || !Number.isFinite(v))) {
  throw new Error('--box needs four numbers in millimetres')
}
const FLAT_M = 0.001
const TOLERANCE_M = 0.002

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
})
const glbPath = path.join(dir, 'model.glb')
const document = await io.read(glbPath)
const root = document.getRoot()
const scene = root.getDefaultScene() ?? root.listScenes()[0]
if (!scene) throw new Error('no scene')

const removed: string[] = []
for (const node of root.listNodes()) {
  if (!node.getMesh()) continue
  const { min, max } = getBounds(node)
  const flat = (max[1] ?? 0) - (min[1] ?? 0) < FLAT_M
  const outside =
    (min[0] ?? 0) < (minX ?? 0) - TOLERANCE_M ||
    (max[0] ?? 0) > (maxX ?? 0) + TOLERANCE_M ||
    (min[2] ?? 0) < (minZ ?? 0) - TOLERANCE_M ||
    (max[2] ?? 0) > (maxZ ?? 0) + TOLERANCE_M
  if (flat && outside) {
    const mm = (v: number | undefined) => Math.round((v ?? 0) * 1000)
    removed.push(
      `x ${mm(min[0])}..${mm(max[0])} z ${mm(min[2])}..${mm(max[2])} 高 ${mm(min[1])} mm`,
    )
    node.dispose()
  }
}
if (!removed.length) throw new Error('nothing to remove inside the given limits')

// Re-centre: bottom-centre origin on the trimmed box.
const before = getBounds(scene)
const shift = [
  -((before.min[0] ?? 0) + (before.max[0] ?? 0)) / 2,
  -(before.min[1] ?? 0),
  -((before.min[2] ?? 0) + (before.max[2] ?? 0)) / 2,
] as const
for (const child of scene.listChildren()) {
  const [x, y, z] = child.getTranslation()
  child.setTranslation([x + shift[0], y + shift[1], z + shift[2]])
}
await document.transform(prune())
await io.write(glbPath, document)

const after = getBounds(scene)
const dimensions = {
  w: (after.max[0] ?? 0) - (after.min[0] ?? 0),
  h: (after.max[1] ?? 0) - (after.min[1] ?? 0),
  d: (after.max[2] ?? 0) - (after.min[2] ?? 0),
}
const conversionPath = path.join(dir, 'conversion.json')
const conversion = JSON.parse(await readFile(conversionPath, 'utf8')) as Record<string, unknown>
const bytes = (await readFile(glbPath)).length
const updated = {
  ...conversion,
  dimensions,
  glbSha256: await sha256File(glbPath),
  bytes,
  trimmed: {
    at: new Date().toISOString(),
    note,
    removedFlatParts: removed,
    dimensionsBefore: conversion['dimensions'],
    shiftM: shift.map((v) => Math.round(v * 10000) / 10000),
  },
}
await writeFile(conversionPath, `${JSON.stringify(updated, null, 2)}\n`)
console.log(`去掉 ${removed.length} 块：\n  ${removed.join('\n  ')}`)
console.log(
  `新尺寸 ${Math.round(dimensions.w * 1000)} × ${Math.round(dimensions.d * 1000)} × ${Math.round(dimensions.h * 1000)} mm，${Math.round(bytes / 1024)} KB`,
)
