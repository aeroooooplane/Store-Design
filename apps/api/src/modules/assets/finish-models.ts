import { readFile, writeFile } from 'node:fs/promises'
import { Primitive } from '@gltf-transform/core'
import type { Accessor, Document, Material, Mesh } from '@gltf-transform/core'
import {
  dedup,
  flatten,
  join,
  meshopt,
  prune,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { sha256File } from '../../lib/storage.ts'
import { bounds, checkDrift, getIO, placedTriangles as triangles, transform } from './gltf-tools.ts'
import type { Vec3 } from './gltf-tools.ts'
import type { FinishRecord } from './light-records.ts'

/**
 * Light material versions of the web models, for the material look (renders and the 3D
 * views). SketchUp exports split a prop into hundreds of parts, sometimes thousands of tiny
 * textured patches, with textures of 1500 px and more; drawn as they are, a shop of a few props
 * stalls the page for seconds. The light copy keeps the look: parts of one material are joined
 * into one draw, tiny patches become plain colours, textures shrink, very dense meshes are
 * simplified within millimetres, and the two sides of SketchUp faces are marked so the viewer
 * need not search for them.
 */
export const FINISH_TOOL = '@gltf-transform 4.5.1 + meshoptimizer 1.3.0 + sharp'
/** Longest texture side; a prop seldom covers more than a third of a 1800 px render. */
export const FINISH_TEXTURE_PX = 1024
/** Triangle budget per model; denser models are simplified. */
export const FINISH_TRIANGLE_BUDGET = 250_000
/** Simplification error, relative to each merged part's extent (0.2 % ≈ 4 mm on 2 m). */
const SIMPLIFY_ERROR = 0.002
/** Largest allowed change of the model's outer size, in metres. */
export const FINISH_MAX_DRIFT_M = 0.005
/** A textured material this small (texture side and surface) becomes its average colour. */
const SPECK_TEXTURE_PX = 256
const SPECK_AREA_M2 = 0.01
/** Positions are matched on a 1 mm grid when looking for the two sides of a face. */
const GRID = 1000
/** Normals this close to opposite count as the two sides of one face. */
const OPPOSITE = -0.9
/** Set on the material of such triangles; the viewer draws it front-side only. */
export const FRONT_ONLY = 'frontOnly'

/** Every placed primitive is one draw. */
function draws(document: Document): number {
  let count = 0
  for (const node of document.getRoot().listNodes()) {
    count += node.getMesh()?.listPrimitives().length ?? 0
  }
  return count
}

interface Triangle {
  prim: Primitive
  index: number
  normal: Vec3
}

interface Analysis {
  /** Triangles that are one side of a two-sided face, per primitive. */
  paired: Map<Primitive, Set<number>>
  /** World-space surface per material, in m². */
  areas: Map<Material | null, number>
}

/** One pass over every triangle in world space: two-sided faces and surface per material. */
export function analyse(document: Document): Analysis {
  const faces = new Map<string, Triangle[]>()
  const areas = new Map<Material | null, number>()
  const seen = new Set<Primitive>()
  const p = [0, 0, 0]
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const m = node.getWorldMatrix()
    for (const prim of mesh.listPrimitives()) {
      // A primitive placed several times is judged by its first placement.
      if (seen.has(prim) || prim.getMode() !== Primitive.Mode.TRIANGLES) continue
      seen.add(prim)
      const position = prim.getAttribute('POSITION')
      if (!position) continue
      const indices = prim.getIndices()
      const corner = (i: number) =>
        transform(m, position.getElement(indices ? indices.getScalar(i) : i, p))
      const count = (indices ? indices.getCount() : position.getCount()) / 3
      let area = 0
      for (let t = 0; t < count; t++) {
        const a = corner(t * 3)
        const b = corner(t * 3 + 1)
        const c = corner(t * 3 + 2)
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        const length = Math.hypot(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0)
        if (length < 1e-12) continue
        area += length / 2
        const key = [a, b, c]
          .map(
            (q) =>
              `${Math.round(q[0] * GRID)},${Math.round(q[1] * GRID)},${Math.round(q[2] * GRID)}`,
          )
          .sort()
          .join('|')
        const triangle: Triangle = {
          prim,
          index: t,
          normal: [(n[0] ?? 0) / length, (n[1] ?? 0) / length, (n[2] ?? 0) / length],
        }
        const list = faces.get(key)
        if (list) list.push(triangle)
        else faces.set(key, [triangle])
      }
      const material = prim.getMaterial()
      areas.set(material, (areas.get(material) ?? 0) + area)
    }
  }

  const paired = new Map<Primitive, Set<number>>()
  const mark = (triangle: Triangle) => {
    const set = paired.get(triangle.prim) ?? new Set<number>()
    set.add(triangle.index)
    paired.set(triangle.prim, set)
  }
  for (const list of faces.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const first = list[i]
        const second = list[j]
        if (!first || !second) continue
        const dot =
          first.normal[0] * second.normal[0] +
          first.normal[1] * second.normal[1] +
          first.normal[2] * second.normal[2]
        if (dot < OPPOSITE) {
          mark(first)
          mark(second)
        }
      }
    }
  }
  return { paired, areas }
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/**
 * SketchUp's projected textures arrive as thousands of tiny patches, each with its own material
 * and image of a few dozen pixels: one draw each. A patch this small shows as its average
 * colour anyway, so it becomes that colour, written into the vertices, and every patch shares
 * one plain material (one draw after joining). Returns how many materials were flattened.
 */
