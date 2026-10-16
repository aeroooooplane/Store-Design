import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Document, Primitive } from '@gltf-transform/core'
import { flatten, join, meshopt, prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import { schema } from '@store/database'
import type { Database } from '@store/database'
import { DisplayBodyIndexSchema } from '@store/shared'
import type { DisplayBody, DisplayBodyList } from '@store/shared'
import { fileUrl } from '../../lib/file-url.ts'
import { contentTypeFor, isLfsPointer, resolveStoredFile, sha256File } from '../../lib/storage.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import { getIO, meshTriangles } from '../assets/gltf-tools.ts'

/**
 * Bare display tables for the 3D views (2026-10-16): the library's island tables and tray side
 * cabinets come with products, stands and price cards modelled on them. Everything above the
 * table top is cut away, leaving the real body. Where the trays stood (their footprints, nearly
 * flush with the top) is kept as `recesses`: the view covers them with silver plates and stands
 * the slot cards on them. The result goes into the library (small files).
 */
export const DISPLAY_BODY_DIR = '10_产品与陈列/展陈桌体'

export interface DisplayBodySource {
  asset: string
  kind: 'island' | 'side'
  si: 'SI1.0' | 'SI2.0'
  name: string
  /** Side cabinets: the side the trays face, in the model (the wall is opposite). */
  front?: '+x' | '-x' | '+z' | '-z'
  /** Island tables: the end slot's side along the long axis, when the recesses do not tell. */
  end?: 1 | -1
}

export const DISPLAY_BODY_SOURCES: DisplayBodySource[] = [
  { asset: 'asset-24312623', kind: 'island', si: 'SI2.0', name: '1.8米普通中岛桌' },
  { asset: 'asset-41053706', kind: 'island', si: 'SI2.0', name: '1.8米亮脚中岛桌' },
  { asset: 'asset-408124', kind: 'island', si: 'SI1.0', name: '1800mm普通中岛桌' },
  {
    asset: 'asset-33660153',
    kind: 'side',
    si: 'SI2.0',
    name: '1.8米配件边柜(带托盘)',
    front: '+z',
  },
  { asset: 'asset-34320268', kind: 'side', si: 'SI1.0', name: '1800mm边桌配件柜', front: '+x' },
]

/** Heights within this much above the top still belong to the table (rims, seams). */
const KEEP_ABOVE_TOP = 0.012
/** What stands this much above the top is a tray, a product or a stand. */
const ON_TOP = 0.0015
/** Widest the module strip is drawn. */
const STRIP_WIDTH = 0.14
/** A footprint smaller than this on either side is a price card or a seam, not a tray. */
const MIN_RECESS = 0.1
const GRID = 0.004
const TRIANGLE_BUDGET = 30_000

interface Triangle {
  a: number[]
  b: number[]
  c: number[]
}

/** Every triangle of the document in world space (after transforms were baked in). */
function* triangles(document: Document): Generator<Triangle> {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      if (!pos) continue
      const idx = prim.getIndices()
      const n = idx ? idx.getCount() : pos.getCount()
      const at = (i: number) => pos.getElement(idx ? idx.getScalar(i) : i, [])
      for (let k = 0; k + 2 < n; k += 3) yield { a: at(k), b: at(k + 1), c: at(k + 2) }
    }
  }
}

interface HeightMap {
  x0: number
  z0: number
  w: number
  h: number
  y: Float32Array
}

