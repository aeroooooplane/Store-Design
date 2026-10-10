import { describe, expect, it } from 'vitest'
import { WALL_THICKNESS_M, rectangleSpace } from '@store/shared'
import type { Space } from '@store/shared'
import {
  dimensionChains,
  readableAngle,
  symbolBaseRotation,
  symbolSizeFromSvg,
  wallBands,
} from './plan-drawing.ts'

const t = WALL_THICKNESS_M
/** 8 × 6 m, entrance on the bottom edge from x = 3 to 5. */
const shop = (): Space => ({
  ...rectangleSpace(8, 6, 3.2),
  entrances: [{ a: [3, 6], b: [5, 6], kind: 'main' }],
})

const round = (p: readonly number[]) => p.map((v) => Math.round(v * 1000) / 1000)

describe('wallBands', () => {
  it('mitres corners and caps the wall ends at the entrance', () => {
    const bands = wallBands(shop(), 'side_hall')
    expect(bands).toHaveLength(5)
    // Back wall (top): corners meet the side walls' outer faces.
    expect(bands[0]?.polygon.map(round)).toEqual([
      [0, 0],
      [8, 0],
      [8 + t, -t],
      [-t, -t],
    ])
    expect(bands[0]?.outline).toHaveLength(2)
    // The bottom-right run stops at the entrance: it gets an end cap there.
    const beforeEntrance = bands[2]
    expect(beforeEntrance?.polygon.map(round)).toEqual([
      [8, 6],
      [5, 6],
      [5, 6 + t],
      [8 + t, 6 + t],
    ])
    expect(beforeEntrance?.outline.map((line) => line.map(round))).toContainEqual([
      [5, 6],
      [5, 6 + t],
    ])
  })

  it('draws no walls for island shops', () => {
    expect(wallBands(shop(), 'island')).toEqual([])
  })
})

describe('dimensionChains', () => {
  it('measures every edge outside the plan, split at the entrance', () => {
    const chains = dimensionChains(shop(), 0.6)
    expect(chains.map((d) => d.label)).toEqual(['8000', '6000', '3000', '2000', '3000', '6000'])
    const top = chains[0]
    expect(top?.a.map((v) => Math.round(v * 100) / 100)).toEqual([0, -0.6])
    expect(top?.outward).toEqual([0, -1])
    expect(chains.every((d) => d.angle > -90 && d.angle <= 90)).toBe(true)
  })
})

describe('readableAngle', () => {
  it('never turns text upside down', () => {
    expect(readableAngle([1, 0])).toBe(0)
    expect(readableAngle([-1, 0])).toBe(0)
    expect(readableAngle([0, 1])).toBe(90)
    expect(readableAngle([0, -1])).toBe(90)
  })
})

describe('symbols', () => {
  it('reads the drawn size without the 18 mm margin', () => {
    const svg = '<svg width="1836mm" viewBox="-18 -18 1836 1036"><rect/></svg>'
    expect(symbolSizeFromSvg(svg)).toEqual({ w: 1.8, d: 1 })
    expect(symbolSizeFromSvg('<svg></svg>')).toBeNull()
  })

  it('turns the symbol to the model front, or to match the footprint', () => {
    const size = { w: 1.8, d: 0.5 }
    expect(symbolBaseRotation('+Z', { w: 1.8, d: 0.5 }, size)).toBe(0)
    expect(symbolBaseRotation('-Z', { w: 1.8, d: 0.5 }, size)).toBe(180)
    expect(symbolBaseRotation('+X', { w: 0.5, d: 1.8 }, size)).toBe(-90)
    expect(symbolBaseRotation('-X', { w: 0.5, d: 1.8 }, size)).toBe(90)
    expect(symbolBaseRotation('any', { w: 1, d: 1.8 }, { w: 1.8, d: 1 })).toBe(90)
    expect(symbolBaseRotation(null, { w: 1.8, d: 1 }, { w: 1.8, d: 1 })).toBe(0)
  })
})
