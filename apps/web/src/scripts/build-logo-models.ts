// 品牌 LOGO 网页模型：用官方矢量原稿挤出立体字，生成国内 / 海外两版 GLB（用户 10-15 Z1、Z2、L1–L3）。
// 每个 LOGO 以模型名对应的那一版为准（宽度取原 SketchUp 包围盒），另一版等比缩放、居中放进同一范围，
// 平面占地不随项目市场变化。徕卡联名墙面 LOGO 是新增的整体模组。脚本可重复运行，同样的输入得到
// 逐字节相同的 GLB。
// 用法（apps/web 目录）：node src/scripts/build-logo-models.ts [--only asset-xxx]
// 之后在仓库根目录运行 pnpm library:refresh 和 pnpm catalog:import。
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import sharp from 'sharp'
import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const LIBRARY = path.join(ROOT, '资源库/04_模型库')
const BRAND_DIR = '品牌标识'
/** Official artwork (2026-02 字标) and the files the user added on 10-15, with their hashes. */
const SOURCES = path.join(LIBRARY, BRAND_DIR, '_源文件')
const OFFICIAL = SOURCES

// ---------------------------------------------------------------------------------------------
// Vector artwork: filled paths in source units, y up.

type Cmd =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Q', number, number, number, number]
  | ['Z']

interface ArtPath {
  cmds: Cmd[]
  /** Source fill colour, mapped to a material by MATERIAL_OF. */
  color: string
  evenOdd: boolean
}

interface Art {
  paths: ArtPath[]
  /** Files the artwork came from, with their hashes, for conversion.json. */
  sources: { file: string; page?: number; sha256: string }[]
}

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')
const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')

function hex(rgb: readonly number[]): string {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}

/** Filled paths of one page of an official PDF or PDF-compatible .ai, in points. */
async function artFromPdf(file: string, pageNumber: number): Promise<Art> {
  const data = new Uint8Array(await readFile(file))
  const doc = await pdfjs.getDocument({ data: data.slice(), verbosity: 0 }).promise
  const page = await doc.getPage(pageNumber)
  const ops = await page.getOperatorList()
  const OPS = pdfjs.OPS
  type Matrix = [number, number, number, number, number, number]
  const multiply = (m: Matrix, n: Matrix): Matrix => [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ]
  let state = { ctm: [1, 0, 0, 1, 0, 0] as Matrix, fill: '#000000' }
  const stack: (typeof state)[] = []
  const paths: ArtPath[] = []
  const [, , pageW, pageH] = page.view as [number, number, number, number]
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i] as unknown[]
    if (fn === OPS.save) stack.push({ ...state })
    else if (fn === OPS.restore) state = stack.pop() ?? state
    else if (fn === OPS.transform) state.ctm = multiply(args as Matrix, state.ctm)
    else if (fn === OPS.setFillRGBColor) {
      const [first] = args
      state.fill = typeof first === 'string' ? first : hex(args as number[])
    } else if (fn === OPS.constructPath) {
      const paint = args[0]
      const data = Array.from((args[1] as ArrayLike<number>[] | undefined)?.[0] ?? [])
      const m = state.ctm
      const p = (x: number, y: number): [number, number] => [
        m[0] * x + m[2] * y + m[4],
        m[1] * x + m[3] * y + m[5],
      ]
      const cmds: Cmd[] = []
      let k = 0
      while (k < data.length) {
        const op = data[k++]
        const n = () => data[k++] ?? 0
        if (op === 0) cmds.push(['M', ...p(n(), n())])
        else if (op === 1) cmds.push(['L', ...p(n(), n())])
        else if (op === 2) cmds.push(['C', ...p(n(), n()), ...p(n(), n()), ...p(n(), n())])
        else if (op === 3) cmds.push(['Q', ...p(n(), n()), ...p(n(), n())])
        else if (op === 4) cmds.push(['Z'])
        else break
      }
      const names = Object.entries(OPS).find(([, v]) => v === paint)?.[0] ?? ''
      if (!/fill/i.test(names) || !cmds.length) continue
      const path: ArtPath = { cmds, color: state.fill.toLowerCase(), evenOdd: /eo/i.test(names) }
      // A background rectangle covering the page is not part of the mark.
      const box = bounds([path])
      if ((box.maxX - box.minX) * (box.maxY - box.minY) > pageW * pageH * 0.8) continue
      paths.push(path)
    }
  }
  return { paths, sources: [{ file: relative(file), page: pageNumber, sha256: sha256(data) }] }
}

