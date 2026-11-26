import { describe, expect, it } from 'vitest'
import { LayoutSchema, validateLayout } from '../schemas/layout.ts'
import type { Fixture, LayoutItem } from '../schemas/layout.ts'
import { rectangleSpace } from '../schemas/space.ts'
import {
  defaultFixtureHeight,
  fixtureRect,
  fixtureSolids,
  nextFixtureId,
  snapFixtureRect,
  fixtureSnapTargets,
  previewDrawnFixture,
  previewResizedFixture,
} from './index.ts'

// 6 m × 4 m, 3 m high; a 2.4 m accessory cabinet on the back wall (x 1.8–4.2, z 0–0.55).
const space = rectangleSpace(6, 4, 3)

function item(id: string, overrides: Partial<LayoutItem> = {}): LayoutItem {
  return {
    id,
    assetId: null,
    function: 'accessory_cabinet',
    name: id,
    cx: 3,
    cz: 0.275,
    rotation: 0,
    w: 2.4,
    d: 0.55,
    h: 2.4,
    placeholder: false,
    locked: false,
    ...overrides,
  }
}
const cabinet = item('cabinet')
const island = item('island', { function: 'island_table', cz: 2, w: 1.8, d: 0.8, h: 0.9 })

const partition = (overrides: Partial<Fixture> = {}): Fixture => ({
  id: 'partition-1',
  kind: 'hollow_partition',
  cx: 3,
  cz: 0.3,
  w: 3,
  d: 0.6,
  h: 2.4,
  ...overrides,
})

describe('interactive partition snapping', () => {
  const adjacent = partition({ cx: 2.75, cz: 1.5, w: 0.5, d: 1 })
  const targets = fixtureSnapTargets(space, 'side_hall', [], [adjacent], true)

  it('snaps the actual drawn corner without turning the open entrance into a wall', () => {
    const drawingTargets = fixtureSnapTargets(space, 'side_hall', [], [adjacent])
    expect(previewDrawnFixture([0.04, 0.05], [2.55, 0.95], drawingTargets).rect).toEqual({
      minX: 0,
      minZ: 0,
      maxX: 2.5,
      maxZ: 1,
    })
    expect(previewDrawnFixture([3, 3.4], [4, 3.95], drawingTargets).rect.maxZ).toBe(3.95)
  })

  it('adjusts the vertical edge to an adjacent partition, and can pull away again', () => {
    const original = { minX: 3.3, maxX: 3.9, minZ: 0.2, maxZ: 2.4 }
    const snapped = previewResizedFixture(original, 'minX', -0.24, targets)
    expect(snapped.rect).toEqual({ ...original, minX: 3 })
    expect(snapped.guides).toHaveLength(1)
    expect(previewResizedFixture(snapped.rect, 'minX', 0.05, targets).rect.minX).toBe(3.05)
  })

  it('snaps to entrance and open edges while preserving 10 mm steps without magnets', () => {
    const opened: typeof space = { ...space, openEdges: [{ a: [6, 1], b: [6, 2] }] }
    const targets = fixtureSnapTargets(opened, 'side_hall', [], [], true)
    const rect = { minX: 5.2, maxX: 5.8, minZ: 1.2, maxZ: 3.72 }
    expect(previewResizedFixture(rect, 'maxZ', 0.23, targets).rect.maxZ).toBe(4)
    expect(previewResizedFixture({ ...rect, maxZ: 1.8 }, 'maxX', 0.16, targets).guides).toEqual([
      { a: [6, 1], b: [6, 2], edge: 1 },
    ])
    const free = { minX: 2, maxX: 2.4, minZ: 1, maxZ: 1.4 }
    expect(previewResizedFixture(free, 'maxX', 0.009, []).rect.maxX).toBe(2.41)
    expect(previewResizedFixture(free, 'maxZ', 0.003, []).rect.maxZ).toBe(1.4)
  })
})

describe('snapFixtureRect', () => {
  it('sticks drawn edges to the back wall and to the cabinet front', () => {
    const drawn = { minX: 1.25, maxX: 4.75, minZ: 0.06, maxZ: 0.62 }
    expect(snapFixtureRect(drawn, space, [cabinet])).toEqual({
      minX: 1.25,
      maxX: 4.75,
      minZ: 0,
      maxZ: 0.55,
    })
  })

  it('sticks to cabinet sides and leaves other props alone', () => {
    const beside = { minX: 1.75, maxX: 4.27, minZ: 0.1, maxZ: 0.7 }
    expect(snapFixtureRect(beside, space, [cabinet, island])).toEqual({
      minX: 1.8,
      maxX: 4.2,
      minZ: 0,
      maxZ: 0.7,
    })
    // 50 mm from the island table: not a cabinet, so the edge stays where it was drawn.
    const nearIsland = { minX: 2.05, maxX: 3.95, minZ: 2.45, maxZ: 3 }
    expect(snapFixtureRect(nearIsland, space, [cabinet, island])).toEqual(nearIsland)
  })
})

describe('defaultFixtureHeight', () => {
  it('matches the cabinets it closes around, else reaches the ceiling', () => {
    expect(defaultFixtureHeight(fixtureRect(partition()), [cabinet, island], space)).toBe(2.4)
    const away = fixtureRect(partition({ cx: 5.5, cz: 3, w: 0.6, d: 0.6 }))
    expect(defaultFixtureHeight(away, [cabinet], space)).toBe(3)
  })
})

describe('partition checks', () => {
  const layout = (items: LayoutItem[], fixtures: Fixture[]) =>
    LayoutSchema.parse({ schemaVersion: 3, items, fixtures })
  const found = (items: LayoutItem[], fixtures: Fixture[]) =>
    validateLayout(space, layout(items, fixtures)).map((i) => [i.code, i.severity])

  it('lets accessory cabinets sit inside, warns about other props and the boundary', () => {
    expect(found([cabinet], [partition()])).toEqual([])
    expect(found([island], [partition({ cz: 2 })])).toEqual([['fixture_overlaps_item', 'warning']])
    expect(found([], [partition({ cx: 5.5 })])).toEqual([['fixture_outside_boundary', 'warning']])
  })

  it('keeps old layouts without partitions as they were', () => {
    expect(LayoutSchema.parse({ schemaVersion: 3, items: [] }).fixtures).toBeUndefined()
  })
})

describe('nextFixtureId', () => {
  it('skips ids already taken', () => {
    expect(nextFixtureId({ fixtures: [partition({ id: 'partition-2' })] })).toBe('partition-3')
    expect(nextFixtureId({})).toBe('partition-1')
  })
})

describe('fixtureSolids', () => {
  it('leaves a niche for the cabinet and closes the box around and above it', () => {
    // 3.5 m × 0.55 m around the 2.4 m cabinet, 3 m high (the cabinet is 2.4 m).
    const solids = fixtureSolids(partition({ w: 3.5, d: 0.55, cz: 0.275, h: 3 }), [cabinet])
    expect(solids.map((s) => [s.rect.minX, s.rect.maxX, s.bottom, s.top])).toEqual([
      [1.25, 1.8, 0, 3],
      [1.8, 4.2, 2.4, 3],
      [4.2, 4.75, 0, 3],
    ])
  })

  it('is one block without cabinets, and nothing over a cabinet as tall as the box', () => {
    expect(fixtureSolids(partition(), [island])).toHaveLength(1)
    const flush = fixtureSolids(partition({ w: 2.4, d: 0.55, cz: 0.275 }), [cabinet])
    expect(flush).toEqual([])
  })
})