/** Highest surface seen from above, on a 4 mm grid. */
function heightMap(document: Document, minX: number, minZ: number, maxX: number, maxZ: number) {
  const w = Math.ceil((maxX - minX) / GRID) + 1
  const h = Math.ceil((maxZ - minZ) / GRID) + 1
  const y = new Float32Array(w * h).fill(-1)
  for (const t of triangles(document)) {
    const p = [t.a, t.b, t.c]
    const gx = p.map((v) => ((v[0] ?? 0) - minX) / GRID)
    const gz = p.map((v) => ((v[2] ?? 0) - minZ) / GRID)
    const [ax, bx, cx] = gx as [number, number, number]
    const [az, bz, cz] = gz as [number, number, number]
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (Math.abs(d) < 1e-9) continue
    for (
      let z = Math.max(0, Math.floor(Math.min(az, bz, cz)));
      z <= Math.min(h - 1, Math.ceil(Math.max(az, bz, cz)));
      z++
    ) {
      for (
        let x = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
        x <= Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
        x++
      ) {
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
        const l3 = 1 - l1 - l2
        if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue
        const height = l1 * (t.a[1] ?? 0) + l2 * (t.b[1] ?? 0) + l3 * (t.c[1] ?? 0)
        const i = z * w + x
        if (height > (y[i] ?? -1)) y[i] = height
      }
    }
  }
  return { x0: minX, z0: minZ, w, h, y } satisfies HeightMap
}