/** Filled paths of an SVG made of absolute M/L/H/V/C/Z paths (影翎.svg), flipped to y up. */
async function artFromSvg(file: string, keep: (path: ArtPath) => boolean): Promise<Art> {
  const text = await readFile(file, 'utf8')
  const paths: ArtPath[] = []
  for (const match of text.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*>/g)) {
    const tokens = match[1]?.match(/[MLHVCZmlhvcz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
    const cmds: Cmd[] = []
    let [x, y] = [0, 0]
    let command = ''
    for (let i = 0; i < tokens.length;) {
      if (/[A-Za-z]/.test(tokens[i] ?? '')) command = tokens[i++] ?? ''
      const n = () => Number(tokens[i++])
      const upper = command.toUpperCase()
      const rel = command !== upper
      if (upper === 'Z') {
        cmds.push(['Z'])
        continue
      }
      if (upper === 'M' || upper === 'L') {
        const nx = n() + (rel ? x : 0)
        const ny = n() + (rel ? y : 0)
        ;[x, y] = [nx, ny]
        cmds.push([upper === 'M' ? 'M' : 'L', x, -y])
        if (upper === 'M') command = rel ? 'l' : 'L'
      } else if (upper === 'H') {
        x = n() + (rel ? x : 0)
        cmds.push(['L', x, -y])
      } else if (upper === 'V') {
        y = n() + (rel ? y : 0)
        cmds.push(['L', x, -y])
      } else if (upper === 'C') {
        const c = [n(), n(), n(), n(), n(), n()].map((v, j) => v + (rel ? (j % 2 ? y : x) : 0))
        ;[x, y] = [c[4] ?? 0, c[5] ?? 0]
        cmds.push(['C', c[0] ?? 0, -(c[1] ?? 0), c[2] ?? 0, -(c[3] ?? 0), x, -y])
      } else throw new Error(`${file}: unsupported path command ${command}`)
    }
    const fill = /fill="([^"]+)"/.exec(match[0])?.[1] ?? '#000000'
    const path: ArtPath = {
      cmds,
      color: fill === 'black' ? '#000000' : fill.toLowerCase(),
      evenOdd: false,
    }
    if (keep(path)) paths.push(path)
  }
  return { paths, sources: [{ file: relative(file), sha256: sha256(text) }] }
}

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Bounds of the drawn outline (curves sampled, not their control points). */
function bounds(paths: readonly ArtPath[]): Box {
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const add = (x: number, y: number) => {
    box.minX = Math.min(box.minX, x)
    box.maxX = Math.max(box.maxX, x)
    box.minY = Math.min(box.minY, y)
    box.maxY = Math.max(box.maxY, y)
  }
  for (const p of paths) {
    let [x, y] = [0, 0]
    for (const c of p.cmds) {
      if (c[0] === 'M' || c[0] === 'L') [x, y] = [c[1], c[2]]
      else if (c[0] === 'C' || c[0] === 'Q') {
        const pts = c.slice(1) as number[]
        const [ex, ey] = [pts[pts.length - 2] ?? 0, pts[pts.length - 1] ?? 0]
        for (let t = 0.125; t < 1; t += 0.125) {
          const s = 1 - t
          if (c[0] === 'C')
            add(
              s * s * s * x + 3 * s * s * t * c[1] + 3 * s * t * t * c[3] + t * t * t * ex,
              s * s * s * y + 3 * s * s * t * c[2] + 3 * s * t * t * c[4] + t * t * t * ey,
            )
          else
            add(
              s * s * x + 2 * s * t * c[1] + t * t * ex,
              s * s * y + 2 * s * t * c[2] + t * t * ey,
            )
        }
        ;[x, y] = [ex, ey]
      } else continue
      add(x, y)
    }
  }
  return box
}

