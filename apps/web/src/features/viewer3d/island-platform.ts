import * as THREE from 'three'
import { signedArea } from '@store/shared'
import type { Point } from '@store/shared'
import { RENDER_LOOK } from './render-look.ts'
import { offsetOutline } from './outline-offset.ts'

/** Model floor stays at y=0; public ground is 30 mm lower, preserving prop elevations. */
export const ISLAND_PLATFORM_HEIGHT_M = RENDER_LOOK.edging.height

/** 80 mm cap: 50 mm flat, then a 30 × 30 mm outward slope (45°). */
export function islandEdgingGeometry(boundary: readonly Point[]): THREE.BufferGeometry {
  const height = ISLAND_PLATFORM_HEIGHT_M
  const ring = signedArea(boundary) > 0 ? [...boundary] : [...boundary].reverse()
  const shoulder = offsetOutline(ring, RENDER_LOOK.edging.width - height)
  const toe = offsetOutline(ring, RENDER_LOOK.edging.width)
  const positions: number[] = []
  type V = [number, number, number]
  const at = (p: Point, y: number): V => [p[0], y, p[1]]
  const quad = (a: V, b: V, c: V, d: V) => positions.push(...a, ...b, ...c, ...a, ...c, ...d)
  ring.forEach((a, i) => {
    const j = (i + 1) % ring.length,
      b = ring[j]!
    const sa = shoulder[i]!,
      sb = shoulder[j]!,
      ta = toe[i]!,
      tb = toe[j]!
    quad(at(a, 0), at(b, 0), at(sb, 0), at(sa, 0))
    quad(at(sa, 0), at(sb, 0), at(tb, -height), at(ta, -height))
    quad(at(ta, -height), at(tb, -height), at(b, -height), at(a, -height))
    quad(at(a, -height), at(b, -height), at(b, 0), at(a, 0))
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}
