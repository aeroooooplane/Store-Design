import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { EXTMeshoptCompression } from '@gltf-transform/extensions'
import { copyToDocument, dequantize, prune } from '@gltf-transform/functions'
import sharp from 'sharp'
import { z } from 'zod'
import { buildFinishModel } from '../modules/assets/finish-models.ts'
import { bounds, getIO, transform } from '../modules/assets/gltf-tools.ts'
import { buildWhiteModel } from '../modules/assets/white-models.ts'

const [input, output] = process.argv.slice(2)
assert(input && output, '用法：node build-leica-wall-logo.ts <资源库> <新隔离目录>')
const resources = await realpath(input)
const target = path.join(await realpath(path.dirname(output)), path.basename(output))
assert(![resources, path.join(resources, '04_模型库')].includes(target))
assert(!target.startsWith(resources + path.sep), '输出必须在共享资源库之外')
await mkdir(target)
const library = path.join(resources, '04_模型库')
const staged = path.join(target, '04_模型库')
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const json = (file: string, value: unknown) =>
  writeFile(file, JSON.stringify(value, null, 2) + '\n')
const assetSchema = z.looseObject({
  asset_id: z.string(),
  folder: z.string(),
  web_model: z.string().nullish(),
  preview: z.string().nullish(),
  n: z.number().optional(),
})
const manifestSource = await readFile(path.join(library, 'manifest.json'))
const manifest = z
  .looseObject({ assets: z.array(assetSchema) })
  .parse(JSON.parse(manifestSource.toString()))
const facingSource = await readFile(path.join(library, 'facing.json'))
const facing = z
  .looseObject({ assets: z.record(z.string(), z.unknown()) })
  .parse(JSON.parse(facingSource.toString()))
const find = (id: string) => {
  const asset = manifest.assets.find((a) => a.asset_id === id)
  assert(asset?.web_model && asset.preview, id)
  return { ...asset, web_model: asset.web_model, preview: asset.preview }
}
const io = await getIO()
const sourceRecord = z.looseObject({
  glbSha256: z.string(),
  variants: z
    .object({
      overseas: z.object({ file: z.literal('overseas.glb'), glbSha256: z.string() }),
    })
    .optional(),
})
async function readModel(asset: ReturnType<typeof find>, overseas = false) {
  const dir = path.join(library, asset.web_model)
  const record = sourceRecord.parse(
    JSON.parse(await readFile(path.join(dir, 'conversion.json'), 'utf8')),
  )
  const variant = overseas
    ? record.variants?.overseas
    : { file: 'model.glb', glbSha256: record.glbSha256 }
  assert(variant)
  const bytes = await readFile(path.join(dir, variant.file))
  assert.equal(digest(bytes), variant.glbSha256, asset.asset_id)
  const document = await io.readBinary(bytes)
  await document.transform(dequantize())
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'EXT_meshopt_compression') extension.dispose()
  }
  return { document, record, sha256: variant.glbSha256 }
}