/** The artwork moved and scaled: (x, y) → ((x − ox)·s + dx, (y − oy)·s + dy). */
function transform(art: Art, s: number, ox: number, oy: number, dx: number, dy: number): Art {
  const map = (x: number, y: number) => [(x - ox) * s + dx, (y - oy) * s + dy] as const
  return {
    sources: art.sources,
    paths: art.paths.map((p) => ({
      ...p,
      cmds: p.cmds.map((c): Cmd => {
        if (c[0] === 'M' || c[0] === 'L') return [c[0], ...map(c[1], c[2])]
        if (c[0] === 'C') return ['C', ...map(c[1], c[2]), ...map(c[3], c[4]), ...map(c[5], c[6])]
        if (c[0] === 'Q') return ['Q', ...map(c[1], c[2]), ...map(c[3], c[4])]
        return c
      }),
    })),
  }
}

/** Scaled to `width` metres, bottom-left at the origin. */
function sized(art: Art, width: number): Art {
  const b = bounds(art.paths)
  return transform(art, width / (b.maxX - b.minX), b.minX, b.minY, 0, 0)
}

/** Pieces side by side on a common baseline, `gap` (share of the first one's height) apart. */
function row(arts: readonly Art[], gap: number): Art {
  const height = (a: Art) => bounds(a.paths).maxY - bounds(a.paths).minY
  const first = arts[0]
  if (!first) throw new Error('empty row')
  let x = 0
  const out: Art = { paths: [], sources: [] }
  for (const art of arts) {
    const b = bounds(art.paths)
    const placed = transform(art, 1, b.minX, b.minY, x, 0)
    out.paths.push(...placed.paths)
    out.sources.push(...art.sources)
    x += b.maxX - b.minX + gap * height(first)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Materials and solids.

type MaterialName = 'letter' | 'print' | 'panel' | 'red' | 'white' | 'rod'

/** Colours from the shop photos: white acrylic letters, Leica red disc with white script. */
const MATERIALS: Record<MaterialName, { color: string; roughness: number }> = {
  letter: { color: '#f2f2f2', roughness: 0.35 },
  print: { color: '#101215', roughness: 0.6 },
  panel: { color: '#ffffff', roughness: 0.5 },
  red: { color: '#e72e1e', roughness: 0.4 },
  white: { color: '#ffffff', roughness: 0.35 },
  rod: { color: '#2b2d31', roughness: 0.5 },
}

function materialOf(color: string, printed: boolean): MaterialName {
  if (/^#e[79]2e1e$/.test(color)) return 'red'
  if (color === '#ffffff') return 'white'
  return printed ? 'print' : 'letter'
}

interface Solid {
  material: MaterialName
  geometry: THREE.BufferGeometry
}

/**
 * Outlines with holes by the path's fill rule. SVGLoader.createShapes is marked deprecated in
 * favour of ShapePath.toShapes, which guesses holes from winding only; the fill rule matters for
 * the official artwork, so the warning is silenced here.
 */
function shapesOf(shapePath: THREE.ShapePath): THREE.Shape[] {
  const warn = console.warn
  console.warn = () => undefined
  try {
    return SVGLoader.createShapes(shapePath)
  } finally {
    console.warn = warn
  }
}

const nonIndexed = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g)

/** Extrudes artwork (metres, y up) between z0 and z1 (front at +z). */
function extrude(art: Art, z0: number, z1: number, printed: boolean): Solid[] {
  const groups = new Map<MaterialName, THREE.BufferGeometry[]>()
  for (const p of art.paths) {
    const shapePath = new THREE.ShapePath()
    shapePath.userData = { style: { fillRule: p.evenOdd ? 'evenodd' : 'nonzero' } }
    for (const c of p.cmds) {
      if (c[0] === 'M') shapePath.moveTo(c[1], c[2])
      else if (c[0] === 'L') shapePath.lineTo(c[1], c[2])
      else if (c[0] === 'C') shapePath.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6])
      else if (c[0] === 'Q') shapePath.quadraticCurveTo(c[1], c[2], c[3], c[4])
      else shapePath.currentPath?.closePath()
    }
    const material = materialOf(p.color, printed)
    // The Leica script stands 2 mm proud of the red disc; the disc stops 2 mm short.
    const [a, b] =
      material === 'white' ? [z1 - 0.004, z1] : material === 'red' ? [z0, z1 - 0.002] : [z0, z1]
    const geometry = new THREE.ExtrudeGeometry(shapesOf(shapePath), {
      depth: b - a,
      bevelEnabled: false,
      curveSegments: 8,
    })
    geometry.translate(0, 0, a)
    groups.set(material, [...(groups.get(material) ?? []), geometry])
  }
  return [...groups].map(([material, list]) => ({
    material,
    geometry: mergeGeometries(list.map(nonIndexed)) ?? new THREE.BufferGeometry(),
  }))
}

