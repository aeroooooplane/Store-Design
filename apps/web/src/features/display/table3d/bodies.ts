import * as THREE from 'three'
import { DisplayBodyListSchema } from '@store/shared'
import type { DisplayBodyList, DisplayTable, SiStyle } from '@store/shared'
import { api, unwrap } from '../../../api/client.ts'
import { separateBackLayers } from '../../viewer3d/back-layers.ts'
import { loadSource } from '../../viewer3d/model-cache.ts'
import { finishMaterial } from '../../viewer3d/render-look.ts'

/** Each library material once with the workbench's finish (metal, lacquer, glass by name). */
const finished = new Map<THREE.Material, THREE.Material>()
const frontOnly = new Map<THREE.Material, THREE.Material>()
/** The front-side variant of a material, for faces modelled twice back to back. */
function frontSided(material: THREE.Material) {
  let front = frontOnly.get(material)
  if (!front) {
    front = material.clone()
    front.side = THREE.FrontSide
    frontOnly.set(material, front)
  }
  return front
}
/** Each body prepared once (finishes, double faces); every view gets a clone of it. */
const prepared = new Map<string, Promise<THREE.Object3D>>()
function withFinish(model: THREE.Object3D) {
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    const mesh = node as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>
    const swap = (source: THREE.Material) => {
      let material = finished.get(source)
      if (!material) {
        // The scene's room environment lights the metals (no per-material map).
        material = finishMaterial(source, null)
        finished.set(source, material)
      }
      return material
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
  })
  return model
}

export type BodyMeta = DisplayBodyList['bodies'][number]

/** The table shown when the plan's own model has no bare body (or an upload has no model). */
const DEFAULT_BODY: Record<DisplayTable['kind'], Record<SiStyle, string>> = {
  island: { 'SI2.0': 'asset-24312623', 'SI1.0': 'asset-408124' },
  side: { 'SI2.0': 'asset-33660153', 'SI1.0': 'asset-34320268' },
}

let list: Promise<BodyMeta[]> | null = null

/** The bare tables in the library (fetched once per page). */
export function displayBodies(): Promise<BodyMeta[]> {
  list ??= api
    .GET('/api/v1/display-bodies')
    .then((result) => DisplayBodyListSchema.parse(unwrap(result)).bodies)
    .catch(() => {
      list = null
      return []
    })
  return list
}

/**
 * The real table to show: the plan's own model when its bare body exists, else the usual one
 * for the store's SI; null when neither is available (the drawn table stands in).
 */
export async function bodyFor(
  table: DisplayTable,
  si: SiStyle,
): Promise<{ meta: BodyMeta; model: THREE.Object3D } | null> {
  const bodies = await displayBodies()
  const meta =
    bodies.find((b) => b.asset === table.assetId && b.kind === table.kind) ??
    bodies.find((b) => b.asset === DEFAULT_BODY[table.kind][si])
  if (!meta) return null
  try {
    let template = prepared.get(meta.url)
    if (!template) {
      template = loadSource(meta.url).then((gltf) => {
        const model = withFinish(gltf.scene.clone(true))
        // SketchUp faces come in back-to-back pairs; drawn double-sided they flicker.
        separateBackLayers(model, frontSided)
        return model
      })
      template.catch(() => prepared.delete(meta.url))
      prepared.set(meta.url, template)
    }
    return { meta, model: (await template).clone(true) }
  } catch {
    return null
  }
}
