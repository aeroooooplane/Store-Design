import { describe, expect, it } from 'vitest'
import {
  exteriorFacadeSpan,
  facadeEdgeSize,
  facadeGeometry,
  facadeRun,
  facadeSpan,
  facadeWallSpace,
  reviewFacade,
  suggestedFacadeEdge,
} from './index.ts'
import { normalizeSpace, rectangleSpace, SpaceSchema, validateSpace } from '../schemas/space.ts'
import type { Facade } from '../schemas/facade.ts'
import type { Space } from '../schemas/space.ts'
import { wallSegments } from '../scene/walls.ts'

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

  it('places the default on the explicit opening, with its measured jambs outside the lease line', () => {
    const partial: Space = {
      ...room,
      openEdges: [{ a: [8, 1], b: [8, 3.5] }],
    }
    const edge = suggestedFacadeEdge(partial)
    expect(edge).toBe(1)
    expect(facadeEdgeSize(partial, edge)).toEqual({
      length: 6,
      openingWidth: 2.5,
      hasOpening: true,
    })
    const saved: Space = {
      ...partial,
      facade: { ...facade, a: [8, 0], b: [8, 6], openingWidth: 2.5 },
    }
    const frame = facadeGeometry(saved, saved.facade!)!
    expect([frame.openingStart, frame.openingEnd]).toEqual([2.5, 5])
    expect(exteriorFacadeSpan(saved, saved.facade!)).toEqual({ a: [8.215, 0], b: [8.215, 6] })

    const onRight = (wall: ReturnType<typeof wallSegments>[number]) =>
      wall.a[0] === 8 && wall.b[0] === 8
    expect(wallSegments(saved, 'side_hall').filter(onRight)).toHaveLength(2)
    const facadeWalls = facadeWallSpace(saved, 'side_hall')
    expect(wallSegments(facadeWalls, 'side_hall').filter(onRight)).toHaveLength(0)
    expect(saved.openEdges).toEqual(partial.openEdges)
    expect(wallSegments(facadeWalls, 'side_hall').filter((wall) => !onRight(wall))).toEqual(
      wallSegments(saved, 'side_hall').filter((wall) => !onRight(wall)),
    )
  })

  it('joins contiguous open segments into a full-width facade without jambs', () => {
    const full: Space = {
      ...room,
      openEdges: [
        { a: [8, 0], b: [8, 2] },
        { a: [8, 2], b: [8, 6] },
      ],
    }
    expect(suggestedFacadeEdge(full)).toBe(1)
    expect(facadeEdgeSize(full, 1).openingWidth).toBe(6)
    const frame = facadeGeometry(full, { ...facade, a: [8, 0], b: [8, 6], openingWidth: 6 })!
    expect([frame.openingStart, frame.openingEnd]).toEqual([0, 6])
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