function box(
  material: MaterialName,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): Solid {
  const geometry = nonIndexed(new THREE.BoxGeometry(w, h, d))
  geometry.translate(x, y + h / 2, z)
  return { material, geometry }
}

// ---------------------------------------------------------------------------------------------
// Minimal GLB writer: one node and mesh per material, positions and normals, no textures.

const linear = (c: string) =>
  [1, 3, 5].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })

function glb(solids: readonly Solid[]): Uint8Array {
  const chunks: Buffer[] = []
  let offset = 0
  const json = {
    asset: { version: '2.0', generator: 'store-design build-logo-models' },
    scene: 0,
    scenes: [{ nodes: solids.map((_, i) => i) }],
    nodes: solids.map((s, i) => ({ mesh: i, name: s.material })),
    meshes: solids.map((s, i) => ({
      name: s.material,
      primitives: [{ attributes: { POSITION: i * 2, NORMAL: i * 2 + 1 }, material: i }],
    })),
    materials: solids.map((s) => ({
      name: s.material,
      pbrMetallicRoughness: {
        baseColorFactor: [...linear(MATERIALS[s.material].color), 1],
        metallicFactor: 0,
        roughnessFactor: MATERIALS[s.material].roughness,
      },
    })),
    accessors: [] as object[],
    bufferViews: [] as object[],
    buffers: [{ byteLength: 0 }],
  }
  for (const s of solids) {
    s.geometry.computeVertexNormals()
    const position = s.geometry.getAttribute('position')
    const normal = s.geometry.getAttribute('normal')
    for (const [attribute, withBounds] of [
      [position, true],
      [normal, false],
    ] as const) {
      const array = Float32Array.from(attribute.array as ArrayLike<number>)
      const bytes = Buffer.from(array.buffer)
      json.bufferViews.push({
        buffer: 0,
        byteOffset: offset,
        byteLength: bytes.length,
        target: 34962,
      })
      const accessor: Record<string, unknown> = {
        bufferView: json.bufferViews.length - 1,
        componentType: 5126,
        count: attribute.count,
        type: 'VEC3',
      }
      if (withBounds) {
        s.geometry.computeBoundingBox()
        const b = s.geometry.boundingBox ?? new THREE.Box3()
        accessor['min'] = [b.min.x, b.min.y, b.min.z].map((v) => Math.fround(v))
        accessor['max'] = [b.max.x, b.max.y, b.max.z].map((v) => Math.fround(v))
      }
      json.accessors.push(accessor)
      chunks.push(bytes)
      offset += bytes.length
    }
  }
  const bin = Buffer.concat(chunks)
  json.buffers[0] = { byteLength: bin.length }
  const pad = (b: Buffer, fill: number) =>
    Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)])
  const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20)
  const binChunk = pad(bin, 0)
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8)
  const chunkHeader = (length: number, type: number) => {
    const b = Buffer.alloc(8)
    b.writeUInt32LE(length, 0)
    b.writeUInt32LE(type, 4)
    return b
  }
  return Buffer.concat([
    header,
    chunkHeader(jsonChunk.length, 0x4e4f534a),
    jsonChunk,
    chunkHeader(binChunk.length, 0x004e4942),
    binChunk,
  ])
}

