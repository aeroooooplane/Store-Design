import { describe, expect, it } from 'vitest'
import { LayoutSchema, validateLayout } from '../schemas/layout.ts'
import type { LayoutItem } from '../schemas/layout.ts'
import { rectangleSpace } from '../schemas/space.ts'
import { defaultEmbeddedElevation, embeddedSnap, embeddedWall } from './embedded.ts'
import { itemsCollide } from './index.ts'

// 6 m × 4 m, 3 m high: back wall at z = 0, left wall at x = 0.
const space = rectangleSpace(6, 4, 3)

/** A 75 寸 screen (1690 × 50 × 958) built into the back wall: its front on z = 0. */
const screen = (overrides: Partial<LayoutItem> = {}): LayoutItem => ({
  id: 'screen',
  assetId: null,
  function: 'screen',
  name: '75寸广告机',
  cx: 3,
  cz: -0.025,
  rotation: 0,
  w: 1.69,
  d: 0.05,
  h: 0.958,
  placeholder: true,
  locked: false,
  mount: 'embedded',
  elevation: 1.021,
  ...overrides,
})
const cabinet: LayoutItem = {
  id: 'cabinet',
  assetId: null,
  function: 'accessory_cabinet',
  name: '配件柜',
  cx: 3,
  cz: 0.275,
  rotation: 0,
  w: 2.4,
  d: 0.55,
  h: 2.4,
  placeholder: false,
  locked: false,
}

describe('embeddedSnap', () => {
  it('sinks the piece into the wall with its front flush and facing the shop', () => {
    expect(embeddedSnap(screen(), 3, 0.2, space, '+Z')).toEqual({
      cx: 3,
      cz: -0.025,
      rotation: 0,
      w: 1.69,
      d: 0.05,
    })
    expect(embeddedSnap(screen(), 0.2, 2, space, '+Z')).toEqual({
      cx: -0.025,
      cz: 2,
      rotation: 270,
      w: 0.05,
      d: 1.69,
    })
    expect(embeddedSnap(screen(), 3, 1.5, space, '+Z')).toBeNull()
  })
})

describe('embeddedWall', () => {
  it('is the wall whose face the front is on', () => {
    expect(embeddedWall(screen(), space)?.along).toBe('x')
    // Hanging on the wall (back on it) is not built in.
    expect(embeddedWall(screen({ cz: 0.025 }), space)).toBeNull()
  })
})

describe('defaultEmbeddedElevation', () => {
  it('centres a screen at 1.5 m; a tall light box starts near the floor', () => {
    expect(defaultEmbeddedElevation(screen(), space)).toBe(1.021)
    expect(defaultEmbeddedElevation({ h: 2.3 }, space)).toBe(0.1)
  })
})

describe('built-in pieces in the checks', () => {
  const codes = (items: LayoutItem[]) =>
    validateLayout(space, LayoutSchema.parse({ schemaVersion: 3, items })).map((i) => i.code)

  it('takes no floor space: not outside the boundary, not clashing with the cabinet in front', () => {
    expect(codes([screen(), cabinet])).toEqual([])
    expect(itemsCollide(screen(), cabinet)).toBe(false)
  })

  it('warns when the front is not on a wall, and clashes only with built-in pieces', () => {
    expect(codes([screen({ cz: 1 })])).toEqual(['item_not_in_wall'])
    expect(itemsCollide(screen(), screen({ id: 'b', cx: 3.5 }))).toBe(true)
    expect(itemsCollide(screen(), screen({ id: 'b', cx: 3.5, elevation: 2 }))).toBe(false)
  })
})
