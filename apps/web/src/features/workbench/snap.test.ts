import { describe, expect, it } from 'vitest'
import { SpaceSchema, rectangleSpace } from '@store/shared'
import { magnetSnap } from './snap.ts'

const room = rectangleSpace(6, 4, 3)
const partition = {
  id: 'partition-1',
  kind: 'hollow_partition' as const,
  cx: 3,
  cz: 2,
  w: 2,
  d: 0.2,
  h: 2.4,
}

describe('空心隔板外表面吸附', () => {
  const prop = { id: 'a', w: 0.5, d: 0.4 }
  it.each([
    [3, 1.64, 3, 1.7],
    [3, 2.36, 3, 2.3],
    [1.69, 2, 1.75, 2],
    [4.31, 2, 4.25, 2],
  ])('从 %s,%s 接近时贴到隔板外侧', (cx, cz, x, z) => {
    expect(magnetSnap(prop, cx, cz, [], room, [partition])).toMatchObject({ cx: x, cz: z })
  })
  it('不向隔板内部吸附，也不吸附到远处边线的延长线上', () => {
    expect(magnetSnap(prop, 3, 2, [], room, [partition])).toMatchObject({
      snappedX: false,
      snappedZ: false,
    })
    expect(magnetSnap(prop, 4.8, 1.64, [], room, [partition])).toMatchObject({
      snappedX: false,
      snappedZ: false,
    })
  })
})

describe('magnetSnap at any angle', () => {
  it('still sticks an upright prop to the wall and its neighbours', () => {
    const prop = { id: 'a', w: 1, d: 0.5 }
    expect(magnetSnap(prop, 2, 0.3, [], room)).toEqual({
      cx: 2,
      cz: 0.25,
      snappedX: false,
      snappedZ: true,
    })
  })

  it('ignores tilted neighbours, which have no straight edges to line up with', () => {
    const prop = { id: 'a', w: 1, d: 0.5 }
    const tilted = { id: 'b', cx: 3.6, cz: 2, w: 1, d: 0.5, rotation: 20 }
    expect(magnetSnap(prop, 2.55, 2, [tilted], room).snappedX).toBe(false)
    expect(magnetSnap(prop, 2.55, 2, [{ ...tilted, rotation: 0 }], room).snappedX).toBe(true)
  })

  it('puts a tilted prop flush onto a slanted wall it lies parallel to', () => {
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
    const rotation = Math.round(((Math.atan2(2, -6) * 180) / Math.PI) * 10) / 10
    const board = { id: 'a', w: 1.8, d: 0.5, rotation }
    const snapped = magnetSnap(board, 3, 4.65, [], slanted)
    expect(snapped.snappedX && snapped.snappedZ).toBe(true)
    expect([snapped.cx, snapped.cz]).not.toEqual([3, 4.65])
    // Not parallel to any wall: stays where it was dropped.
    expect(magnetSnap({ ...board, rotation: 30 }, 3, 3, [], slanted)).toEqual({
      cx: 3,
      cz: 3,
      snappedX: false,
      snappedZ: false,
    })
  })
})
