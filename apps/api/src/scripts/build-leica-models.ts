import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Document } from '@gltf-transform/core'
import type { Material, Node, Primitive } from '@gltf-transform/core'
import { copyToDocument, dequantize, dedup, getBounds, prune } from '@gltf-transform/functions'
import { EXTMeshoptCompression } from '@gltf-transform/extensions'
import { z } from 'zod'
import { bounds, getIO, transform } from '../modules/assets/gltf-tools.ts'

// Outputs are isolated from the shared library. Publication is a separate, backed-up step.
const [sourceRoot, outputRoot] = process.argv.slice(2)
if (!sourceRoot || !outputRoot)
  throw new Error('用法：node build-leica-models.ts <资源库> <隔离输出>')
assert.notEqual(path.resolve(sourceRoot), path.resolve(outputRoot))
const relativeOutput = path.relative(path.resolve(sourceRoot), path.resolve(outputRoot))
assert(
  relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput),
  '输出必须在共享资源库之外',
)
const existingOutput = await stat(outputRoot).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== 'ENOENT') throw error
  return null
})
assert.equal(existingOutput, null, '输出目录已存在，请选择新的隔离目录')
const library = path.join(sourceRoot, '04_模型库')
const outputLibrary = path.join(outputRoot, '04_模型库')
const sourceManifest = await readFile(path.join(library, 'manifest.json'))
const manifest = z
  .looseObject({
    assets: z.array(
      z.looseObject({
        asset_id: z.string(),
        si_family: z.string(),
        match: z.string(),
        category: z.string(),
        web_model: z.string().nullish(),
      }),
    ),
  })
  .parse(JSON.parse(sourceManifest.toString('utf8')))
const sourceAsset = manifest.assets.find(
  (a: { asset_id: string }) => a.asset_id === 'asset-36929204',
)
assert(sourceAsset?.web_model)
const sourceBytes = await readFile(path.join(library, sourceAsset.web_model, 'model.glb'))
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const sourceRecord = z
  .object({ glbSha256: z.string() })
  .parse(
    JSON.parse(
      await readFile(path.join(library, sourceAsset.web_model, 'conversion.json'), 'utf8'),
    ),
  )
assert.equal(sha256(sourceBytes), sourceRecord.glbSha256, '源模型哈希与记录不符')
const io = await getIO()
const source = await io.readBinary(sourceBytes)
await source.transform(dequantize())

const sizes = { A: [410, 570], B: [730, 570], C: [1040, 570], D: [800, 1200] } as const
type Kind = keyof typeof sizes
type Frame = { kind: Kind; x: number; y: number; source: string }
const frame = (kind: Kind, x: number, y: number, source: string): Frame => ({ kind, x, y, source })
const specs = [
  { code: 'A', frames: [frame('A', 0, 0, 'group_17')], width: 410 },
  { code: 'B', frames: [frame('B', 0, 0, 'group_20')], width: 730 },
  { code: 'C', frames: [frame('C', 0, 0, 'group_3')], width: 1040 },
  { code: 'D', frames: [frame('D', 0, 0, 'group_18')], width: 800 },
  {
    code: '1200',
    width: 1200,
    frames: [
      frame('A', 0, 630, 'group_17'),
      frame('B', 470, 630, 'group_20'),
      frame('B', 0, 0, 'group_19'),
      frame('A', 790, 0, 'group_18'),
    ],
  },
  {
    code: '1990',
    width: 1990,
    frames: [
      frame('A', 0, 630, 'group_17'),
      frame('B', 470, 630, 'group_19'),
      frame('B', 1260, 630, 'group_20'),
      frame('B', 0, 0, 'group_3'),
      frame('B', 790, 0, 'group_7'),
      frame('A', 1580, 0, 'group_18'),
    ],
  },
  {
    code: '3000',
    width: 3000,
    frames: [
      frame('D', 0, 0, 'group_18'),
      frame('A', 860, 630, 'group_17'),
      frame('A', 1330, 630, 'group_18'),
      frame('B', 1800, 630, 'group_20'),
      frame('A', 2590, 630, 'group_17'),
      frame('C', 860, 0, 'group_3'),
      frame('C', 1960, 0, 'group_7'),
    ],
  },
]

