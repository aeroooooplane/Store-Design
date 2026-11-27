// Prepare the complete, isolated publication payload. Shared resources are read-only here.
import { readFile, writeFile, mkdir, copyFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { getIO, bounds, transform } from '../../../apps/api/src/modules/assets/gltf-tools.ts'
import { buildWhiteModel } from '../../../apps/api/src/modules/assets/white-models.ts'
import { buildFinishModel, PRESERVE_APPEARANCE } from '../../../apps/api/src/modules/assets/finish-models.ts'

const [sourceArg, outArg, lengthArg = '2100'] = process.argv.slice(2)
if (!sourceArg || !outArg) throw Error('Usage: node package-mm93-catalog.mjs Tripo-original.glb NEW-external-output [length-mm]')
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const tool = path.join(repo, 'tools/su-convert'), out = path.resolve(outArg)
assert.ok(!out.toLowerCase().startsWith((await realpath(path.join(repo, '资源库'))).toLowerCase()), 'Output must not be shared resources')
assert.ok(!out.toLowerCase().startsWith(repo.toLowerCase() + path.sep), 'Keep generated models outside the worktree')
const lengthMm = Number(lengthArg)
assert.ok(Number.isFinite(lengthMm) && lengthMm >= 500 && lengthMm <= 5000, 'Invalid display length')
const id = 'asset-90000607', name = 'MM93 × Insta360 赛车', folder = `非标陈列/MM93_Insta360_红色赛车__${id}`
const relative = `04_模型库/${folder}`, webRelative = `${relative}/网页模型`
const payload = path.join(out, 'payload'), web = path.join(payload, webRelative)
const hash = b => createHash('sha256').update(b).digest('hex')
const json = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const bytes = await readFile(sourceArg), sourceSha256 = hash(bytes)
assert.equal(sourceSha256, '46ed38fb4e5a774e91e10264b20874a4c0a8584e655b5c680792c9b9e8700fef')
const library = path.join(repo, '资源库/04_模型库')
const baseline = {}
for (const file of ['manifest.json', 'facing.json']) baseline[file] = await readFile(path.join(library, file))
const manifest = JSON.parse(baseline['manifest.json'].toString('utf8').replace(/^\uFEFF/, ''))
const facing = JSON.parse(baseline['facing.json'].toString('utf8').replace(/^\uFEFF/, ''))
assert.ok(!manifest.assets.some(a => a.asset_id === id || a.display_name === name), 'Catalogue ID/name already exists')
assert.ok(!facing.assets[id], 'Facing ID already exists')
await mkdir(out, { recursive: false })
await mkdir(web, { recursive: true })
const auditRelative = '90_处理过程与审核/模型发布/20261127/mm93'
await mkdir(path.join(payload, auditRelative, '原始'), { recursive: true })
await copyFile(sourceArg, path.join(payload, auditRelative, '原始/Tripo原件.glb'))

// Source positions and image bytes stay intact. A new parent establishes metres and +Z front.
const sourceJsonLength = bytes.readUInt32LE(12)
const gltf = JSON.parse(bytes.subarray(20, 20 + sourceJsonLength).toString('utf8'))
for (const m of gltf.materials) m.extras = { ...m.extras, [PRESERVE_APPEARANCE]: true }
const scale = lengthMm / 1000
for (const scene of gltf.scenes) {
  const parent = gltf.nodes.length
  gltf.nodes.push({ name: '米制底部中心及正面', children: scene.nodes,
    matrix: [0,0,-scale,0, 0,scale,0,0, scale,0,0,0, 0,0,0,1],
    extras: { units: 'm', front: '+Z', origin: 'bottom-center', displayLengthMm: lengthMm, physicallyMeasured: false } })
  scene.nodes = [parent]
}
const raw = Buffer.from(JSON.stringify(gltf)), padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 0x20)
raw.copy(padded)
const binary = bytes.subarray(20 + sourceJsonLength), header = Buffer.from(bytes.subarray(0, 20))
header.writeUInt32LE(20 + padded.length + binary.length, 8); header.writeUInt32LE(padded.length, 12)
const normalized = Buffer.concat([header, padded, binary])
await writeFile(path.join(web, 'model.glb'), normalized, { flag: 'wx' })
const io = await getIO(), document = await io.readBinary(normalized), box = bounds(document)
const [w,h,d] = box.max.map((v,i) => v - box.min[i])
assert.ok(Math.abs(d - scale) < 1e-6)
assert.ok(Math.abs(box.min[1]) + Math.abs(box.min[0] + box.max[0]) + Math.abs(box.min[2] + box.max[2]) < 1e-6)
const conversion = { id, name, category: '非标陈列', variant: '红色赛车', unit: 'm', upAxis: 'Y', origin: 'bottom-center',
  front: '+Z', sourceGenerator: 'Tripo', sourceSha256, glbSha256: hash(normalized), bytes: normalized.length,
  dimensions: { w,d,h }, displayLengthMm: lengthMm, physicallyMeasured: false,
  normalization: '原模型-X车头绕Y轴+90度转为+Z，全长按展示尺寸等比例设置；原BIN及原始节点不改',
  textures: { count: 3, maxSize: 4096, downscaled: 0 }, preserveAppearance: true }
