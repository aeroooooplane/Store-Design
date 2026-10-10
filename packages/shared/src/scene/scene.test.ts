import { describe, expect, it } from 'vitest'
import { rectangleSpace } from '../schemas/space.ts'
import type { Space } from '../schemas/space.ts'
import { DEFAULT_VIEW_NAMES, defaultCameras, sceneFrame } from './views.ts'
import { CUTAWAY_WALL_HEIGHT_M, wallSegments } from './walls.ts'

/** 8 × 6 m, 3.2 m high, entrance on the front (bottom) edge from x = 3 to 5. */
function shop(entrance: Space['entrances'] = [{ a: [3, 6], b: [5, 6], kind: 'main' }]): Space {
  return { ...rectangleSpace(8, 6, 3.2), entrances: entrance }
}

describe('sceneFrame', () => {
  it('faces out through the main entrance', () => {
    expect(sceneFrame(shop())).toMatchObject({
      front: [0, 1],
      right: [1, 0],
      center: [4, 3],
      width: 8,
      depth: 6,
      entrance: [4, 6],
    })
    const left = sceneFrame(shop([{ a: [0, 1], b: [0, 3], kind: 'main' }]))
    expect(left.front).toEqual([-1, 0])
    // Walking in eastwards, the visitor's right is south (+z).
    expect(left.right).toEqual([0, 1])
    expect([left.width, left.depth]).toEqual([6, 8])
  })

  it('defaults to the bottom of the plan without an entrance', () => {
    expect(sceneFrame(shop([])).front).toEqual([0, 1])
  })

  it('finds the outside of an entrance on an inner corner of an L shape', () => {
    const l: Space = {
      ...rectangleSpace(8, 6, 3),
      boundary: [
        [0, 0],
        [8, 0],
        [8, 3],
        [4, 3],
        [4, 6],
        [0, 6],
      ],
      // On the inner edge from (8, 3) to (4, 3): the outside is below it.
      entrances: [{ a: [5, 3], b: [7, 3], kind: 'main' }],
    }
    expect(sceneFrame(l).front).toEqual([0, 1])
  })
})

describe('defaultCameras', () => {
  it('reproduces the legacy presets for a rectangle with a front entrance', () => {
    const [w, d, h] = [8, 6, 3.2]
    const span = Math.max(w, d)
    const legacy = [
      [0.5, 1.15, 1.8],
      [-0.7, 1, 1.4],
      [1.7, 1, 1.4],
      [1.7, 1, -0.4],
      [-0.7, 1, -0.4],
      [0.5, 1.3, -0.85],
      [0.5, 2.4, 0.501],
    ].map(([x = 0, y = 0, z = 0]) => [w * x, span * y, d * z])
    const cameras = defaultCameras(shop([{ a: [0, 6], b: [8, 6], kind: 'main' }]))

    expect(cameras.map((c) => c.name)).toEqual([...DEFAULT_VIEW_NAMES])
    cameras.slice(0, 7).forEach((camera, i) => {
      legacy[i]?.forEach((value, axis) => expect(camera.position[axis]).toBeCloseTo(value, 3))
      expect(camera).toMatchObject({ target: [4, h * 0.25, 3], fovDeg: 48, source: 'auto' })
    })
    expect(cameras[7]).toMatchObject({
      position: [4, 1.65, 6.8],
      target: [4, 1.35, 1.5],
      fovDeg: 72,
    })
  })

  it('turns with the entrance: left-front stays on the visitor’s left, outside', () => {
    const cameras = defaultCameras(shop([{ a: [0, 2], b: [0, 4], kind: 'main' }]))
    const leftFront = cameras.find((c) => c.name === '左前方')
    expect(leftFront?.position[0]).toBeLessThan(0)
    expect(leftFront?.position[2]).toBeLessThan(0)
    const entranceView = cameras.find((c) => c.name === '入口方向')
    expect(entranceView?.position).toEqual([-0.8, 1.65, 3])
    expect(entranceView?.target[0]).toBeGreaterThan(0)
  })

  it('caps the entrance view height in low spaces', () => {
    const low = { ...shop(), height: 2 }
    expect(defaultCameras(low)[7]?.position[1]).toBe(1.2)
  })
})

describe('wallSegments', () => {
  it('leaves the entrance open, keeps the back wall full and cuts the rest away', () => {
    const walls = wallSegments(shop(), 'side_hall')
    const summary = walls.map((w) => [w.a, w.b, w.kind])
    expect(summary).toEqual([
      [[0, 0], [8, 0], 'full'],
      [[8, 0], [8, 6], 'cutaway'],
      [[8, 6], [5, 6], 'cutaway'],
      [[3, 6], [0, 6], 'cutaway'],
      [[0, 6], [0, 0], 'cutaway'],
    ])
    expect(walls[0]).toMatchObject({ outward: [0, -1], height: 3.2 })
    expect(walls[1]).toMatchObject({ outward: [1, 0], height: CUTAWAY_WALL_HEIGHT_M })
  })

  it('also opens open edges and drops slivers', () => {
    const space = {
      ...shop(),
      openEdges: [{ a: [8, 0.02] as [number, number], b: [8, 6] as [number, number] }],
    }
    const walls = wallSegments(space, 'zone')
    expect(walls.some((w) => w.a[0] === 8 && w.b[0] === 8)).toBe(false)
  })

  it('has no walls for island shops', () => {
    expect(wallSegments(shop(), 'island')).toEqual([])
  })
})