// ---------------------------------------------------------------------------------------------
// The LOGO models.

type Market = 'domestic' | 'overseas'
type ArtName =
  | 'cn'
  | 'en'
  | 'cnSlogan'
  | 'enSlogan'
  | 'antigravity'
  | 'yinglingAntigravity'
  | 'leicaCn'
  | 'leicaEn'

async function loadArts(): Promise<Record<ArtName, Art>> {
  const yingling = path.join(SOURCES, '影翎.svg')
  // In 影翎.svg the ANTIGRAVITY word sits above the 影翎 characters.
  const antigravity = await artFromSvg(yingling, (p) => bounds([p]).maxY > -420)
  const characters = await artFromSvg(yingling, (p) => bounds([p]).maxY <= -420)
  return {
    cn: await artFromPdf(path.join(OFFICIAL, '影石Insta360.ai'), 4),
    en: await artFromPdf(path.join(OFFICIAL, 'Insta360.ai'), 4),
    cnSlogan: await artFromPdf(path.join(OFFICIAL, 'CN-logo-black-on- transparent-rgb5.pdf'), 1),
    enSlogan: await artFromPdf(path.join(OFFICIAL, 'Insta360.ai'), 9),
    antigravity,
    yinglingAntigravity: row([characters, antigravity], 0.3),
    leicaCn: await artFromPdf(path.join(SOURCES, '门店-徕卡联名-中文新-转曲文件.ai'), 1),
    leicaEn: await artFromPdf(path.join(SOURCES, '门店-徕卡联名.ai'), 1),
  }
}

interface LogoSpec {
  id: string
  /** Folder under 资源库/04_模型库/品牌标识. */
  folder: string
  /** The market the model's name stands for: its version sets the size. */
  named: Market
  arts: Record<Market, ArtName>
  kind: 'wall' | 'hanging' | 'panel'
  /** Width × depth × height in metres; null takes the SketchUp bounds from manifest.json. */
  size?: { w: number; d: number; h?: number }
}

const NEW_LEICA_ID = 'asset-90000001'
const LEICA_WIDTH_M = 2.4
const LEICA_DEPTH_M = 0.03