await json(path.join(web, 'conversion.json'), conversion)
for (const [kind, build] of [['white', buildWhiteModel], ['finish', buildFinishModel]]) {
  const report = await build(path.join(web, 'model.glb'), path.join(web, `${kind}.glb`))
  await json(path.join(web, `${kind}.json`), report)
}
const originalDoc = await io.readBinary(bytes), finishedDoc = await io.read(path.join(web, 'finish.glb'))
const primitives = doc => doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())
const originalPrimitives = primitives(originalDoc), finishedPrimitives = primitives(finishedDoc)
assert.equal(originalPrimitives.length, finishedPrimitives.length)
for (let i = 0; i < originalPrimitives.length; i++) {
  const a = originalPrimitives[i], b = finishedPrimitives[i]
  for (const semantic of a.listSemantics()) assert.deepEqual(b.getAttribute(semantic).getArray(), a.getAttribute(semantic).getArray(), semantic)
  assert.deepEqual(b.getIndices().getArray(), a.getIndices().getArray(), 'Original index order')
}
const images = doc => doc.getRoot().listTextures().map(t => ({ sha256: hash(t.getImage()), size: t.getSize() }))
assert.deepEqual(images(finishedDoc), images(originalDoc))
const pbr = doc => doc.getRoot().listMaterials().map(m => ({ color: m.getBaseColorFactor(), roughness: m.getRoughnessFactor(),
  metallic: m.getMetallicFactor(), normalScale: m.getNormalScale(), doubleSided: m.getDoubleSided(),
  alpha: m.getAlphaMode(), emissive: m.getEmissiveFactor(), cutoff: m.getAlphaCutoff() }))
assert.deepEqual(pbr(finishedDoc), pbr(originalDoc))

// A small outline derived from actual projected vertices keeps 2D placement inexpensive.
const points = []
for (const node of document.getRoot().listNodes()) for (const p of node.getMesh()?.listPrimitives() ?? []) {
  const position = p.getAttribute('POSITION'), matrix = node.getWorldMatrix()
  for (let i = 0; i < position.getCount(); i++) {
    const [x,,z] = transform(matrix, position.getElement(i, []))
    points.push([Math.round(x * 1000), Math.round(z * 1000)])
  }
}
points.sort((a,b) => a[0]-b[0] || a[1]-b[1])
const half = ps => { const hull = []; for (const p of ps) { while (hull.length > 1) {
  const a = hull[hull.length-2], b = hull[hull.length-1]
  if ((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]) > 0) break
  hull.pop()
} hull.push(p) } return hull.slice(0,-1) }
const hull = half(points).concat(half([...points].reverse()))
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${[-w*500-3,-d*500-3,w*1000+6,d*1000+6].join(' ')}"><polygon points="${hull.map(p=>p.join(',')).join(' ')}" fill="#fff" stroke="#333" stroke-width="2"/><path d="M-60 ${d*500-130} L0 ${d*500-60} L60 ${d*500-130}" fill="none" stroke="#555" stroke-width="5"/></svg>`
await writeFile(path.join(payload, relative, '平面图.svg'), svg, { flag: 'wx' })
await sharp(Buffer.from(svg)).resize({ height: 600 }).png().toFile(path.join(payload, relative, '平面图.png'))

const entry = { asset_id: id, folder, web_model: `${folder}/网页模型`, preview: `${folder}/预览.jpg`, display_name: name,
  standard_name: '联名赛车橱窗模型', variant: '红色 MM93 × Insta360 赛车', si_family: '非标', match: '非标', category: '非标陈列',
  material_category: '展陈物料', judgment: `用户提供Tripo原件，保留原贴图/PBR；展示全长${lengthMm}mm等比，非实测尺寸，落地独立放置。`,
  tight_face_bounds_xyz_mm: [w,d,h].map(v=>Math.round(v*1000)), product_image: `${folder}/预览.jpg`, product_image_match: 'exact',
  plan_symbol: { svg: `${folder}/平面图.svg`, png: `${folder}/平面图.png` }, source_sha256: sourceSha256 }
const face = { front: '+Z', confidence: 'high', installation: 'floor', note: '车头朝+Z，Y向上、底部中心；2100mm为等比例展示全长，不是实测认证尺寸。' }
await json(path.join(out, 'catalog-delta.json'), { entry, facing: face })
manifest.assets.push(entry)
for (const [key, field] of [['counts_by_category','category'],['counts_by_si','si_family'],['counts_by_match','match']]) {
  manifest[key] = {}; for (const a of manifest.assets) manifest[key][a[field]] = (manifest[key][a[field]] ?? 0) + 1
}
manifest.updated = '2026-11-27'; facing.assets[id] = face
await mkdir(path.join(out, 'metadata/04_模型库'), { recursive: true })
await json(path.join(out, 'metadata/04_模型库/manifest.json'), manifest)
await json(path.join(out, 'metadata/04_模型库/facing.json'), facing)

