import { describe, expect, it } from 'vitest'
import { findRegion, inRing, ringArea } from '../src/modules/recognition/local/region.ts'
import type { PxPoint } from '../src/modules/recognition/local/region.ts'

type Line = { x1: number; y1: number; x2: number; y2: number }

/** The closed polyline through the points, as drawn lines. */
const ring = (points: readonly PxPoint[]): Line[] =>
  points.map(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length]!
    return { x1, y1, x2, y2 }
  })

/** A line drawn as dashes of `dash` px with `gap` px between them. */
const dashed = (a: PxPoint, b: PxPoint, dash: number, gap: number): Line[] => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len] as const
  const out: Line[] = []
  for (let t = 0; t < len; t += dash + gap) {
    const e = Math.min(len, t + dash)
    out.push({ x1: a[0] + u[0] * t, y1: a[1] + u[1] * t, x2: a[0] + u[0] * e, y2: a[1] + u[1] * e })
  }
  return out
}

const box = (x: number, y: number, w = 40, h = 30) => ({ x, y, w, h })

/** Every corner of `expected` has a corner of `found` within `tolerance` px. */
const cornersNear = (found: readonly PxPoint[], expected: readonly PxPoint[], tolerance = 4) =>
  expected.every(([x, y]) => found.some(([u, v]) => Math.hypot(u - x, v - y) <= tolerance))

describe('findRegion', () => {
  it('traces an L-shaped shop corner for corner', () => {
    const shop: PxPoint[] = [
      [100, 100],
      [500, 100],
      [500, 250],
      [300, 250],
      [300, 450],
      [100, 450],
    ]
    const region = findRegion(800, 600, ring(shop), [box(150, 150), box(400, 150), box(150, 380)])
    expect(region).not.toBeNull()
    expect(region).toHaveLength(6)
    expect(cornersNear(region!, shop)).toBe(true)
    expect(ringArea(region!) / ringArea(shop)).toBeCloseTo(1, 1)
  })

  it('follows a slanted wall and an arc', () => {
    // A front wall at a slant and the back right corner rounded off: radius 2 m at 60 px/m.
    const arc: PxPoint[] = Array.from({ length: 17 }, (_, i) => {
      const a = (-Math.PI / 2) * (1 - i / 16)
      return [380 + 120 * Math.cos(a), 220 + 120 * Math.sin(a)]
    })
    const shop: PxPoint[] = [[100, 100], ...arc, [500, 420], [100, 480]]
    const region = findRegion(800, 600, ring(shop), [box(150, 150), box(300, 300), box(400, 350)], {
      pxPerM: 60,
    })
    expect(region).not.toBeNull()
    // The arc is kept as a few pieces, not one chord.
    expect(region!.length).toBeGreaterThanOrEqual(7)
    expect(
      cornersNear(region!, [
        [100, 100],
        [500, 420],
        [100, 480],
      ]),
    ).toBe(true)
    expect(Math.abs(ringArea(region!) / ringArea(shop) - 1)).toBeLessThan(0.03)
    // The arc's middle is within a few pixels of the outline.
    const [mx, my] = arc[8]!
    const gap = Math.min(
      ...region!.map(([x1, y1], i) => {
        const [x2, y2] = region![(i + 1) % region!.length]!
        const len2 = (x2 - x1) ** 2 + (y2 - y1) ** 2
        const t = Math.max(0, Math.min(1, ((mx - x1) * (x2 - x1) + (my - y1) * (y2 - y1)) / len2))
        return Math.hypot(mx - x1 - t * (x2 - x1), my - y1 - t * (y2 - y1))
      }),
    )
    expect(gap).toBeLessThan(5)
  })

  it('closes a storefront drawn with dashes', () => {
    const lines = [
      ...ring([
        [100, 100],
        [500, 100],
      ]).slice(0, 1),
      { x1: 500, y1: 100, x2: 500, y2: 400 },
      { x1: 100, y1: 100, x2: 100, y2: 400 },
      ...dashed([500, 400], [100, 400], 12, 6),
    ]
    const region = findRegion(800, 600, lines, [box(150, 150), box(380, 300)])
    expect(region).not.toBeNull()
    expect(
      cornersNear(region!, [
        [100, 100],
        [500, 100],
        [500, 400],
        [100, 400],
      ]),
    ).toBe(true)
  })

  it('peels a dimension band drawn along the shop off its edge', () => {
    const shop: PxPoint[] = [
      [100, 100],
      [500, 100],
      [500, 400],
      [100, 400],
    ]
    // A dimension chain 24 px (0.4 m at 60 px/m) below the front, with ticks up to the wall.
    const band = ring([
      [100, 400],
      [500, 400],
      [500, 424],
      [100, 424],
    ])
    const ticks = [150, 250, 350, 450].map((x) => ({ x1: x, y1: 400, x2: x, y2: 424 }))
    const region = findRegion(
      800,
      600,
      [...ring(shop), ...band, ...ticks],
      [box(150, 150), box(380, 300)],
      {
        thinPx: 15,
        pxPerM: 60,
      },
    )
    expect(region).not.toBeNull()
    // Corner for corner: peeling the band cuts none of the shop's corners off.
    expect(region).toHaveLength(4)
    expect(cornersNear(region!, shop, 1)).toBe(true)
  })

  it('finds nothing when the props are not enclosed, or there are too few of them', () => {
    // Three sides only: the paper flows in through the open front.
    const open = [
      { x1: 100, y1: 400, x2: 100, y2: 100 },
      { x1: 100, y1: 100, x2: 500, y2: 100 },
      { x1: 500, y1: 100, x2: 500, y2: 400 },
    ]
    expect(findRegion(800, 600, open, [box(150, 150), box(380, 300)])).toBeNull()
    const closed = ring([
      [100, 100],
      [500, 100],
      [500, 400],
      [100, 400],
    ])
    expect(findRegion(800, 600, closed, [box(150, 150)])).toBeNull()
  })

  it('tells points inside a ring from those outside', () => {
    const l: PxPoint[] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ]
    expect(ringArea(l)).toBe(64)
    expect(inRing([2, 8], l)).toBe(true)
    expect(inRing([8, 8], l)).toBe(false)
  })
})
