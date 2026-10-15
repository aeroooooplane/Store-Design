import { describe, expect, it } from 'vitest'
import { SpaceSchema, rectangleSpace } from '@store/shared'
import { magnetSnap } from './snap.ts'

const room = rectangleSpace(6, 4, 3)

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
