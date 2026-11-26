import * as THREE from 'three'
import { locatePoint, signedArea, wallContours } from '@store/shared'
import type { Point, ShopType, Space } from '@store/shared'

/** 通高边界墙的展示材质，白模和材质视图一致，不用于矮柜、柱子或隔板。 */
export const BOUNDARY_WALL_LOOK = { color: '#8f8f8f', opacity: 0.24 } as const

export function boundaryWallMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    ...BOUNDARY_WALL_LOOK,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    roughness: 0.9,
    metalness: 0,
  })
}

/** Extrude the merged footprint once: no intersecting boxes or internal transparent faces. */
export function boundaryWallGeometry(
  space: Space,
  shopType: ShopType,
): THREE.BufferGeometry | null {
  const rings = wallContours(space, shopType)
  if (!rings.length) return null
  const outers = rings.filter((r) => signedArea(r) > 0),
    holes = rings.filter((r) => signedArea(r) < 0)
  const vectors = (ring: readonly Point[]) => ring.map(([x, z]) => new THREE.Vector2(x, -z))
  const shapes = outers.map((ring) => new THREE.Shape(vectors(ring)))
  for (const hole of holes) {
    const hosts = outers
      .map((ring, i) => ({ ring, i }))
      .filter(({ ring }) => locatePoint(hole[0]!, ring, 1e-7) !== 'outside')
      .sort((a, b) => Math.abs(signedArea(a.ring)) - Math.abs(signedArea(b.ring)))
    if (hosts[0]) shapes[hosts[0].i]!.holes.push(new THREE.Path(vectors(hole)))
  }
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: space.height,
    bevelEnabled: false,
    steps: 1,
  })
  geometry.rotateX(-Math.PI / 2)
  return geometry
}