/** The table top: the height seen over most of the area from above, between 0.6 and 1.2 m. */
function topHeight(map: HeightMap) {
  const counts = new Map<number, number>()
  for (const v of map.y) {
    if (v < 0.6 || v > 1.2) continue
    const k = Math.round(v / 0.005) * 0.005
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const best = [...counts].sort((p, q) => q[1] - p[1])[0]
  if (!best) throw new Error('找不到桌面高度')
  // The highest of the common heights near it: a top of 0.905 m reads as 0.900 and 0.905.
  return Math.max(
    ...[...counts]
      .filter(([k, n]) => Math.abs(k - best[0]) <= 0.0101 && n > best[1] * 0.25)
      .map(([k]) => k),
  )
}

type Rect = DisplayBody['recesses'][number]

/** Trays: footprints of what stands on the top (tray, product, stand), large enough for a tray. */
function recesses(map: HeightMap, top: number) {
  return patches(map, (v) => v > top + ON_TOP, MIN_RECESS, 0.4).sort(
    (p, q) => p.x - q.x || p.z - q.z,
  )
}

/**
 * The accessory-module strip of an island table: between its two rows of trays, along them.
 * (Seen from above it is hidden by what stands in it, so it is found from the rows.)
 */
function moduleStrip(trays: Rect[], long: 'x' | 'z'): Rect | null {
  const cross = (r: Rect) => (long === 'x' ? r.z : r.x)
  const half = (r: Rect) => (long === 'x' ? r.d : r.w) / 2
  const along = (r: Rect) => (long === 'x' ? r.x : r.z)
  const reach = (r: Rect) => (long === 'x' ? r.w : r.d) / 2
  // Row trays lie along the table; the end tray lies across it.
  const big = trays.filter((r) => Math.min(r.w, r.d) >= 0.15 && 2 * reach(r) >= 2 * half(r))
  const plus = big.filter((r) => cross(r) > 0)
  const minus = big.filter((r) => cross(r) < 0)
  if (plus.length < 2 || minus.length < 2) return null
  const c0 = Math.max(...minus.map((r) => cross(r) + half(r)))
  const c1 = Math.min(...plus.map((r) => cross(r) - half(r)))
  if (c1 - c0 < 0.04) return null
  const rows = [...plus, ...minus]
  const a0 = Math.min(...rows.map((r) => along(r) - reach(r)))
  const a1 = Math.max(...rows.map((r) => along(r) + reach(r)))
  const mid = { cross: (c0 + c1) / 2, along: (a0 + a1) / 2 }
  // The strip itself is narrow; the gap between the rows can be much wider (SI1.0).
  const width = Math.min(c1 - c0, STRIP_WIDTH)
  return long === 'x'
    ? { x: round(mid.along), z: round(mid.cross), w: round(a1 - a0), d: round(width) }
    : { x: round(mid.cross), z: round(mid.along), w: round(width), d: round(a1 - a0) }
}

/** Rectangles around connected cells passing `inside`, not touching the edge of the map. */
function patches(map: HeightMap, test: (height: number) => boolean, min: number, minFill: number) {
  const inside = (i: number) => test(map.y[i] ?? -1)
  const seen = new Uint8Array(map.w * map.h)
  const found: DisplayBody['recesses'] = []
  for (let start = 0; start < map.w * map.h; start++) {
    if (seen[start] || !inside(start)) continue
    const stack = [start]
    seen[start] = 1
    let [x0, x1, z0, z1, count] = [Infinity, -Infinity, Infinity, -Infinity, 0]
    let edge = false
    while (stack.length) {
      const i = stack.pop() ?? 0
      const x = i % map.w
      const z = Math.floor(i / map.w)
      count++
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      z0 = Math.min(z0, z)
      z1 = Math.max(z1, z)
      if (x === 0 || z === 0 || x === map.w - 1 || z === map.h - 1) edge = true
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx
        const nz = z + dz
        if (nx < 0 || nz < 0 || nx >= map.w || nz >= map.h) continue
        const j = nz * map.w + nx
        if (!seen[j] && inside(j)) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    const w = (x1 - x0 + 1) * GRID
    const d = (z1 - z0 + 1) * GRID
    const fill = (count * GRID * GRID) / (w * d)
    if (edge || w < min || d < min || fill < minFill) continue
    found.push({
      x: round(map.x0 + ((x0 + x1 + 1) / 2) * GRID),
      z: round(map.z0 + ((z0 + z1 + 1) / 2) * GRID),
      w: round(w),
      d: round(d),
    })
  }
  return found
}

const round = (v: number) => Math.round(v * 1000) / 1000

/**
 * Gives every placed part its own copy of its geometry in world space (positions, normals and
 * indices only) and clears the placements. Meshes shared by several parts stay untouched until
 * pruned, so no placement is applied twice.
 */
function bakeWorld(document: Document) {
  const root = document.getRoot()
  const buffer = root.listBuffers()[0] ?? document.createBuffer()
  const accessor = (
    type: 'VEC3' | 'SCALAR',
    array: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
  ) => document.createAccessor().setType(type).setBuffer(buffer).setArray(array)
  for (const node of root.listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const m = node.getWorldMatrix()
    const at = (v: number[], w: number) => [
      (m[0] ?? 0) * (v[0] ?? 0) +
        (m[4] ?? 0) * (v[1] ?? 0) +
        (m[8] ?? 0) * (v[2] ?? 0) +
        (m[12] ?? 0) * w,
      (m[1] ?? 0) * (v[0] ?? 0) +
        (m[5] ?? 0) * (v[1] ?? 0) +
        (m[9] ?? 0) * (v[2] ?? 0) +
        (m[13] ?? 0) * w,
      (m[2] ?? 0) * (v[0] ?? 0) +
        (m[6] ?? 0) * (v[1] ?? 0) +
        (m[10] ?? 0) * (v[2] ?? 0) +
        (m[14] ?? 0) * w,
    ]
    // A mirroring placement turns the faces inside out; swap the winding back.
    const det =
      (m[0] ?? 0) * ((m[5] ?? 0) * (m[10] ?? 0) - (m[6] ?? 0) * (m[9] ?? 0)) -
      (m[4] ?? 0) * ((m[1] ?? 0) * (m[10] ?? 0) - (m[2] ?? 0) * (m[9] ?? 0)) +
      (m[8] ?? 0) * ((m[1] ?? 0) * (m[6] ?? 0) - (m[2] ?? 0) * (m[5] ?? 0))
    const baked = document.createMesh(mesh.getName())
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      if (!pos || prim.getMode() !== 4) continue
      const nor = prim.getAttribute('NORMAL')
      const idx = prim.getIndices()
      const count = pos.getCount()
      const positions = new Float32Array(count * 3)
      const normals = nor ? new Float32Array(count * 3) : null
      for (let i = 0; i < count; i++) {
        positions.set(at(pos.getElement(i, []), 1), i * 3)
        if (nor && normals) {
          const n = at(nor.getElement(i, []), 0)
          const len = Math.hypot(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0) || 1
          normals.set(
            n.map((v) => v / len),
            i * 3,
          )
        }
      }
      const n = idx ? idx.getCount() : count
      const indices = new Uint32Array(n - (n % 3))
      for (let k = 0; k < indices.length; k += 3) {
        const a = idx ? idx.getScalar(k) : k
        const b = idx ? idx.getScalar(k + 1) : k + 1
        const c = idx ? idx.getScalar(k + 2) : k + 2
        indices.set(det < 0 ? [a, c, b] : [a, b, c], k)
      }
      const copy = document
        .createPrimitive()
        .setMaterial(prim.getMaterial())
        .setAttribute('POSITION', accessor('VEC3', positions))
        .setIndices(accessor('SCALAR', indices))
      if (normals) copy.setAttribute('NORMAL', accessor('VEC3', normals))
      baked.addPrimitive(copy)
    }
    node.setMesh(baked).setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  }
}

/** Small parts lying on a tray footprint (stand feet, price cards) go too; the plate covers it. */
const FOOTPRINT = { margin: 0.01, below: 0.09, area: 0.004 }

/**
 * Keeps the triangles that do not reach above `limit`, except small ones on a tray footprint
 * near the top (the primitive must be indexed).
 */
function clip(prim: Primitive, limit: number, top: number, trays: Rect[]) {
  const pos = prim.getAttribute('POSITION')
  const idx = prim.getIndices()
  if (!pos || !idx) return
  const keep: number[] = []
  for (let k = 0; k + 2 < idx.getCount(); k += 3) {
    const ids = [idx.getScalar(k), idx.getScalar(k + 1), idx.getScalar(k + 2)]
    const p = ids.map((i) => pos.getElement(i, [] as number[]))
    const ys = p.map((v) => v[1] ?? 0)
    if (Math.max(...ys) > limit) continue
    if (Math.max(...ys) > top - FOOTPRINT.below) {
      const cx = p.reduce((n, v) => n + (v[0] ?? 0), 0) / 3
      const cz = p.reduce((n, v) => n + (v[2] ?? 0), 0) / 3
      const [a = [], b = [], c = []] = p
      const u = [(b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0), (b[2] ?? 0) - (a[2] ?? 0)]
      const w = [(c[0] ?? 0) - (a[0] ?? 0), (c[1] ?? 0) - (a[1] ?? 0), (c[2] ?? 0) - (a[2] ?? 0)]
      const area =
        Math.hypot(
          (u[1] ?? 0) * (w[2] ?? 0) - (u[2] ?? 0) * (w[1] ?? 0),
          (u[2] ?? 0) * (w[0] ?? 0) - (u[0] ?? 0) * (w[2] ?? 0),
          (u[0] ?? 0) * (w[1] ?? 0) - (u[1] ?? 0) * (w[0] ?? 0),
        ) / 2
      const onTray = trays.some(
        (t) =>
          Math.abs(cx - t.x) <= t.w / 2 + FOOTPRINT.margin &&
          Math.abs(cz - t.z) <= t.d / 2 + FOOTPRINT.margin,
      )
      if (onTray && area < FOOTPRINT.area) continue
    }
    keep.push(...ids)
  }
  idx.setArray(new Uint32Array(keep))
}

/** Island tables: which end of the long axis holds the end slot E, from the recesses. */
function endOf(recesses: DisplayBody['recesses'], long: 'x' | 'z'): 1 | -1 {
  if (recesses.length < 2) return -1
  const along = recesses.map((r) => (long === 'x' ? r.x : r.z))
  const lo = Math.min(...along)
  const hi = Math.max(...along)
  // E sits alone at its end: count the recesses within 0.2 m of each extreme.
  const near = (v: number) => along.filter((a) => Math.abs(a - v) < 0.2).length
  return near(lo) <= near(hi) ? -1 : 1
}

/** Cuts one library model down to its bare body and describes its recesses. */
export async function buildDisplayBody(
  source: DisplayBodySource,
  modelPath: string,
  target: string,
): Promise<DisplayBody> {
  const io = await getIO()
  const data = await readFile(modelPath)
  const document = await io.readBinary(new Uint8Array(data))
  await document.transform(flatten())
  bakeWorld(document)
  await document.transform(prune())

  let [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity]
  for (const t of triangles(document))
    for (const p of [t.a, t.b, t.c]) {
      minX = Math.min(minX, p[0] ?? 0)
      maxX = Math.max(maxX, p[0] ?? 0)
      minZ = Math.min(minZ, p[2] ?? 0)
      maxZ = Math.max(maxZ, p[2] ?? 0)
    }
  const full = heightMap(document, minX, minZ, maxX, maxZ)
  const top = topHeight(full)
  const found = recesses(full, top)
  const long = maxX - minX >= maxZ - minZ ? 'x' : 'z'
  const strip = source.kind === 'island' ? moduleStrip(found, long) : null

  // Products, stands, cards: everything reaching above the top goes.
  for (const mesh of document.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives())
      clip(prim, top + KEEP_ABOVE_TOP, top, strip ? [...found, strip] : found)
  // Plain colours only: textures would make the file large and the view does not need them.
  const root = document.getRoot()
  for (const material of root.listMaterials()) {
    material
      .setBaseColorTexture(null)
      .setMetallicRoughnessTexture(null)
      .setNormalTexture(null)
      .setOcclusionTexture(null)
      .setEmissiveTexture(null)
  }
  for (const texture of root.listTextures()) texture.dispose()
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives())
      for (const semantic of prim.listSemantics())
        if (semantic.startsWith('TEXCOORD') || semantic.startsWith('COLOR'))
          prim.setAttribute(semantic, null)
  // One part per material, then fewer triangles: the body is seen whole, never up close.
  await document.transform(prune(), join({ keepNamed: false }), weld())
  const ratio = Math.min(1, TRIANGLE_BUDGET / Math.max(1, meshTriangles(document)))
  if (ratio < 1)
    await document.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.006, lockBorder: false }),
    )
  await document.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const bytes = await io.writeBinary(document)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, bytes)

  return {
    asset: source.asset,
    kind: source.kind,
    si: source.si,
    name: source.name,
    file: `${source.asset}.glb`,
    top: round(top),
    size: { x: round(maxX - minX), z: round(maxZ - minZ) },
    center: { x: round((minX + maxX) / 2), z: round((minZ + maxZ) / 2) },
    long,
    end: source.kind === 'island' ? (source.end ?? endOf(found, long)) : null,
    front: source.front ?? null,
    recesses: found,
    strip,
    triangles: meshTriangles(document),
    bytes: bytes.length,
    sourceSha256: createHash('sha256').update(data).digest('hex'),
  }
}