export async function flattenSpecks(
  document: Document,
  areas: ReadonlyMap<Material | null, number>,
): Promise<number> {
  const root = document.getRoot()
  const buffer = root.listBuffers()[0] ?? document.createBuffer()
  const patch = document
    .createMaterial('色块')
    .setBaseColorFactor([1, 1, 1, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.8)
    .setDoubleSided(true)
  let count = 0
  for (const material of root.listMaterials()) {
    const texture = material.getBaseColorTexture()
    const size = texture?.getSize()
    const image = texture?.getImage()
    if (!texture || !size || !image || material === patch) continue
    if (Math.max(size[0], size[1]) > SPECK_TEXTURE_PX) continue
    if ((areas.get(material) ?? Infinity) >= SPECK_AREA_M2) continue
    if (material.getAlphaMode() === 'BLEND') continue
    let mean: number[]
    try {
      const { channels } = await sharp(image).stats()
      mean = channels.slice(0, 3).map((c) => toLinear(c.mean / 255))
    } catch {
      continue
    }
    const factor = material.getBaseColorFactor()
    const color = mean.map((c, k) => c * (factor[k] ?? 1))
    for (const parent of material.listParents()) {
      if (!(parent instanceof Primitive)) continue
      const position = parent.getAttribute('POSITION')
      if (!position) continue
      const colors = new Float32Array(position.getCount() * 3)
      for (let i = 0; i < position.getCount(); i++) colors.set(color, i * 3)
      parent
        .setAttribute(
          'COLOR_0',
          document.createAccessor().setType('VEC3').setArray(colors).setBuffer(buffer),
        )
        .setAttribute('TEXCOORD_0', null)
        .setMaterial(patch)
    }
    count++
  }
  return count
}

/**
 * SketchUp faces have a front and a back material, exported as two coincident triangles facing
 * opposite ways. Props are drawn double-sided (SketchUp leaves some faces reversed), so the
 * inner layer would show through the outer one: an island table's dark edge band looks like
 * the white top painted on its inside. Such triangles move to their own primitive whose
 * material is marked front-side only. Returns how many triangles were paired.
 */
export function splitBackLayers(document: Document, paired: Analysis['paired']): number {
  const root = document.getRoot()
  const buffer = root.listBuffers()[0] ?? document.createBuffer()
  const frontOnly = new Map<Material | null, Material>()
  const variant = (material: Material | null) => {
    let front = frontOnly.get(material)
    if (!front) {
      front = (material ? material.clone() : document.createMaterial('default'))
        .setName(`${material?.getName() ?? 'default'} · front`)
        .setDoubleSided(false)
        .setExtras({ ...(material?.getExtras() ?? {}), [FRONT_ONLY]: true })
      frontOnly.set(material, front)
    }
    return front
  }
  const indexAccessor = (values: number[], vertices: number): Accessor =>
    document
      .createAccessor()
      .setType('SCALAR')
      .setArray(vertices > 65535 ? new Uint32Array(values) : new Uint16Array(values))
      .setBuffer(buffer)
  let total = 0
  for (const [prim, set] of paired) {
    total += set.size
    const position = prim.getAttribute('POSITION')
    if (!position) continue
    const indices = prim.getIndices()
    const count = (indices ? indices.getCount() : position.getCount()) / 3
    const corner = (i: number) => (indices ? indices.getScalar(i) : i)
    const kept: number[] = []
    const moved: number[] = []
    for (let t = 0; t < count; t++) {
      const target = set.has(t) ? moved : kept
      target.push(corner(t * 3), corner(t * 3 + 1), corner(t * 3 + 2))
    }
    const front = variant(prim.getMaterial())
    if (!kept.length) {
      prim.setMaterial(front)
      continue
    }
    const twin = prim.clone()
    twin.setIndices(indexAccessor(moved, position.getCount())).setMaterial(front)
    prim.setIndices(indexAccessor(kept, position.getCount()))
    for (const parent of prim.listParents()) {
      if (parent.propertyType === 'Mesh') (parent as Mesh).addPrimitive(twin)
    }
  }
  return total
}

/**
 * The viewer shades props flat (normals from the surface itself), so stored normals only keep
 * SketchUp's per-face vertices apart: without them vertices weld and dense meshes simplify.
 */
function dropNormals(document: Document) {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) prim.setAttribute('NORMAL', null)
  }
}

/** Builds `finish.glb` (and returns its record) from one web model. */
export async function buildFinishModel(source: string, target: string): Promise<FinishRecord> {
  const io = await getIO()
  const sourceBytes = await readFile(source)
  const document = await io.readBinary(new Uint8Array(sourceBytes))
  const before = bounds(document)
  const drawsBefore = draws(document)
  const trianglesBefore = triangles(document)

  const { paired, areas } = analyse(document)
  const specks = await flattenSpecks(document, areas)
  const pairedTriangles = splitBackLayers(document, paired)
  dropNormals(document)
  await document.transform(dedup(), flatten(), join({ keepNamed: false }), weld())
  const ratio = Math.min(1, FINISH_TRIANGLE_BUDGET / Math.max(1, triangles(document)))
  if (ratio < 1) {
    await document.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio, error: SIMPLIFY_ERROR, lockBorder: true }),
    )
  }
  await document.transform(
    prune(),
    textureCompress({
      encoder: sharp,
      resize: [FINISH_TEXTURE_PX, FINISH_TEXTURE_PX],
      quality: 85,
    }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )

  const driftM = checkDrift(before, document, FINISH_MAX_DRIFT_M)
  const bytes = await io.writeBinary(document)
  await writeFile(target, bytes)
  return {
    tool: FINISH_TOOL,
    sourceSha256: await sha256File(source),
    sha256: await sha256File(target),
    bytes: bytes.byteLength,
    sourceBytes: sourceBytes.byteLength,
    trianglesBefore,
    trianglesAfter: triangles(document),
    drawsBefore,
    drawsAfter: draws(document),
    specks,
    pairedTriangles,
    driftM,
  }
}
