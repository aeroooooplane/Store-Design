import type * as THREE from 'three'
import { DisplayBodyListSchema } from '@store/shared'
import type { DisplayBodyList, DisplayTable, SiStyle } from '@store/shared'
import { api, unwrap } from '../../../api/client.ts'
import { loadSource } from '../../viewer3d/model-cache.ts'

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
    const gltf = await loadSource(meta.url)
    return { meta, model: gltf.scene.clone(true) }
  } catch {
    return null
  }
}