const LOGOS: LogoSpec[] = [
  {
    id: 'asset-20533337',
    folder: '墙面LOGO_影石Insta360_3453mm__asset-20533337',
    named: 'domestic',
    arts: { domestic: 'cn', overseas: 'en' },
    kind: 'wall',
  },
  {
    id: 'asset-40896298',
    folder: '墙面LOGO_影石Insta360_2930mm__asset-40896298',
    named: 'domestic',
    arts: { domestic: 'cn', overseas: 'en' },
    kind: 'wall',
  },
  {
    id: 'asset-40910342',
    folder: '墙面LOGO_Insta360_2027mm__asset-40910342',
    named: 'overseas',
    arts: { domestic: 'cn', overseas: 'en' },
    kind: 'wall',
  },
  {
    id: 'asset-6952129',
    folder: '墙面LOGO_影石Insta360始于敢想_1267mm_A__asset-6952129',
    named: 'domestic',
    arts: { domestic: 'cnSlogan', overseas: 'enSlogan' },
    kind: 'wall',
  },
  {
    id: 'asset-33868330',
    folder: '墙面LOGO_影石Insta360始于敢想_1266mm_B__asset-33868330',
    named: 'domestic',
    arts: { domestic: 'cnSlogan', overseas: 'enSlogan' },
    kind: 'wall',
  },
  {
    id: 'asset-34293910',
    folder: '墙面LOGO_Insta360_Thinkbold_1092mm__asset-34293910',
    named: 'overseas',
    arts: { domestic: 'cnSlogan', overseas: 'enSlogan' },
    kind: 'wall',
  },
  {
    id: 'asset-37760531',
    folder: '墙面LOGO_ANTIGRAVITY_2619mm__asset-37760531',
    named: 'overseas',
    arts: { domestic: 'yinglingAntigravity', overseas: 'antigravity' },
    kind: 'wall',
  },
  {
    id: 'asset-11483499',
    folder: '墙面LOGO_影翎ANTIGRAVITY_3155mm__asset-11483499',
    named: 'domestic',
    arts: { domestic: 'yinglingAntigravity', overseas: 'antigravity' },
    kind: 'wall',
  },
  {
    id: 'asset-33917980',
    folder: '吊挂LOGO_影石Insta360_1867mm_短吊杆__asset-33917980',
    named: 'domestic',
    arts: { domestic: 'cn', overseas: 'en' },
    kind: 'hanging',
  },
  {
    id: 'asset-33937175',
    folder: '吊挂LOGO_影石Insta360_1778mm_长吊杆__asset-33937175',
    named: 'domestic',
    arts: { domestic: 'cn', overseas: 'en' },
    kind: 'hanging',
  },
  {
    id: 'asset-1129848',
    folder: '吊挂LOGO_影石Insta360始于敢想_1267mm__asset-1129848',
    named: 'domestic',
    arts: { domestic: 'cnSlogan', overseas: 'enSlogan' },
    kind: 'hanging',
  },
  {
    id: 'asset-3147733',
    folder: 'LOGO画面_Insta360_500x100_平面__asset-3147733',
    named: 'overseas',
    arts: { domestic: 'cn', overseas: 'en' },
    kind: 'panel',
    size: { w: 0.5, d: 0.005, h: 0.1 },
  },
  {
    id: NEW_LEICA_ID,
    folder: `墙面LOGO_影石Insta360徕卡联名_${LEICA_WIDTH_M * 1000}mm__${NEW_LEICA_ID}`,
    named: 'domestic',
    arts: { domestic: 'leicaCn', overseas: 'leicaEn' },
    kind: 'wall',
    size: { w: LEICA_WIDTH_M, d: LEICA_DEPTH_M },
  },
]

/** Smallest thickness of extruded letters (the panel prints thinner). */
const MIN_DEPTH_M = 0.02
const ROD_M = 0.015

/**
 * One market version: the named one fills the width; the other one is scaled into the named
 * one's width × height and centred, so both share one footprint. Origin at the bottom centre.
 */
function build(
  spec: LogoSpec,
  arts: Record<ArtName, Art>,
  market: Market,
  w: number,
  d: number,
  h: number,
): { solids: Solid[]; art: Art; markH: number } {
  const named = sized(arts[spec.arts[spec.named]], spec.kind === 'panel' ? w * 0.9 : w)
  const nb = bounds(named.paths)
  const markW = nb.maxX
  const markH = nb.maxY
  let art = named
  if (market !== spec.named) {
    const other = arts[spec.arts[market]]
    const ob = bounds(other.paths)
    const s = Math.min(markW / (ob.maxX - ob.minX), markH / (ob.maxY - ob.minY))
    const [ow, oh] = [(ob.maxX - ob.minX) * s, (ob.maxY - ob.minY) * s]
    art = transform(other, s, ob.minX, ob.minY, (markW - ow) / 2, (markH - oh) / 2)
  }
  if (spec.kind === 'panel') {
    // A thin white board with the mark printed 0.5 mm proud, centred on its front.
    const placed = transform(art, 1, markW / 2, markH / 2, 0, h / 2)
    return {
      art,
      markH,
      solids: [box('panel', w, h, d, 0, 0, 0), ...extrude(placed, d / 2, d / 2 + 0.0005, true)],
    }
  }
  const depth = Math.max(d, MIN_DEPTH_M)
  if (spec.kind === 'hanging') {
    // Letters at the bottom of the bounds, on a back rail hung from two rods up to the top.
    const placed = transform(art, 1, markW / 2, 0, 0, 0)
    const letterD = Math.min(depth, 0.03)
    const back = -letterD / 2
    const rodX = markW / 2 - Math.min(0.08, markW / 10)
    return {
      art,
      markH,
      solids: [
        ...extrude(placed, -letterD / 2, letterD / 2, false),
        box('rod', markW * 0.98, 0.03, 0.01, 0, markH * 0.45, back - 0.005),
        box('rod', ROD_M, h - markH * 0.6, ROD_M, -rodX, markH * 0.6, back - ROD_M / 2),
        box('rod', ROD_M, h - markH * 0.6, ROD_M, rodX, markH * 0.6, back - ROD_M / 2),
      ],
    }
  }
  return {
    art,
    markH,
    solids: extrude(transform(art, 1, markW / 2, 0, 0, 0), -depth / 2, depth / 2, false),
  }
}

