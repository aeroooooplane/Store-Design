import { NodeIO } from '@gltf-transform/core'
import type { Document } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'

/** glTF helpers shared by the light model builders (white.glb, finish.glb). */

let io: NodeIO | null = null

export async function getIO(): Promise<NodeIO> {
  if (!io) {
    await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
    io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    })
  }
  return io
}

/** Triangles per mesh, each mesh once however often it is placed (the white-model count). */
export function meshTriangles(document: Document): number {
  let count = 0
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      count += (prim.getIndices() ?? prim.getAttribute('POSITION'))?.getCount() ?? 0
    }
  }
  return Math.round(count / 3)
}

/** Triangles of every placed mesh (the material-model count). */
export function placedTriangles(document: Document): number {
  let count = 0
  for (const node of document.getRoot().listNodes()) {
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      count += (prim.getIndices() ?? prim.getAttribute('POSITION'))?.getCount() ?? 0
    }
  }
  return Math.round(count / 3)
}

export type Vec3 = readonly [number, number, number]

export function transform(m: readonly number[], p: number[]): Vec3 {
  const [x = 0, y = 0, z = 0] = p
  return [
    (m[0] ?? 1) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    (m[1] ?? 0) * x + (m[5] ?? 1) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 1) * z + (m[14] ?? 0),
  ]
}

export interface Bounds {
  min: number[]
  max: number[]
}

/** World-space box of every mesh, with quantised positions decoded. */
export function bounds(document: Document): Bounds {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const p = [0, 0, 0]
  for (const node of document.getRoot().listNodes()) {
    const m = node.getWorldMatrix()
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const position = prim.getAttribute('POSITION')
      if (!position) continue
      for (let i = 0; i < position.getCount(); i++) {
        const world = transform(m, position.getElement(i, p))
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k] ?? Infinity, world[k] ?? 0)
          max[k] = Math.max(max[k] ?? -Infinity, world[k] ?? 0)
        }
      }
    }
  }
  return { min, max }
}

/**
 * How far the outer size moved from `before`, in metres, rounded to 0.1 mm for the record;
 * throws when it moved more than `maxM`.
 */
export function checkDrift(before: Bounds, document: Document, maxM: number): number {
  const after = bounds(document)
  let worst = 0
  for (let k = 0; k < 3; k++) {
    worst = Math.max(
      worst,
      Math.abs((before.min[k] ?? 0) - (after.min[k] ?? 0)),
      Math.abs((before.max[k] ?? 0) - (after.max[k] ?? 0)),
    )
  }
  if (worst > maxM) {
    throw new Error(`外形尺寸变化 ${(worst * 1000).toFixed(1)} mm，超过 ${maxM * 1000} mm`)
  }
  return Math.round(worst * 10000) / 10000
}