// Actual-model transparent thumbnail, with original materials, no AI repainting.
const server = await createServer({ configFile: false, root: tool, cacheDir: path.join(out, '.vite'), logLevel: 'error',
  server: { host: '127.0.0.1', port: 5266, strictPort: true, fs: { allow: [repo, out, await realpath(path.join(tool, 'node_modules'))] } },
  plugins: [{ name: 'mm93-thumbnail', configureServer(s) { s.middlewares.use((req,res,next) => {
    if (req.url !== '/mm93-thumbnail') return next(); res.setHeader('Content-Type','text/html'); res.end('<!doctype html><html><head></head><body></body></html>')
  }) } }] })
let browser, thumbnail
try {
  await server.listen(); browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:5266/mm93-thumbnail')
  await page.evaluate(() => { const m=document.createElement('script'); m.type='importmap'; m.textContent=JSON.stringify({imports:{three:'/node_modules/three/build/three.module.js'}}); document.head.appendChild(m) })
  thumbnail = await page.evaluate(async url => {
    const T = await import('/node_modules/three/build/three.module.js')
    const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js')
    const { MeshoptDecoder } = await import('/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js')
    const { RoomEnvironment } = await import('/node_modules/three/examples/jsm/environments/RoomEnvironment.js')
    const renderer = new T.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true}); renderer.setSize(640,480)
    renderer.setClearColor(0,0); renderer.toneMapping=T.ACESFilmicToneMapping; renderer.toneMappingExposure=.82
    const scene=new T.Scene(), environment=new T.PMREMGenerator(renderer).fromScene(new RoomEnvironment(),.04).texture
    scene.environment=environment; scene.environmentIntensity=.25; scene.add(new T.HemisphereLight('#ffffff','#7b7770',1.1))
    const sun=new T.DirectionalLight('#fff4e8',1.6); sun.position.set(-2,4,3); scene.add(sun)
    const model=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url)).scene; scene.add(model)
    const box=new T.Box3().setFromObject(model,true),center=box.getCenter(new T.Vector3()),dims=box.getSize(new T.Vector3())
    const camera=new T.PerspectiveCamera(32,4/3,.01,100); camera.position.copy(center).addScaledVector(new T.Vector3(1,.7,1).normalize(),dims.length()*1.8);camera.lookAt(center)
    renderer.render(scene,camera)
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');ctx.drawImage(renderer.domElement,0,0)
    const cornerAlpha=ctx.getImageData(0,0,1,1).data[3],png=canvas.toDataURL('image/png'),webp=canvas.toDataURL('image/webp',.9)
    ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#fff';ctx.fillRect(0,0,640,480);const jpg=canvas.toDataURL('image/jpeg',.92)
    renderer.dispose();environment.dispose()
    return {png,webp,jpg,cornerAlpha,dimensions:{w:dims.x,d:dims.z,h:dims.y}}
  }, '/@fs/' + path.join(web,'finish.glb').replaceAll('\\','/'))
  assert.deepEqual(errors, []); assert.equal(thumbnail.cornerAlpha, 0)
  for (const k of ['w','d','h']) assert.ok(Math.abs(thumbnail.dimensions[k]-conversion.dimensions[k]) < .001)
  await writeFile(path.join(out, `${id}.webp`), Buffer.from(thumbnail.webp.split(',')[1], 'base64'), { flag:'wx' })
  await writeFile(path.join(out, `${id}.png`), Buffer.from(thumbnail.png.split(',')[1], 'base64'), { flag:'wx' })
  await writeFile(path.join(payload, relative, '预览.jpg'), Buffer.from(thumbnail.jpg.split(',')[1], 'base64'), { flag:'wx' })
} finally { await browser?.close(); await server.close() }
const resourceValidation = { id, sourceSha256, displayLengthMm: lengthMm, physicallyMeasured: false, dimensions: conversion.dimensions,
  front: '+Z', normalizationParentOnly: true, originalBinaryUnchanged: true, floatAttributesAndIndicesUnchanged: true,
  imageBytesUnchanged: true, images: images(finishedDoc), pbrUnchanged: true, pbr: pbr(finishedDoc), thumbnailCornerAlpha: thumbnail.cornerAlpha,
  baselineMetadata: Object.fromEntries(Object.entries(baseline).map(([k,v]) => [k,hash(v)])), productionPublished:false }
await json(path.join(out,'package-validation.json'), resourceValidation)
await json(path.join(payload,auditRelative,'资源校验.json'), resourceValidation)
console.log(JSON.stringify({id, dimensions:conversion.dimensions, thumbnailAlpha:thumbnail.cornerAlpha, originalAppearancePreserved:true}))