/** The source front face carries SketchUp's repeat UVs; preserve them and its material. */
function artwork(name: string): { node: Node; primitive: Primitive; material: Material } {
  const group = source
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === name)
  assert(group, `缺少源画框 ${name}`)
  for (const node of group.listChildren()) {
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const material = primitive.getMaterial()
      if (material?.getBaseColorTexture()) return { node, primitive, material }
    }
  }
  throw new Error(`源画框无画面 ${name}`)
}

const reports = []
for (const [index, spec] of specs.entries()) {
  const id = `asset-${90000101 + index}`
  assert(!manifest.assets.some((a: { asset_id: string }) => a.asset_id === id), `编号已使用 ${id}`)
  const single = spec.frames.length === 1
  const [singleWidth, singleHeight] = sizes[spec.frames[0]!.kind]
  const height = single ? singleHeight : 1200
  const counts = spec.frames.reduce<Record<string, number>>((all, item) => {
    all[item.kind] = (all[item.kind] ?? 0) + 1
    return all
  }, {})
  const expectedCounts: Record<string, Record<string, number>> = {
    '1200': { A: 2, B: 2 },
    '1990': { A: 2, B: 4 },
    '3000': { A: 3, B: 1, C: 2, D: 1 },
  }
  if (!single) assert.deepEqual(counts, expectedCounts[spec.code], '组合数量不符')
  for (const [i, a] of spec.frames.entries()) {
    const [aw, ah] = sizes[a.kind]
    assert(a.x >= 0 && a.y >= 0 && a.x + aw <= spec.width && a.y + ah <= height)
    for (const b of spec.frames.slice(i + 1)) {
      const [bw, bh] = sizes[b.kind]
      const dx = Math.max(b.x - a.x - aw, a.x - b.x - bw)
      const dy = Math.max(b.y - a.y - ah, a.y - b.y - bh)
      assert(dx >= 60 || dy >= 60, '画框重叠或间距小于60毫米')
    }
  }
  const name = single
    ? `徕卡墙画框 ${spec.code} ${singleWidth}×${singleHeight}`
    : `徕卡墙画框组合 ${spec.code}`
  const folder = `软装道具/SI2.0/${single ? `徕卡墙画框_${spec.code}_${singleWidth}x${singleHeight}` : `徕卡墙画框组合_${spec.code}`}__${id}`
  const target = path.join(outputLibrary, folder)
  await mkdir(path.join(target, '网页模型'), { recursive: true })
  const document = new Document()
  const buffer = document.createBuffer()
  const scene = document.createScene(name)
  document.getRoot().setDefaultScene(scene)
  const metal = document
    .createMaterial('苹果银铝合金边框')
    .setBaseColorFactor([0.65, 0.66, 0.68, 1])
    .setMetallicFactor(0.65)
    .setRoughnessFactor(0.35)
  const back = document
    .createMaterial('KT背板')
    .setBaseColorFactor([0.2, 0.2, 0.2, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.9)
  function primitive(
    positions: number[],
    normals: number[],
    indices: number[],
    material: Material,
    uv?: number[],
  ) {
    const p = document
      .createPrimitive()
      .setAttribute(
        'POSITION',
        document
          .createAccessor()
          .setType('VEC3')
          .setArray(new Float32Array(positions))
          .setBuffer(buffer),
      )
      .setAttribute(
        'NORMAL',
        document
          .createAccessor()
          .setType('VEC3')
          .setArray(new Float32Array(normals))
          .setBuffer(buffer),
      )
      .setIndices(
        document
          .createAccessor()
          .setType('SCALAR')
          .setArray(new Uint16Array(indices))
          .setBuffer(buffer),
      )
      .setMaterial(material)
    if (uv)
      p.setAttribute(
        'TEXCOORD_0',
        document.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer),
      )
    return p
  }
  function box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: Material,
    parent: Node,
  ) {
    const points = [
      [-w / 2, -h / 2, -d / 2],
      [w / 2, -h / 2, -d / 2],
      [w / 2, h / 2, -d / 2],
      [-w / 2, h / 2, -d / 2],
      [-w / 2, -h / 2, d / 2],
      [w / 2, -h / 2, d / 2],
      [w / 2, h / 2, d / 2],
      [-w / 2, h / 2, d / 2],
    ]
    const faces = [
      [4, 5, 6, 7],
      [1, 0, 3, 2],
      [5, 1, 2, 6],
      [0, 4, 7, 3],
      [7, 6, 2, 3],
      [0, 1, 5, 4],
    ]
    const directions = [
      [0, 0, 1],
      [0, 0, -1],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
    ]
    const positions: number[] = [],
      normals: number[] = [],
      indices: number[] = []
    for (const [i, face] of faces.entries()) {
      for (const corner of face) {
        positions.push(...points[corner]!)
        normals.push(...directions[i]!)
      }
      const n = i * 4
      indices.push(n, n + 1, n + 2, n, n + 2, n + 3)
    }
    parent.addChild(
      document
        .createNode()
        .setTranslation([x, y, z])
        .setMesh(
          document.createMesh().addPrimitive(primitive(positions, normals, indices, material)),
        ),
    )
  }
  for (const [i, f] of spec.frames.entries()) {
    const [wmm, hmm] = sizes[f.kind]
    const w = wmm / 1000,
      h = hmm / 1000,
      edge = 0.005,
      depth = 0.025
    const root = document
      .createNode(`${f.kind}-${i + 1}`)
      .setTranslation([(f.x + wmm / 2 - spec.width / 2) / 1000, f.y / 1000, 0])
    scene.addChild(root)
    box(w, edge, depth, 0, edge / 2, 0, metal, root)
    box(w, edge, depth, 0, h - edge / 2, 0, metal, root)
    box(edge, h - 2 * edge, depth, -w / 2 + edge / 2, h / 2, 0, metal, root)
    box(edge, h - 2 * edge, depth, w / 2 - edge / 2, h / 2, 0, metal, root)
    box(w - 2 * edge, h - 2 * edge, 0.002, 0, h / 2, -0.0115, back, root)
    const art = artwork(f.source)
    const material = copyToDocument(document, source, [art.material]).get(art.material) as Material
    material.setMetallicFactor(0).setRoughnessFactor(0.8)
    const pos = art.primitive.getAttribute('POSITION')!,
      tex = art.primitive.getAttribute('TEXCOORD_0')!
    const world = art.node.getWorldMatrix(),
      b = getBounds(art.node)
    const corners: { x: number; y: number; uv: number[] }[] = []
    for (let j = 0; j < pos.getCount(); j++) {
      const p = transform(world, pos.getElement(j, [0, 0, 0]))
      corners.push({ x: p[0], y: p[1], uv: tex.getElement(j, [0, 0]) })
    }
    const corner = (right: boolean, top: boolean) =>
      corners.reduce((best, c) => {
        const distance = (p: typeof c) =>
          Math.abs(p.x - (right ? b.max[0] : b.min[0])) +
          Math.abs(p.y - (top ? b.max[1] : b.min[1]))
        return distance(c) < distance(best) ? c : best
      }).uv
    const bl = corner(false, false),
      br = corner(true, false),
      tl = corner(false, true)
    const sourceRatio = (b.max[0] - b.min[0]) / (b.max[1] - b.min[1]),
      ratio = (w - 2 * edge) / (h - 2 * edge)
    const sx = Math.min(1, ratio / sourceRatio),
      sy = Math.min(1, sourceRatio / ratio)
    const uvAt = (x: number, y: number) => {
      const u = 0.5 + (x - 0.5) * sx,
        v = 0.5 + (y - 0.5) * sy
      return [
        bl[0]! + (br[0]! - bl[0]!) * u + (tl[0]! - bl[0]!) * v,
        bl[1]! + (br[1]! - bl[1]!) * u + (tl[1]! - bl[1]!) * v,
      ]
    }
    root.addChild(
      document
        .createNode('画面')
        .setMesh(
          document
            .createMesh()
            .addPrimitive(
              primitive(
                [
                  -w / 2 + edge,
                  edge,
                  0.011,
                  w / 2 - edge,
                  edge,
                  0.011,
                  w / 2 - edge,
                  h - edge,
                  0.011,
                  -w / 2 + edge,
                  h - edge,
                  0.011,
                ],
                [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
                [0, 1, 2, 0, 2, 3],
                material,
                [...uvAt(0, 0), ...uvAt(1, 0), ...uvAt(1, 1), ...uvAt(0, 1)],
              ),
            ),
        ),
    )
  }
  await document.transform(dedup(), prune())
  const expected = { w: spec.width / 1000, d: 0.025, h: height / 1000 }
  const validate = (doc: Document) => {
    const b = bounds(doc),
      actual = { w: b.max[0]! - b.min[0]!, d: b.max[2]! - b.min[2]!, h: b.max[1]! - b.min[1]! }
    for (const axis of ['w', 'd', 'h'] as const)
      assert(Math.abs(actual[axis] - expected[axis]) < 0.00001, `${id} ${axis}尺寸错误`)
    assert(
      Math.abs(b.min[1]!) < 0.00001 &&
        Math.abs(b.min[0]! + b.max[0]!) < 0.00001 &&
        Math.abs(b.min[2]! + b.max[2]!) < 0.00001,
    )
  }
  validate(document)
  document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER })
  const bytes = await io.writeBinary(document)
  validate(await io.readBinary(bytes))
  await writeFile(path.join(target, '网页模型/model.glb'), bytes, { flag: 'wx' })
  const composition = spec.frames.map((f) => ({
    ...f,
    width: sizes[f.kind][0],
    height: sizes[f.kind][1],
  }))
  const record = {
    id,
    name,
    unit: 'm',
    upAxis: 'Y',
    origin: 'bottom-center',
    facing: '+Z',
    dimensions: expected,
    bytes: bytes.length,
    glbSha256: sha256(bytes),
    source: 'asset-36929204/model.glb',
    sourceSha256: sha256(sourceBytes),
    textures: { count: document.getRoot().listTextures().length },
    compression: { method: 'EXT_meshopt_compression', dimensionsChecked: true },
    construction: {
      frameDepthMm: 25,
      borderMm: 5,
      gapMm: 60,
      composition,
      artwork:
        '原模型材质与重复UV，按原画面比例居中裁切适配；按SI2:127–129重建标准框体，C/D为补建规格；组合仅含画框',
    },
    status: 'dimensions-checked-visual-review-pending',
  }
  await writeFile(
    path.join(target, '网页模型/conversion.json'),
    JSON.stringify(record, null, 2) + '\n',
  )
  const symbol = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} 25"><rect x="0.5" y="0.5" width="${spec.width - 1}" height="24" fill="none" stroke="black"/></svg>`
  await writeFile(path.join(target, '平面图.svg'), symbol)
  manifest.assets.push({
    n: manifest.assets.length + 1,
    asset_id: id,
    si_family: 'SI2.0',
    standard_name: single ? '徕卡墙画面' : '徕卡墙画面组合',
    display_name: name,
    variant: single ? `${spec.code}_${singleWidth}x${singleHeight}` : spec.code,
    match: '对应',
    confidence: '标准详图尺寸',
    reference_pages: 'SI2:127-129',
    judgment: record.construction.artwork,
    material_category: '软装物料',
    category: '软装道具',
    category_si: 'SI2.0',
    folder,
    tight_face_bounds_xyz_mm: [spec.width, 25, height],
    web_model: `${folder}/网页模型`,
    preview: `${folder}/预览.png`,
    product_image: `${folder}/预览.png`,
    product_image_source: `软装道具/SI2.0/品类图库/01_道具图片PNG/${id}.png`,
    product_image_match: 'exact',
    plan_symbol: { svg: `${folder}/平面图.svg`, png: null },
    plan_symbol_source: { svg: `软装道具/SI2.0/品类图库/03_平面图SVG/${id}.svg`, png: null },
    composition,
  })
  reports.push({ id, name, folder, ...expected, bytes: bytes.length, frames: composition })
  console.log(`${id} ${name} ${bytes.length} bytes`)
}
await mkdir(outputLibrary, { recursive: true })
for (const [field, property] of [
  ['counts_by_si', 'si_family'],
  ['counts_by_match', 'match'],
  ['counts_by_category', 'category'],
] as const) {
  manifest[field] = manifest.assets.reduce<Record<string, number>>((counts, asset) => {
    const key = asset[property]
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
}
await writeFile(path.join(outputLibrary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
const facing = z
  .looseObject({ assets: z.record(z.string(), z.unknown()) })
  .parse(JSON.parse(await readFile(path.join(library, 'facing.json'), 'utf8')))
for (const r of reports)
  facing.assets[r.id] = {
    front: '+Z',
    confidence: 'high',
    installation: 'wall',
    note: '标准画框，正面+Z；底部中心原点；外尺寸按SI2:127–129',
  }
await writeFile(path.join(outputLibrary, 'facing.json'), JSON.stringify(facing, null, 2) + '\n')
await writeFile(
  path.join(outputRoot, 'build-report.json'),
  JSON.stringify(
    {
      sourceManifestSha256: sha256(sourceManifest),
      sourceGlbSha256: sha256(sourceBytes),
      models: reports,
    },
    null,
    2,
  ) + '\n',
)
