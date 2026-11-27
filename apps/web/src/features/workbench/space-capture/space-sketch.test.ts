import { describe, expect, it } from 'vitest'
import { SpaceSchema, normalizeSpace, rectangleSpace, validateSpace } from '@store/shared'
import { sketchToSpace, spaceToSketch } from './space-sketch.ts'

describe('space capture adapter', () => {
  it('round-trips an existing plan with old openings, calibration and fixed features', () => {
    const legacy = SpaceSchema.parse({
      ...rectangleSpace(8, 6, 3.234),
      boundary: [
        [0.0003, 0],
        [8, 0],
        [8, 6],
        [0, 6],
      ],
      entrances: [
        { a: [1, 0], b: [3, 0], kind: 'main' },
        { a: [5, 0], b: [7, 0], kind: 'side' },
      ],
      openEdges: [{ a: [8, 4], b: [4, 6] }],
      calibration: { method: 'manual', reference: '实测图', verified: true },
      obstacles: [
        {
          kind: 'column',
          label: '原方柱',
          polygon: [
            [2, 2],
            [3, 2],
            [3, 3],
            [2, 3],
          ],
          height: null,
        },
        {
          kind: 'shaft',
          label: '原井道',
          polygon: [
            [7, 5],
            [8, 5],
            [8, 6],
          ],
          height: null,
        },
      ],
    })
    const { sketch, fixedObstacles } = spaceToSketch('side_hall', legacy)
    expect(sketch.points).toHaveLength(5)
    expect(sketch.columns).toHaveLength(1)
    expect(fixedObstacles).toHaveLength(1)
    expect(sketchToSpace(sketch, legacy)).toMatchObject({ success: true, data: legacy })
    sketch.height = 3500
    sketch.columns[0]!.x = -500
    const saved = sketchToSpace(sketch, legacy)
    if (!saved.success) throw saved.error
    expect(saved.data).toMatchObject({
      boundary: legacy.boundary,
      height: 3.5,
      entrances: legacy.entrances,
      openEdges: legacy.openEdges,
      obstacles: [{ label: '原方柱' }, legacy.obstacles[1]],
    })
    expect(validateSpace(saved.data)).toContainEqual(
      expect.objectContaining({
        code: 'obstacle_outside_boundary',
        severity: 'warning',
      }),
    )
  })

  it('修改铺位形态保留旧空间的局部入口和开放边，重开使用空间自己的形态', () => {
    const initial = SpaceSchema.parse({
      ...rectangleSpace(8, 6, 3.2),
      entrances: [{ a: [1, 0], b: [3, 0], kind: 'main' }],
      openEdges: [{ a: [8, 1], b: [8, 3] }],
    })
    const { sketch } = spaceToSketch('side_hall', initial)
    sketch.shop = 'zone'
    const saved = sketchToSpace(sketch, initial)
    if (!saved.success) throw saved.error
    expect(saved.data).toEqual({ ...initial, shopType: 'zone' })
    expect(spaceToSketch('island', saved.data).sketch.shop).toBe('zone')
    expect(normalizeSpace(saved.data).shopType).toBe('zone')
  })

  it.each([30, 90, 315])('reopens a rectangular column saved at %s degrees', (rotation) => {
    const initial = rectangleSpace(8, 6, 3.2)
    const { sketch } = spaceToSketch('side_hall', initial)
    sketch.columns.push({ kind: 'square', x: 3000, y: 2500, width: 900, depth: 450, rotation })
    const saved = sketchToSpace(sketch, initial)
    if (!saved.success) throw saved.error
    const normalized = normalizeSpace(saved.data)
    const [a, b] = normalized.obstacles[0]!.polygon
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    const projectedAngle = (Math.atan2(b![1] - a![1], b![0] - a![0]) * 180) / Math.PI
    expect((projectedAngle + 360) % 360).toBeCloseTo(rotation, 1)
    const { sketch: reopened, fixedObstacles } = spaceToSketch('side_hall', normalized)
    expect(fixedObstacles).toEqual([])
    const column = reopened.columns[0]!
    expect(column).toMatchObject({ kind: 'square', x: 3000, y: 2500 })
    expect(Math.abs(column.width - 900)).toBeLessThan(1)
    expect(Math.abs(column.depth - 450)).toBeLessThan(1)
    expect(column.rotation).toBeCloseTo(rotation, 1)
    expect(sketchToSpace(reopened, normalized)).toMatchObject({ success: true, data: normalized })
  })

  it('retains an irregular column as a fixed obstacle', () => {
    const base = rectangleSpace(8, 6, 3.2)
    const space = SpaceSchema.parse({
      ...base,
      obstacles: [
        {
          kind: 'column',
          label: '不规则柱',
          height: null,
          polygon: [
            [2, 2],
            [3, 2],
            [3.2, 3],
            [2, 3],
          ],
        },
      ],
    })
    const { sketch, fixedObstacles } = spaceToSketch('side_hall', space)
    expect(sketch.columns).toHaveLength(0)
    expect(fixedObstacles).toEqual([{ source: 0, obstacle: space.obstacles[0] }])
  })

  it('saves edited partial ends and closes only the edges marked shut', () => {
    const legacy = rectangleSpace(8, 6, 3.2)
    const { sketch } = spaceToSketch('side_hall', legacy)
    sketch.openings[sketch.mainEdge] = { mode: 'partial', start: 800, width: 2200 }
    sketch.columns.push({ kind: 'circle', x: 700, y: 700, width: 300, depth: 300 })
    const saved = sketchToSpace(sketch, legacy)
    if (!saved.success) throw saved.error
    expect(saved.data.entrances).toEqual([{ a: [7.2, 6], b: [5, 6], kind: 'main' }])
    expect(saved.data.obstacles[0]?.polygon).toHaveLength(32)
    expect(spaceToSketch('side_hall', saved.data).sketch.columns[0]?.kind).toBe('circle')
  })
})
