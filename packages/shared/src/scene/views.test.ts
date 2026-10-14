import { describe, expect, it } from 'vitest'
import { locatePoint } from '../geometry/index.ts'
import type { Point } from '../geometry/index.ts'
import { rectangleSpace } from '../schemas/space.ts'
import type { Space } from '../schemas/space.ts'
import { defaultCameras, sceneFrame, sightBlocked } from './views.ts'
import { wallSegments } from './walls.ts'

const plan = (camera: { position: readonly number[] } | { target: readonly number[] }) => {
  const v = 'position' in camera ? camera.position : camera.target
  return [v[0], v[2]] as Point
}

/** The views as computed before targets moved inside the shop (bounding-box centre). */
type Vec3 = [number, number, number]

function legacyCameras(space: Space): { position: Vec3; target: Vec3 }[] {
  const f = sceneFrame(space)
  const span = Math.max(f.width, f.depth)
  const at = (across: number, along: number): Point => {
    const a = (across - 0.5) * f.width
    const b = (along - 0.5) * f.depth
    return [
      f.center[0] + f.right[0] * a + f.front[0] * b,
      f.center[1] + f.right[1] * a + f.front[1] * b,
    ]
  }
  const presets = [
    [0.5, 1.15, 1.8],
    [-0.7, 1, 1.4],
    [1.7, 1, 1.4],
    [1.7, 1, -0.4],
    [-0.7, 1, -0.4],
    [0.5, 1.3, -0.85],
    [0.5, 2.4, 0.501],
  ] as const
  const target: Vec3 = [f.center[0], space.height * 0.25, f.center[1]]
  const orbit = presets.map(([across, height, along]) => {
    const [x, z] = at(across, along)
    return { position: [x, span * height, z] as Vec3, target }
  })
  const outside: Point = [f.entrance[0] + f.front[0] * 0.8, f.entrance[1] + f.front[1] * 0.8]
  const inside: Point = [
    f.entrance[0] - f.front[0] * f.depth * 0.75,
    f.entrance[1] - f.front[1] * f.depth * 0.75,
  ]
  return [
    ...orbit,
    {
      position: [outside[0], Math.min(1.65, space.height * 0.6), outside[1]],
      target: [inside[0], Math.min(1.35, space.height * 0.45), inside[1]],
    },
  ]
}

const expectClose = (actual: readonly number[], expected: readonly number[]) =>
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 3))

describe('defaultCameras on rectangles', () => {
  const cases: [string, Space][] = [
    [
      '8 × 6, front entrance',
      { ...rectangleSpace(8, 6, 3.2), entrances: [{ a: [3, 6], b: [5, 6], kind: 'main' }] },
    ],
    [
      '12 × 5, left entrance',
      { ...rectangleSpace(12, 5, 3), entrances: [{ a: [0, 1], b: [0, 4], kind: 'main' }] },
    ],
    [
      '4 × 10, back entrance',
      { ...rectangleSpace(4, 10, 3.5), entrances: [{ a: [1, 0], b: [3, 0], kind: 'main' }] },
    ],
    ['6 × 6, no entrance', { ...rectangleSpace(6, 6, 2.8), entrances: [] }],
  ]
  it.each(cases)('%s: same views as before', (_name, space) => {
    const cameras = defaultCameras(space, 'side_hall')
    const legacy = legacyCameras(space)
    cameras.forEach((camera, i) => {
      expectClose(camera.position, legacy[i]?.position ?? [])
      expectClose(camera.target, legacy[i]?.target ?? [])
    })
  })
})

describe('defaultCameras on irregular shops', () => {
  // U shape open at the bottom: the bounding-box centre (4.5, 3) is in the slot, outside.
  const u: Space = {
    ...rectangleSpace(9, 6, 3),
    boundary: [
      [0, 0],
      [9, 0],
      [9, 6],
      [6, 6],
      [6, 2],
      [3, 2],
      [3, 6],
      [0, 6],
    ],
    entrances: [{ a: [0, 6], b: [3, 6], kind: 'main' }],
  }

  it('looks at a point inside a U shape', () => {
    const cameras = defaultCameras(u, 'side_hall')
    for (const camera of cameras.slice(0, 7)) {
      expect(locatePoint(plan({ target: camera.target }), u.boundary)).toBe('inside')
    }
    expect(locatePoint(plan({ target: legacyCameras(u)[0]?.target ?? [] }), u.boundary)).toBe(
      'outside',
    )
  })

  it('ends the entrance view inside the shop when the entrance is in a notch', () => {
    const notch: Space = { ...u, entrances: [{ a: [6, 2], b: [3, 2], kind: 'main' }] }
    // Straight on it would end 2.5 m behind the back wall.
    expect(legacyCameras(notch)[7]?.target[2]).toBeLessThan(0)
    const view = defaultCameras(notch, 'side_hall')[7]
    expect(view?.name).toBe('入口方向')
    expect(locatePoint(plan({ target: view?.target ?? [] }), notch.boundary)).toBe('inside')
    expect(view?.target[0]).toBe(4.5)
  })

  // L shape: the top-right block is cut away, so a full-height back wall runs across the
  // middle of the plan (z = 6, x 4–10).
  const l: Space = {
    ...rectangleSpace(10, 10, 3),
    boundary: [
      [0, 0],
      [4, 0],
      [4, 6],
      [10, 6],
      [10, 10],
      [0, 10],
    ],
    entrances: [{ a: [8, 10], b: [4, 10], kind: 'main' }],
  }

  it('moves orbit views of an L shape that a full-height wall would block', () => {
    const walls = wallSegments(l, 'side_hall')
    const cameras = defaultCameras(l, 'side_hall')
    const target = cameras[0]?.target ?? [0, 0, 0]
    for (const camera of cameras.slice(0, 7)) {
      expect(sightBlocked(camera.position, camera.target, walls)).toBe(false)
    }
    // Before, the right-rear view looked through the wall at z = 6.
    const before = legacyCameras(l)[3]?.position ?? []
    expect(sightBlocked([before[0] ?? 0, before[1] ?? 0, before[2] ?? 0], target, walls)).toBe(true)
    const rightRear = cameras.find((c) => c.name === '右后方')
    expect(rightRear?.position).not.toEqual(before)
    // Moved along its circle: same height and the same distance from the target.
    expect(rightRear?.position[1]).toBe(before[1])
    const radius = (p: readonly number[]) =>
      Math.hypot((p[0] ?? 0) - target[0], (p[2] ?? 0) - target[2])
    expect(radius(rightRear?.position ?? [])).toBeCloseTo(radius(before), 2)
  })

  it('leaves island views where they are (no walls)', () => {
    const island = defaultCameras(l, 'island')
    const before = legacyCameras(l)[3]?.position ?? []
    expectClose(island[3]?.position ?? [], before)
  })
})
