import { describe, expect, it } from 'vitest'
import { SpaceSchema, rectangleSpace, validateSpace } from '@store/shared'
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
