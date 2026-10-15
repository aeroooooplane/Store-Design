import { describe, expect, it } from 'vitest'
import { obbCorners, placedBox } from '../geometry/obb.ts'
import { locatePoint } from '../geometry/polygon.ts'
import { SpaceSchema, rectangleSpace } from '../schemas/space.ts'
import {
  angleBetween,
  rotationHandle,
  rotationTowards,
  snapRotation,
  turnItem,
  wallFlushSnap,
  wallLines,
} from './index.ts'

const room = rectangleSpace(6, 4, 3)
// A shop whose back right wall runs at a slant: from (6, 4) up to (0, 6).
const slanted = SpaceSchema.parse({
  schemaVersion: 1,
  boundary: [
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 6],
  ],
  height: 3,
  entrances: [{ a: [2, 0], b: [4, 0], kind: 'main' }],
  obstacles: [],
})
const SLANT = (Math.atan2(2, -6) * 180) / Math.PI // 161.57°

describe('walls to turn against', () => {
  it('lists the walls without entrances, each with its direction and inward side', () => {
    const lines = wallLines(slanted)
    // The front edge is split around the entrance; three more edges.
    expect(lines).toHaveLength(5)
    for (const line of lines) {
      const mid: [number, number] = [(line.a[0] + line.b[0]) / 2, (line.a[1] + line.b[1]) / 2]
      const probe: [number, number] = [mid[0] + line.inward[0] * 0.1, mid[1] + line.inward[1] * 0.1]
      expect(locatePoint(probe, slanted.boundary)).toBe('inside')
    }
    const slant = lines.find((l) => l.a[0] === 6 && l.a[1] === 4)
    expect(slant?.angle).toBeCloseTo(161.6, 1)
  })
})

describe('snapping the angle while turning', () => {
  const prop = { cx: 3, cz: 2, w: 1, d: 1 }

  it('settles parallel or square to a nearby wall, else on 15° steps, else where it is', () => {
    expect(snapRotation(3, prop, room)).toMatchObject({ rotation: 0, kind: 'wall' })
    expect(snapRotation(94, prop, room)).toMatchObject({ rotation: 90, kind: 'wall' })
    expect(snapRotation(46, prop, room)).toEqual({ rotation: 45, wall: null, kind: 'step' })
    expect(snapRotation(52, prop, room)).toEqual({ rotation: 52, wall: null, kind: 'free' })
    // Alt held: no snapping at all.
    expect(snapRotation(3, prop, room, true)).toEqual({ rotation: 3, wall: null, kind: 'free' })
  })

  it('lines a prop up with a slanted wall nearby, along or square to it', () => {
    const nearSlant = { cx: 3, cz: 4.3, w: 1.8, d: 0.5 }
    const along = snapRotation(158, nearSlant, slanted)
    expect(along.kind).toBe('wall')
    expect(along.rotation).toBeCloseTo(SLANT, 1)
    expect(snapRotation(70, nearSlant, slanted).rotation).toBeCloseTo(SLANT - 90, 1)
    // Far from the slant (and 15° steps more than 2.5° away) it stays where it is.
    expect(snapRotation(158, { ...nearSlant, cz: 0.6 }, slanted).kind).not.toBe('wall')
  })

  it('measures angles the short way round', () => {
    expect(angleBetween(359, 1)).toBe(2)
    expect(angleBetween(90, 270)).toBe(180)
  })
})

describe('turning a prop', () => {
  it('swaps width and depth only when the nearest quarter turn changes by a quarter', () => {
    const table = { rotation: 0, w: 1, d: 1.8, scale: 1.5 }
    expect(turnItem(table, 30)).toEqual({ ...table, rotation: 30 })
    expect(turnItem(table, 100)).toEqual({ rotation: 100, w: 1.8, d: 1, scale: 1.5 })
    expect(turnItem(turnItem(table, 100), 170)).toEqual({ rotation: 170, w: 1, d: 1.8, scale: 1.5 })
    expect(turnItem(table, -10).rotation).toBe(350)
  })

  it('places the handle behind the prop and reads the angle back from it', () => {
    for (const rotation of [0, 37.5, 90, 200, 315]) {
      const item = { cx: 2, cz: 1, w: 1, d: 1.8, rotation }
      const handle = rotationHandle(item, 0.3)
      expect(Math.hypot(handle[0] - 2, handle[1] - 1)).toBeCloseTo(1.2, 6)
      expect(rotationTowards([2, 1], handle)).toBeCloseTo(rotation, 6)
    }
    // At 0° the handle is straight behind (towards −Z).
    const [x, z] = rotationHandle({ cx: 0, cz: 0, w: 1, d: 1, rotation: 0 }, 0.5)
    expect([x + 0, +z.toFixed(6)]).toEqual([0, -1])
  })
})

describe('dragging a tilted prop onto a slanted wall', () => {
  const rotation = Math.round(SLANT * 10) / 10
  const board = { w: 1.8, d: 0.5, rotation }
  const across = (cx: number, cz: number) => {
    const line = wallLines(slanted).find((l) => l.a[0] === 6 && l.a[1] === 4)
    if (!line) throw new Error('no slant')
    return Math.min(
      ...obbCorners(placedBox({ ...board, cx, cz })).map(
        (p) => (p[0] - line.a[0]) * line.inward[0] + (p[1] - line.a[1]) * line.inward[1],
      ),
    )
  }

  it('moves the nearest side flush onto a parallel wall within reach', () => {
    // Start 6 cm off the slant, measured square to it.
    const start: [number, number] = [3, 4.65]
    const gap = across(...start)
    expect(gap).toBeGreaterThan(0)
    expect(gap).toBeLessThan(0.1)
    const snapped = wallFlushSnap(board, ...start, slanted)
    expect(snapped).not.toBeNull()
    if (snapped) expect(Math.abs(across(snapped.cx, snapped.cz))).toBeLessThan(0.002)
  })

  it('leaves it alone when not parallel or too far', () => {
    expect(wallFlushSnap({ ...board, rotation: rotation + 10 }, 3, 4.65, slanted)).toBeNull()
    expect(wallFlushSnap(board, 3, 4.2, slanted)).toBeNull()
  })
})
