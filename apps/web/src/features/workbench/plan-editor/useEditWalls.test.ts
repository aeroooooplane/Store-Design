import { describe, expect, it } from 'vitest'
import { rectangleSpace } from '@store/shared'
import type { Layout, LayoutItem } from '@store/shared'
import { followWalls } from './useEditWalls.ts'

function item(id: string, cx: number, cz: number, overrides: Partial<LayoutItem> = {}) {
  return {
    id,
    assetId: null,
    function: 'accessory_cabinet' as const,
    name: id,
    cx,
    cz,
    rotation: 0 as const,
    w: 2.4,
    d: 0.55,
    h: 2.4,
    placeholder: false,
    locked: false,
    ...overrides,
  }
}

describe('followWalls', () => {
  const before = rectangleSpace(6, 4, 3)
  // The right wall moves 0.6 m in; the back wall (z = 0) stays.
  const after = rectangleSpace(5.4, 4, 3)
  const layout: Layout = {
    schemaVersion: 3,
    planning: null,
    items: [
      item('back', 3, 0.275),
      item('right', 5.725, 2, { rotation: 90, w: 0.55, d: 2.4 }),
      item('island', 3, 2, { function: 'island_table', w: 1.8, d: 0.8, h: 0.9 }),
      item('locked', 5.725, 3.4, { rotation: 90, w: 0.55, d: 1.2, locked: true }),
    ],
  }

  it('moves props on a moved wall with it and leaves the rest', () => {
    const moved = followWalls(layout, before, after).items
    expect(moved.map((i) => [i.id, i.cx, i.cz])).toEqual([
      ['back', 3, 0.275],
      ['right', 5.125, 2],
      ['island', 3, 2],
      ['locked', 5.725, 3.4],
    ])
  })

  it('returns the same items when no wall moved', () => {
    const same = followWalls(layout, before, rectangleSpace(6, 4, 3.2))
    same.items.forEach((i, k) => expect(i).toBe(layout.items[k]))
  })
})
