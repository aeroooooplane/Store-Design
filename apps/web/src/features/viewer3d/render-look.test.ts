import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Space } from '@store/shared'
import { finishMaterial, floorLayout, roomMaterials } from './render-look.ts'

describe('finishMaterial', () => {
  it('draws props double-sided, except faces the light model marks front-side only', () => {
    const plain = new THREE.MeshStandardMaterial()
    expect(finishMaterial(plain, null).side).toBe(THREE.DoubleSide)

    const marked = new THREE.MeshStandardMaterial()
    marked.userData['frontOnly'] = true
    const finished = finishMaterial(marked, null)
    expect(finished.side).toBe(THREE.FrontSide)
    expect(finished).not.toBe(marked)
  })
})

/** A shop whose front-right corner is cut off by a slanted edge from (10, 4) to (7, 8). */
function slanted(a: [number, number], b: [number, number]): Space {
  return {
    schemaVersion: 1,
    boundary: [
      [0, 0],
      [10, 0],
      [10, 4],
      [7, 8],
      [0, 8],
    ],
    height: 3,
    entrances: [{ a, b, kind: 'main' }],
    openEdges: [],
    obstacles: [],
    calibration: null,
  }
}

describe('floor tiles on a slanted entrance', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('turns the tiles parallel to the entrance', () => {
    // Entrance along (−3, 4): steeper than 45°, so the long side runs along z, turned by
    // atan(3 / 4) ≈ 36.9° (a negative turn in floor UVs, where z is flipped).
    const layout = floorLayout(slanted([10, 4], [7, 8]), 'side_hall')
    expect(layout.alongX).toBe(false)
    expect(layout.origin).toEqual([8.5, 6])
    expect(layout.angle).toBeCloseTo(-Math.atan2(3, 4), 6)
    // Either direction of the same entrance gives the same tiles.
    expect(floorLayout(slanted([7, 8], [10, 4]), 'side_hall').angle).toBeCloseTo(
      layout.angle ?? 0,
      6,
    )
    // A flat 3:1 entrance keeps the long side along x and turns it by atan(1 / 3).
    const flat = floorLayout(slanted([10, 4], [7, 5]), 'side_hall')
    expect(flat.alongX).toBe(true)
    expect(flat.angle).toBeCloseTo(Math.atan2(1, 3), 6)
  })

  it('maps the entrance direction onto the long side of the tiles, centred on its midpoint', () => {
    // A 2D context that ignores drawing (jsdom has no canvas).
    const context = new Proxy({}, { get: () => () => undefined, set: () => true })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    const map = roomMaterials('SI2.0', 'side_hall', slanted([10, 4], [7, 8])).floor.map
    if (!map) throw new Error('no floor texture')
    map.updateMatrix()
    // Floor UVs are (x, −z); the texture holds 4 × 4 tiles of 0.6 × 1.2 m (long side along v).
    const toTexture = (x: number, z: number) => new THREE.Vector2(x, -z).applyMatrix3(map.matrix)
    const middle = toTexture(8.5, 6)
    expect(middle.x).toBeCloseTo(0.125, 6)
    expect(middle.y).toBeCloseTo(0.125, 6)
    // One tile length (1.2 m) along the entrance moves exactly one tile along v.
    const along = toTexture(8.5 - 0.6 * 1.2, 6 + 0.8 * 1.2)
    expect(along.x - middle.x).toBeCloseTo(0, 6)
    expect(Math.abs(along.y - middle.y)).toBeCloseTo(0.25, 6)
    // And one tile width (0.6 m) across it moves one tile along u.
    const across = toTexture(8.5 + 0.8 * 0.6, 6 + 0.6 * 0.6)
    expect(Math.abs(across.x - middle.x)).toBeCloseTo(0.25, 6)
    expect(across.y - middle.y).toBeCloseTo(0, 6)
  })

  it('leaves entrances along x or z unturned', () => {
    const square = slanted([2, 8], [5, 8])
    expect(floorLayout(square, 'side_hall')).toEqual({ alongX: true, origin: [3.5, 8] })
  })
})
