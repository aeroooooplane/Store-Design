import { describe, expect, it } from 'vitest'
import {
  facadeGeometry,
  facadeRun,
  facadeSpan,
  reviewFacade,
  suggestedFacadeEdge,
} from './index.ts'
import { normalizeSpace, rectangleSpace, SpaceSchema, validateSpace } from '../schemas/space.ts'
import type { Facade } from '../schemas/facade.ts'
import type { Space } from '../schemas/space.ts'

const room = rectangleSpace(8, 6, 3.2)
const facade: Facade = {
  a: [0, 6],
  b: [8, 6],
  openingWidth: 8,
  clearHeight: 2.6,
  fasciaHeight: 0.6,
  screenInset: 0.05,
}

describe('straight side-hall facade', () => {
  it('attaches to the main edge and keeps a real off-centre entrance in front elevation', () => {
    const partial: Space = { ...room, entrances: [{ a: [2, 6], b: [5, 6], kind: 'main' as const }] }
    const edge = suggestedFacadeEdge(partial)
    expect(edge).toBe(2)
    expect(facadeSpan(partial.boundary, edge, 0, 8)).toEqual({ a: [8, 6], b: [0, 6] })
    const forPlan = { ...facade, openingWidth: 3 }
    const frame = facadeGeometry(partial, forPlan)!
    expect(frame.origin).toEqual([0, 6])
    expect(frame.direction[0]).toBe(1)
    expect(frame.outward[1]).toBe(1)
    expect(frame.openingStart).toBe(2)
    expect(frame.openingEnd).toBe(5)
    expect(facadeRun(partial.boundary, { a: [0, 6], b: [8, 0] })).toBeNull()
  })

  it('selects the SI2.0 grade preset and checks actual LED width across all bands', () => {
    const narrow = rectangleSpace(3.5, 2.5, 3.2)
    const led: Facade = {
      ...facade,
      a: [0, 2.5],
      b: [3.5, 2.5],
      openingWidth: 3.5,
      fasciaHeight: 0.55,
      si2: { grade: 'S' as const },
      screenWidth: 3.5,
    }
    const review = reviewFacade(narrow, led, 'SI2.0', 'domestic')!
    expect(review).toMatchObject({ preset: 'led_strip', minScreenWidth: 3520, logoHeight: 0.3 })
    expect(review.issues).toContainEqual(
      expect.objectContaining({
        code: 'screen-minimum',
        message: expect.stringContaining('差 20 mm'),
      }),
    )
    expect(
      reviewFacade(narrow, { ...led, fasciaHeight: 0.6 }, 'SI2.0', 'domestic')?.minScreenWidth,
    ).toBe(4800)
    expect(
      reviewFacade(narrow, { ...led, fasciaHeight: 0.8 }, 'SI2.0', 'domestic')?.minScreenWidth,
    ).toBe(5440)
  })

  it('keeps ambiguous thresholds visible and checks the real logo fit', () => {
    const led = { ...facade, si1: { preset: 'led' as const } }
    expect(reviewFacade(room, led, 'SI1.0', 'domestic')?.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['si1-selection', 'si1-copy-edge']),
    )
    const short = reviewFacade(room, { ...facade, fasciaHeight: 0.45 }, 'SI2.0', 'domestic')!
    expect(short.issues).toContainEqual(
      expect.objectContaining({
        code: 'logo-top-bottom',
        message: expect.stringContaining('75 mm'),
      }),
    )
    expect(
      reviewFacade(room, { ...facade, fasciaHeight: 0.35 }, 'SI2.0', 'domestic')?.issues,
    ).toContainEqual(expect.objectContaining({ code: 'si2-low' }))
    expect(short.logoWidth).toBeGreaterThan(
      reviewFacade(room, { ...facade, fasciaHeight: 0.45 }, 'SI2.0', 'overseas')!.logoWidth,
    )
  })

  it('round-trips optional fields and leaves an outdated anchor editable', () => {
    expect(SpaceSchema.parse(room).facade).toBeUndefined()
    const saved = normalizeSpace(
      SpaceSchema.parse({
        ...room,
        facade: { ...facade, screenInset: 0.0504, si2: { grade: 'A' } },
      }),
    )
    expect(saved.facade).toMatchObject({ screenInset: 0.05, si2: { grade: 'A' } })
    const moved = { ...rectangleSpace(8, 7, 3.2), facade: saved.facade }
    expect(validateSpace(moved)).toContainEqual(
      expect.objectContaining({ code: 'facade_not_on_boundary', severity: 'warning' }),
    )
  })
})