const logoAsset = find('asset-90000001')
const logos = await Promise.all([readModel(logoAsset), readModel(logoAsset, true)])
const models = []
for (const [index, width] of [1200, 1990, 3000].entries()) {
  const original = find(`asset-${90000105 + index}`)
  const id = `asset-${90000111 + index}`
  assert(!manifest.assets.some((a) => a.asset_id === id), id)
  const name = `徕卡墙画框组合 ${width}（含联名LOGO）`
  const folder = `软装道具/SI2.0/徕卡墙画框组合_${width}_含联名LOGO__${id}`
  const web = path.join(staged, folder, '网页模型')
  await mkdir(web, { recursive: true })
  // The manual centers the two small versions across the frames. The 3000 version
  // centers the logo over the two-row section to the right of the tall frame.
  const centerX = width === 3000 ? 0.43 : 0
  const bottom = 1.26
  const dimensions = { w: width / 1000, d: 0.025, h: 0 }
  let thumbnailLogo = ''
  const variants = []
  for (const [marketIndex, logo] of logos.entries()) {
    const { document, record, sha256 } = await readModel(original)
    const scene = document.getRoot().getDefaultScene()
    const logoScene =
      logo.document.getRoot().getDefaultScene() ?? logo.document.getRoot().listScenes()[0]
    assert(scene && logoScene)
    const box = bounds(logo.document)
    const center = (axis: number) => ((box.min[axis] ?? 0) + (box.max[axis] ?? 0)) / 2
    const offset: [number, number, number] = [
      centerX - center(0),
      bottom - (box.min[1] ?? 0),
      -0.0125 - (box.min[2] ?? 0),
    ]
    const roots = logoScene.listChildren()
    const copied = copyToDocument(document, logo.document, roots)
    const group = document.createNode('影石徕卡联名LOGO').setTranslation(offset)
    for (const node of roots) group.addChild(copied.get(node) as typeof node)
    scene.addChild(group)
    const [buffer, ...extraBuffers] = document.getRoot().listBuffers()
    assert(buffer)
    for (const accessor of document.getRoot().listAccessors()) accessor.setBuffer(buffer)
    for (const extra of extraBuffers) extra.dispose()
    await document.transform(prune())
    const file = marketIndex === 0 ? 'model.glb' : 'overseas.glb'
    document.createExtension(EXTMeshoptCompression).setRequired(true)
    const bytes = await io.writeBinary(document)
    const checked = bounds(await io.readBinary(bytes))
    const [minX = 0, minY = 0, minZ = 0] = checked.min
    const [maxX = 0, maxY = 0, maxZ = 0] = checked.max
    assert(
      Math.abs(maxX - minX - dimensions.w) < 0.0002 &&
        Math.abs(maxZ - minZ - dimensions.d) < 0.0002,
    )
    assert(
      Math.abs(minY) < 0.0002 && Math.abs(minX + maxX) < 0.0002 && Math.abs(minZ + maxZ) < 0.0002,
    )
    if (marketIndex === 0) {
      dimensions.h = Math.round(maxY * 1000) / 1000
      thumbnailLogo = logoOutline(logo.document, offset)
    } else {
      assert(Math.abs(maxY - dimensions.h) < 0.001, '国内外组合高度不一致')
    }
    await writeFile(path.join(web, file), bytes)
    variants.push({
      file,
      bytes: bytes.length,
      glbSha256: digest(bytes),
      sourceSha256: sha256,
      logoSha256: logo.sha256,
    })
    if (marketIndex === 0) {
      await json(path.join(web, 'conversion.json'), {
        ...record,
        id,
        name,
        dimensions,
        ...variants[0],
        market: 'domestic',
        logo: { assetId: logoAsset.asset_id, centerX, bottom },
        status: 'dimensions-checked',
        compression: { method: 'EXT_meshopt_compression', dimensionsChecked: true },
        construction: { framesFrom: original.asset_id, logoWidthMm: 880, gapMm: 60 },
      })
    }
  }
  const conversion = path.join(web, 'conversion.json')
  const record = z.looseObject({}).parse(JSON.parse(await readFile(conversion, 'utf8')))
  await json(conversion, { ...record, variants: { overseas: variants[1] } })
  const base = path.join(web, 'model.glb')
  await json(path.join(web, 'white.json'), await buildWhiteModel(base, path.join(web, 'white.glb')))
  await json(
    path.join(web, 'finish.json'),
    await buildFinishModel(base, path.join(web, 'finish.glb')),
  )
  await writeThumbnail(original.preview, folder, dimensions.w, thumbnailLogo)
  const symbol = path.join(folder, '平面图.svg')
  await writeFile(
    path.join(staged, symbol),
    await readFile(path.join(library, original.folder, '平面图.svg')),
  )
  const gallery = '软装道具/SI2.0/品类图库'
  const productSource = `${gallery}/01_道具图片PNG/${id}.png`
  const symbolSource = `${gallery}/03_平面图SVG/${id}.svg`
  for (const [file, source] of [
    [productSource, `${folder}/预览.png`],
    [symbolSource, symbol],
  ] as const) {
    await mkdir(path.dirname(path.join(staged, file)), { recursive: true })
    await writeFile(path.join(staged, file), await readFile(path.join(staged, source)))
  }
  const previous = manifest.assets.find((a) => a.asset_id === original.asset_id)
  assert(previous)
  previous.retired = {
    date: '2026-11-18',
    reason: '默认选用含联名LOGO的新组合，旧项目继续引用原尺寸资产',
  }
  manifest.assets.push({
    ...original,
    n: Math.max(...manifest.assets.map((a) => a.n ?? 0)) + 1,
    asset_id: id,
    folder,
    display_name: name,
    type_name: name,
    web_model: `${folder}/网页模型`,
    tight_face_bounds_xyz_mm: [width, 25, dimensions.h * 1000],
    preview: `${folder}/预览.png`,
    product_image: `${folder}/效果图.png`,
    product_image_source: productSource,
    plan_symbol: { svg: symbol, png: null },
    plan_symbol_source: { svg: symbolSource, png: null },
    judgment: '标准画框组合与880毫米联名LOGO，按项目市场显示国内或海外字标',
  })
  facing.assets[id] = facing.assets[original.asset_id]
  models.push({ id, original: original.asset_id, folder, name, dimensions, variants })
}
for (const [field, key] of [
  ['counts_by_si', 'si_family'],
  ['counts_by_match', 'match'],
  ['counts_by_category', 'category'],
] as const) {
  const values = manifest.assets.map((a) => z.string().parse(a[key]))
  manifest[field] = Object.fromEntries(
    [...new Set(values)].map((v) => [v, values.filter((x) => x === v).length]),
  )
}
await json(path.join(staged, 'manifest.json'), manifest)
await json(path.join(staged, 'facing.json'), facing)
await json(path.join(target, 'build-report.json'), {
  manifestSha256: digest(manifestSource),
  facingSha256: digest(facingSource),
  models,
})

