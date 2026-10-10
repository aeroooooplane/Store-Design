import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import type { Document } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, flatten, join, meshopt, prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import { z } from 'zod'
import { sha256File } from '../../lib/storage.ts'

/**
 * Light white-model versions of the web models. The full GLBs carry up to 2.5 million
 * triangles and 35 MB of textures; the white model shows neither colour nor texture, so it gets
 * a simplified, untextured copy. The full model stays for material renders.
 */
export const WHITE_TOOL = '@gltf-transform 4.5.1 + meshoptimizer 1.3.0'
/** Triangle budget per model; small models are left as they are. */
export const WHITE_TRIANGLE_BUDGET = 40_000
/** Largest allowed change of the model's outer size, in metres. */
export const WHITE_MAX_DRIFT_M = 0.005
/** Simplification error, relative to each merged part's extent (0.5 % ≈ 1 cm on 2 m). */
const SIMPLIFY_ERROR = 0.005
/** Below this alpha a surface is glass and stays see-through in the white model. */
const GLASS_ALPHA = 0.4

export const WhiteRecordSchema = z.object({
  tool: z.string(),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.int().positive(),
  sourceBytes: z.int().positive(),
  trianglesBefore: z.int().min(0),
  trianglesAfter: z.int().min(0),
  driftM: z.number().min(0),
})
export type WhiteRecord = z.infer<typeof WhiteRecordSchema>

let io: NodeIO | null = null

async function getIO(): Promise<NodeIO> {
  if (!io) {
    await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
    io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    })
  }
  return io
}

function triangles(document: Document): number {
  let count = 0
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices()
      count += (indices ?? prim.getAttribute('POSITION'))?.getCount() ?? 0
    }
  }
  return Math.round(count / 3)
}

/** World-space box of every mesh, with quantised positions decoded. */
function bounds(document: Document): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const p = [0, 0, 0]
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const m = node.getWorldMatrix()
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION')
      if (!position) continue
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, p)
        const [x = 0, y = 0, z = 0] = p
        const world = [
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        ]
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k] ?? Infinity, world[k] ?? 0)
          max[k] = Math.max(max[k] ?? -Infinity, world[k] ?? 0)
        }
      }
    }
  }
  return { min, max }
}

function drift(a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>): number {
  let worst = 0
  for (let k = 0; k < 3; k++) {
    worst = Math.max(
      worst,
      Math.abs((a.min[k] ?? 0) - (b.min[k] ?? 0)),
      Math.abs((a.max[k] ?? 0) - (b.max[k] ?? 0)),
    )
  }
  return worst
}

/**
 * Every opaque surface becomes the same matte white so that parts merge; glass keeps its
 * alpha. Textures, normals and UVs go: the viewer shades the white model flat.
 */
function whiten(document: Document) {
  const root = document.getRoot()
  for (const material of root.listMaterials()) {
    const alpha = material.getBaseColorFactor()[3] ?? 1
    const glass = material.getAlphaMode() === 'BLEND' && alpha < GLASS_ALPHA
    material
      .setBaseColorTexture(null)
      .setMetallicRoughnessTexture(null)
      .setNormalTexture(null)
      .setOcclusionTexture(null)
      .setEmissiveTexture(null)
      .setEmissiveFactor([0, 0, 0])
      .setBaseColorFactor([1, 1, 1, glass ? alpha : 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(1)
      .setAlphaMode(glass ? 'BLEND' : 'OPAQUE')
      .setDoubleSided(true)
      .setName(glass ? 'white-glass' : 'white')
    for (const extension of material.listExtensions())
      material.setExtension(extension.extensionName, null)
  }
  for (const texture of root.listTextures()) texture.dispose()
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const semantic of prim.listSemantics()) {
        if (semantic !== 'POSITION') prim.setAttribute(semantic, null)
      }
    }
  }
}

/** Builds `white.glb` (and returns its record) from one web model. */
export async function buildWhiteModel(source: string, target: string): Promise<WhiteRecord> {
  const io = await getIO()
  const sourceBytes = await readFile(source)
  const document = await io.readBinary(new Uint8Array(sourceBytes))
  const before = bounds(document)
  const trianglesBefore = triangles(document)

  whiten(document)
  await document.transform(dedup(), flatten(), join({ keepNamed: false }), weld())
  const ratio = Math.min(1, WHITE_TRIANGLE_BUDGET / Math.max(1, triangles(document)))
  if (ratio < 1) {
    await document.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio, error: SIMPLIFY_ERROR, lockBorder: false }),
    )
  }
  await document.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))

  const driftM = drift(before, bounds(document))
  if (driftM > WHITE_MAX_DRIFT_M) {
    throw new Error(
      `外形尺寸变化 ${(driftM * 1000).toFixed(1)} mm，超过 ${WHITE_MAX_DRIFT_M * 1000} mm`,
    )
  }
  const bytes = await io.writeBinary(document)
  await writeFile(target, bytes)
  return {
    tool: WHITE_TOOL,
    sourceSha256: await sha256File(source),
    sha256: await sha256File(target),
    bytes: bytes.byteLength,
    sourceBytes: sourceBytes.byteLength,
    trianglesBefore,
    trianglesAfter: triangles(document),
    driftM: Math.round(driftM * 10000) / 10000,
  }
}

/** Where the light model and its record live, next to `model.glb`. */
export function whitePaths(modelDir: string) {
  return {
    source: path.join(modelDir, 'model.glb'),
    glb: path.join(modelDir, 'white.glb'),
    record: path.join(modelDir, 'white.json'),
  }
}
