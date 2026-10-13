import { readFile, writeFile } from 'node:fs/promises'
import type { Document } from '@gltf-transform/core'
import { dedup, flatten, join, meshopt, prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import { sha256File } from '../../lib/storage.ts'
import { bounds, checkDrift, getIO, meshTriangles as triangles } from './gltf-tools.ts'
import type { WhiteRecord } from './light-records.ts'

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

  const driftM = checkDrift(before, document, WHITE_MAX_DRIFT_M)
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
    driftM,
  }
}