/** The mark as an SVG (y down), for the catalogue preview of the new version. */
function previewSvg(art: Art): string {
  const b = bounds(art.paths)
  const pad = (b.maxX - b.minX) * 0.06
  const fill = (c: string) =>
    /^#e[79]2e1e$/.test(c) ? '#e72e1e' : c === '#ffffff' ? '#ffffff' : '#3a3d44'
  const d = (p: ArtPath) =>
    p.cmds
      .map((c) => {
        if (c[0] === 'Z') return 'Z'
        const pts = c.slice(1) as number[]
        return c[0] + pts.map((v, i) => (i % 2 ? -v : v).toFixed(5)).join(' ')
      })
      .join('')
  const [w, h] = [b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX - pad} ${-b.maxY - pad} ${w} ${h}" width="1024" height="${Math.round((1024 * h) / w)}"><rect x="${b.minX - pad}" y="${-b.maxY - pad}" width="${w}" height="${h}" fill="#ffffff"/>${art.paths
    .map(
      (p) =>
        `<path d="${d(p)}" fill="${fill(p.color)}" fill-rule="${p.evenOdd ? 'evenodd' : 'nonzero'}"/>`,
    )
    .join('')}</svg>`
}

const ManifestPath = path.join(LIBRARY, 'manifest.json')
const readJson = async (file: string) =>
  JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')) as Record<string, unknown>

async function main() {
  const only = process.argv.includes('--only')
    ? process.argv[process.argv.indexOf('--only') + 1]
    : null
  const arts = await loadArts()
  const manifest = (await readJson(ManifestPath)) as { assets: Record<string, unknown>[] }
  const entries: { spec: LogoSpec; w: number; d: number; h: number }[] = []
  for (const spec of LOGOS) {
    if (only && spec.id !== only) continue
    const entry = manifest.assets.find((a) => a['asset_id'] === spec.id)
    const bounds3 = entry?.['tight_face_bounds_xyz_mm'] as [number, number, number] | undefined
    const w = spec.size?.w ?? (bounds3?.[0] ?? 0) / 1000
    const d = spec.size?.d ?? (bounds3?.[1] ?? 0) / 1000
    if (!w) throw new Error(`${spec.id}: no width`)
    const named = build(spec, arts, spec.named, w, d, 0)
    // Height: the mark's own for wall LOGOs, the SketchUp bounds for hanging ones (rods included).
    const h =
      spec.kind === 'hanging'
        ? Math.max((bounds3?.[2] ?? 0) / 1000, named.markH)
        : (spec.size?.h ?? named.markH)
    const dir = path.join(LIBRARY, BRAND_DIR, spec.folder)
    const web = path.join(dir, '网页模型')
    await mkdir(web, { recursive: true })
    const files: Record<Market, { file: string; bytes: number; glbSha256: string }> = {} as never
    for (const market of ['domestic', 'overseas'] as const) {
      const version = build(spec, arts, market, w, d, h)
      const data = glb(version.solids)
      const file = market === spec.named ? 'model.glb' : `${market}.glb`
      await writeFile(path.join(web, file), data)
      files[market] = { file, bytes: data.length, glbSha256: sha256(data) }
      if (market === spec.named)
        await writeFile(
          path.join(dir, '预览-新版字标.png'),
          await sharp(Buffer.from(previewSvg(version.art)))
            .png()
            .toBuffer(),
        )
    }
    const other: Market = spec.named === 'domestic' ? 'overseas' : 'domestic'
    const depth = spec.kind === 'panel' ? d : Math.max(d, MIN_DEPTH_M)
    const conversion = {
      id: spec.id,
      name: `${spec.folder.split('__')[0]} · 官方矢量自建`,
      unit: 'm',
      upAxis: 'Y',
      origin: 'bottom-center',
      front: '+Z',
      builder: 'apps/web/src/scripts/build-logo-models.ts',
      market: spec.named,
      dimensions: { w: Number(w.toFixed(6)), h: Number(h.toFixed(6)), d: Number(depth.toFixed(6)) },
      glbSha256: files[spec.named].glbSha256,
      bytes: files[spec.named].bytes,
      variants: { [other]: files[other] },
      sources: [...arts[spec.arts.domestic].sources, ...arts[spec.arts.overseas].sources],
      note: '以模型名对应的版本定尺寸，另一版等比缩放后居中放进同一范围（用户 10-15 L1）',
    }
    await writeFile(path.join(web, 'conversion.json'), `${JSON.stringify(conversion, null, 2)}\n`)
    console.log(
      `${spec.id} ${spec.folder.split('__')[0]}: ${Math.round(w * 1000)} × ${Math.round(depth * 1000)} × ${Math.round(h * 1000)} mm, ${files.domestic.bytes + files.overseas.bytes} 字节`,
    )
    if (!existsSync(path.join(web, 'model.glb'))) throw new Error(`${spec.id}: model.glb missing`)
    entries.push({ spec, w, d: depth, h })
  }
  if (!only) await updateCatalogue(manifest, entries)
}

/**
 * Points the manifest at the web models and the new previews, and adds the Leica co-brand
 * LOGO (manifest and facing.json) the first time. Running it again changes nothing.
 */
async function updateCatalogue(
  manifest: { assets: Record<string, unknown>[] },
  built: { spec: LogoSpec; w: number; d: number; h: number }[],
) {
  for (const { spec, w, d, h } of built) {
    const folder = `${BRAND_DIR}/${spec.folder}`
    let entry = manifest.assets.find((a) => a['asset_id'] === spec.id)
    if (!entry) {
      entry = {
        n: Math.max(...manifest.assets.map((a) => Number(a['n']) || 0)) + 1,
        asset_id: spec.id,
        si_family: '通用',
        standard_name: '墙面LOGO',
        variant: `影石Insta360徕卡联名_${Math.round(w * 1000)}mm`,
        match: '通用',
        confidence: '高（官方矢量自建）',
        judgment: '影石 × 徕卡联名墙面 LOGO，整体模组不可拆（用户 10-15 L3）',
        named_skp: null,
        source_skp: null,
        additional_views: [],
        tight_face_bounds_xyz_mm: [w, d, h].map((v) => Math.round(v * 1000)),
        named_sha256: null,
        material_category: '展陈物料',
        material_si: null,
        material_sort: 5,
        plan_legend: null,
        plan_legend_missing_reason: '官方矢量自建，无平面符号',
        type_name: null,
        product_image: null,
        product_image_match: null,
        plan_symbol: null,
        category: '品牌标识',
        category_si: null,
        folder,
        product_image_source: null,
        plan_symbol_source: null,
        display_name: '影石徕卡联名墙面LOGO',
      }
      manifest.assets.push(entry)
    }
    entry['web_model'] = `${folder}/网页模型`
    entry['preview'] = `${folder}/预览-新版字标.png`
  }
  await writeFile(ManifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const facingPath = path.join(LIBRARY, 'facing.json')
  let facing = await readFile(facingPath, 'utf8')
  if (!facing.includes(`"${NEW_LEICA_ID}"`)) {
    const nl = facing.includes('\r\n') ? '\r\n' : '\n'
    const tail = `${nl}  }${nl}}`
    const end = facing.lastIndexOf(tail)
    facing = `${facing.slice(0, end)},${nl}    "${NEW_LEICA_ID}": { "front": "+Z", "confidence": "high", "installation": "wall", "note": "徕卡联名墙面 LOGO，官方矢量自建，正面 +Z" }${facing.slice(end)}`
    JSON.parse(facing)
    await writeFile(facingPath, facing)
  }
}

await main()
