import { describe, expect, it } from 'vitest'
import type { CornerFacade, DoubleFacade, HangingFacade } from '../schemas/facade.ts'
import { normalizeSpace, rectangleSpace, SpaceSchema } from '../schemas/space.ts'
import {
  facadePlacementError,
  facadePlanSpans,
  hangingLogoSuggestion,
  reviewFacadeConfig,
} from './index.ts'

const room = rectangleSpace(12, 6, 3.2)
const double: DoubleFacade = {
  kind: 'double',
  a: [0, 6],
  b: [10, 6],
  joint: 'continuous',
  fasciaHeight: 0.6,
  screenInset: 0.05,
  openings: [
    { offset: 0.2, width: 5.1, clearHeight: 2.6 },
    { offset: 6, width: 3, clearHeight: 2.45 },
  ],
}

describe('facade forms', () => {
  it('keeps double openings independently and applies the B02 boundary at 10 m', () => {
    const logoCenters = (facade: DoubleFacade) =>
      reviewFacadeConfig(room, facade, 'SI2.0', 'domestic')?.sections[0]?.logos.map(
        (logo) => logo.center,
      )
    expect(logoCenters(double)).toEqual([5])
    expect(logoCenters({ ...double, b: [10.001, 6] })).toEqual([2.75, 7.5])
    expect(
      reviewFacadeConfig(room, double, 'SI1.0', 'domestic')?.sections[0]?.openings.map(
        (slot) => slot.height,
      ),
    ).toEqual([2.6, 2.45])
    expect(
      facadePlacementError(room, {
        ...double,
        openings: [double.openings[0], { ...double.openings[1], offset: 4 }],
      }),
    ).toBeTruthy()
    const saved = normalizeSpace(SpaceSchema.parse({ ...room, facade: double }))
    expect(saved.facade).toMatchObject({ kind: 'double', openings: double.openings })
  })

  it('applies B03 through-screen display and independently checks B06 on a fire break', () => {
    const led = { ...double, b: [12, 6] as [number, number], si2: { preset: 'led' as const } }
    const display = reviewFacadeConfig(room, { ...led, joint: 'display' }, 'SI2.0', 'domestic')!
    expect(display.sections[0]).toMatchObject({
      display: { start: 5.3, width: expect.closeTo(0.7) },
      screens: [{ start: 0, width: 12 }],
      logos: [expect.objectContaining({ center: 2.75 })],
    })
    const broken: DoubleFacade = {
      ...led,
      joint: 'break',
      fireBreak: true,
      openings: [led.openings[0], { offset: 6, width: 4.7, clearHeight: 2.55, screenWidth: 4.7 }],
    }
    expect(facadePlanSpans({ ...room, facade: broken }, 'side_hall')).toEqual([
      { a: [0, 6], b: [5.3, 6] },
      { a: [6, 6], b: [12, 6] },
    ])
    const fire = reviewFacadeConfig(room, broken, 'SI2.0', 'domestic')!
    expect(fire.sections[1]?.screens).toEqual([])
    expect(fire.issues).toContainEqual(expect.stringContaining('4800 mm'))
    const short = reviewFacadeConfig(
      room,
      {
        ...broken,
        openings: [broken.openings[0], { ...broken.openings[1], width: 3 }],
      },
      'SI2.0',
      'domestic',
    )!
    expect(short.sections[1]?.logos).toEqual([])
    expect(short.sections[1]?.screens).toEqual([])
  })

  it('uses existing curve chords between two SI2.0 corner logos and supports independent face choices', () => {
    const rounded = SpaceSchema.parse({
      ...room,
      boundary: [
        [0, 0],
        [10, 0],
        [10, 4.6],
        [9.999, 4.65],
        [9.9, 5.15],
        [9.65, 5.65],
        [9.1, 5.9],
        [8.5, 6],
        [0, 6],
      ],
      entrances: [],
    })
    const base = { clearHeight: 2.6, fasciaHeight: 0.6, screenInset: 0.05, logo: true }
    const corner: CornerFacade = {
      kind: 'corner',
      faces: [
        { ...base, a: [0, 6], b: [8.5, 6], openingWidth: 8.5 },
        {
          ...base,
          a: [10, 0],
          b: [10, 4.6],
          openingWidth: 4.1,
          openingOffset: 0.4,
          si2: { preset: 'led' },
        },
      ],
    }
    const result = reviewFacadeConfig(rounded, corner, 'SI2.0', 'domestic')!
    expect(result.sections.map((section) => section.logos.length)).toEqual([1, 1, 0, 0, 0, 0, 0])
    expect(result.sections[1]?.openings[0]).toMatchObject({ start: 0.4, end: 4.5 })
    expect(result.sections[2]?.frame.width).toBeLessThan(0.1)
    expect(result.sections.slice(2).every((section) => section.screens.length === 0)).toBe(true)
    expect(result.sections[1]?.screens).toHaveLength(1)
    expect(
      reviewFacadeConfig(
        rounded,
        { ...corner, faces: [corner.faces[0], { ...corner.faces[1], logo: false }] },
        'SI1.0',
        'domestic',
      )?.issues,
    ).toContainEqual(expect.stringContaining('新加坡'))
  })

  it('keeps SI1.0 hanging manual, checks an open portion and gates SI2.0 tilt strictly above 3000 mm', () => {
    const island = SpaceSchema.parse({
      ...room,
      shopType: 'island',
      entrances: [],
      openEdges: [{ a: [2, 6], b: [10, 6] }],
    })
    const hanging: HangingFacade = {
      kind: 'island_hanging',
      a: [2, 6],
      b: [10, 6],
      top: 3,
      beamHeight: 0.25,
      face: 'outward',
      corridorRestricted: true,
      tiltInward: true,
    }
    expect(facadePlacementError(island, { ...hanging, a: [1, 6] })).toBeTruthy()
    expect(facadePlanSpans({ ...island, facade: hanging }, 'side_hall')).toEqual([])
    expect(
      [2399, 2400, 2799, 2800, 2999, 3000, 3199, 3200].map((top) =>
        hangingLogoSuggestion(top / 1000),
      ),
    ).toEqual([undefined, 0.2, 0.2, 0.25, 0.25, 0.3, 0.3, undefined])
    const si1 = reviewFacadeConfig(island, hanging, 'SI1.0', 'domestic')!
    expect(si1.suggestion).toBeUndefined()
    expect(si1.sections[0]?.logos).toEqual([])
    expect(si1.issues).toContainEqual(expect.stringContaining('待复核'))
    const manual = reviewFacadeConfig(
      island,
      { ...hanging, si1LogoHeight: 0.26, si1Drop: 0.07 },
      'SI1.0',
      'domestic',
    )!
    expect(manual.clearance).toBeCloseTo(2.42)
    const si2 = reviewFacadeConfig(island, hanging, 'SI2.0', 'domestic')!
    expect(si2.sections[0]?.logos[0]).toMatchObject({ height: 0.3, top: 2.7, tilt: 0 })
    const tilted = reviewFacadeConfig(
      island,
      { ...hanging, top: 3.1, face: 'inward' },
      'SI2.0',
      'domestic',
    )!
    expect(tilted.sections[0]?.logos[0]?.tilt).toBeCloseTo(-Math.PI / 12)
    expect(tilted.sections[0]?.frame.outward[1]).toBe(-1)
  })
})