/**
 * The bare tables in the library with download links. Each file is registered in place
 * (root 'resource') the first time it is asked for; a missing index or an LFS pointer means the
 * views fall back to the drawn tables.
 */
export async function listDisplayBodies(
  db: Database,
  roots: StorageRoots,
): Promise<DisplayBodyList> {
  let index
  try {
    const { file } = await resolveStoredFile(roots, 'resource', `${DISPLAY_BODY_DIR}/index.json`)
    index = DisplayBodyIndexSchema.parse(JSON.parse(await readFile(file, 'utf8')))
  } catch {
    return { bodies: [] }
  }
  const bodies: DisplayBodyList['bodies'] = []
  for (const body of index.bodies) {
    const key = `${DISPLAY_BODY_DIR}/${body.file}`
    try {
      const resolved = await resolveStoredFile(roots, 'resource', key)
      if (await isLfsPointer(resolved.file, resolved.bytes)) continue
      const [row] = await db
        .insert(schema.storedFiles)
        .values({
          root: 'resource',
          storageKey: key,
          kind: 'display-body',
          contentType: contentTypeFor(key),
          bytes: resolved.bytes,
          sha256: await sha256File(resolved.file),
        })
        .onConflictDoUpdate({
          target: [schema.storedFiles.root, schema.storedFiles.storageKey],
          set: { bytes: resolved.bytes, sha256: await sha256File(resolved.file) },
        })
        .returning({ id: schema.storedFiles.id })
      if (row) bodies.push({ ...body, url: fileUrl(row.id) })
    } catch {
      // Not in this checkout: the drawn table stands in.
    }
  }
  return { bodies }
}