function logoOutline(
  document: Awaited<ReturnType<typeof readModel>>['document'],
  offset: [number, number, number],
) {
  const groups = new Map<string, string[]>()
  for (const node of document.getRoot().listNodes()) {
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const position = primitive.getAttribute('POSITION')
      assert(position)
      const indices = primitive.getIndices()
      const matrix = node.getWorldMatrix()
      const color = primitive.getMaterial()?.getBaseColorFactor() ?? [1, 1, 1, 1]
      const fill =
        '#' +
        color
          .slice(0, 3)
          .map((c) =>
            Math.round(Math.pow(c, 1 / 2.2) * 255)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')
      const triangles = groups.get(fill) ?? []
      for (let i = 0; i < (indices?.getCount() ?? position.getCount()); i += 3) {
        const points = [i, i + 1, i + 2].map((j) =>
          transform(matrix, position.getElement(indices?.getScalar(j) ?? j, [])),
        )
        const [a, b, c] = points as [
          (typeof points)[number],
          (typeof points)[number],
          (typeof points)[number],
        ]
        if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-10) continue
        triangles.push(
          'M' +
            points
              .map(
                (p) =>
                  `${((p[0] + offset[0]) * 1000).toFixed(2)},${(-(p[1] + offset[1]) * 1000).toFixed(2)}`,
              )
              .join('L') +
            'Z',
        )
      }
      groups.set(fill, triangles)
    }
  }
  return [...groups]
    .map(([fill, triangles]) => `<path fill="${fill}" d="${triangles.join('')}"/>`)
    .join('')
}

async function writeThumbnail(preview: string, folder: string, width: number, logo: string) {
  const scale = Math.min(680 / width, 500 / 1.6)
  const imageWidth = Math.round(width * scale)
  const imageHeight = Math.round(1.2 * scale)
  // The source preview has a fixed orthographic margin. Extract the rectangular frame area.
  const oldScale = 600 / (2 * Math.max(0.6, (width * 3) / 8) * 1.15)
  const cropWidth = Math.round(width * oldScale)
  const cropHeight = Math.round(1.2 * oldScale)
  const frames = await sharp(path.join(library, preview))
    .extract({
      left: Math.floor((800 - cropWidth) / 2),
      top: Math.floor((600 - cropHeight) / 2),
      width: cropWidth,
      height: cropHeight,
    })
    .resize(imageWidth, imageHeight)
    .png()
    .toBuffer()
  const left = Math.floor((800 - imageWidth) / 2),
    top = 520 - imageHeight
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><g transform="translate(400 520) scale(${scale / 1000})">${logo}</g></svg>`,
  )
  const thumbnail = await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#d5d6d8' },
  })
    .composite([{ input: frames, left, top }, { input: overlay }])
    .png()
    .toBuffer()
  for (const file of ['预览.png', '效果图.png'])
    await writeFile(path.join(staged, folder, file), thumbnail)
}
