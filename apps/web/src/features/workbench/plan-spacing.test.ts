import { describe, expect, it } from 'vitest'
import { SpaceSchema, rectangleSpace } from '@store/shared'
import type { LayoutItem } from '@store/shared'
import { placeSpacingLabels, spacingItems, spacingMarks } from './plan-spacing.ts'

function item(id: string, cx: number, cz: number, w: number, d: number): LayoutItem {
  return {
    id,
    assetId: 'asset-1',
    function: 'accessory_cabinet',
    name: id,
    cx,
    cz,
    rotation: 0,
    w,
    d,
    h: 1,
    placeholder: false,
    locked: false,
  }
}

const labels = (marks: { label: string }[]) => marks.map((m) => m.label).sort()

// 6 m × 4 m; the main entrance takes the whole bottom edge (z = 4).
const space = rectangleSpace(6, 4, 3)
const cabinet = item('cabinet', 3, 0.275, 2.4, 0.55)
const island = item('island', 3, 2, 0.8, 1.8)

describe('spacingMarks', () => {
  it('marks each gap to the nearest prop or wall once, not towards the entrance', () => {
    const marks = spacingMarks(space, [cabinet, island])
    // cabinet ↔ island 550 (once), island ↔ side walls 2600, cabinet ↔ side walls 1800.
    expect(labels(marks)).toEqual(['1800', '1800', '2600', '2600', '550'])
    const between = marks.find((m) => m.label === '550')
    expect(between).toMatchObject({ a: [3, 0.55], b: [3, 1.1], angle: -90 })
  })

  it('leaves out gaps under 100 mm and over the limit', () => {
    const near = item('near', 1.6, 0.275, 0.3, 0.55) // 50 mm left of the cabinet
    expect(labels(spacingMarks(space, [cabinet, near]))).toEqual(['1450', '1800'])
    expect(labels(spacingMarks(space, [cabinet, island], { max: 2 }))).toEqual([
      '1800',
      '1800',
      '550',
    ])
  })

  it('measures to the nearest point of a slanted wall and to columns', () => {
    const slanted = SpaceSchema.parse({
      schemaVersion: 1,
      boundary: [
        [0, 0],
        [5, 0],
        [6, 4],
        [0, 4],
      ],
      height: 3,
      obstacles: [
        {
          kind: 'column',
          polygon: [
            [0.5, 1.5],
            [0.9, 1.5],
            [0.9, 1.9],
            [0.5, 1.9],
          ],
        },
      ],
    })
    // A cabinet 0.55 deep spanning z 1–2.2: the slanted wall is nearest at its top end.
    const box = item('box', 3, 1.6, 1, 1.2)
    const marks = spacingMarks(slanted, [box])
    const right = marks.find((m) => m.a[0] === 3.5)
    expect(right?.label).toBe('1750') // the wall is at x = 5.25 at z = 1
    const left = marks.find((m) => m.a[0] === 2.5)
    expect(left?.label).toBe('1600') // the column's right face is at x = 0.9
  })

  it('only counts 软装 standing on the floor', () => {
    const assets = new Map([
      ['asset-1', { materialCategory: '软装物料' }],
      ['asset-2', { materialCategory: '信息化物料' }],
    ])
    const screen = { ...item('screen', 3, 1, 1, 0.1), assetId: 'asset-2' }
    const logo = { ...item('logo', 3, 0.025, 2, 0.05), mount: 'wall' as const }
    expect(spacingItems([cabinet, screen, logo], assets).map((i) => i.id)).toEqual(['cabinet'])
  })
})

describe('placeSpacingLabels', () => {
  it('flips a number that would cover another, and drops one that fits nowhere', () => {
    const marks = spacingMarks(space, [cabinet, island])
    const placed = placeSpacingLabels(marks, 0.1)
    expect(placed).toHaveLength(marks.length)
    const blockedEverywhere = placeSpacingLabels(marks, 0.1, [
      { center: [3, 0.825], axis: [1, 0], halfW: 1, halfH: 1 },
    ])
    expect(blockedEverywhere.map((m) => m.label)).not.toContain('550')
  })
})
