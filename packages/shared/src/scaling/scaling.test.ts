import { describe, expect, it } from 'vitest'
import { frontCorners, scaleFromCorner, scaleFromEnd, widthEnds } from './index.ts'

// A 3453 mm LOGO on the back wall (z = 0), front facing +z, its bottom 2.5 m up.
const model = { w: 3.453, d: 0.05, h: 0.471 }
const logo = { cx: 3, cz: 0.025, rotation: 0, elevation: 2.5 }

describe('scaleFromEnd', () => {
  it('keeps the other end where it was', () => {
    expect(widthEnds(logo, model)).toEqual([
      [1.2735, 0.025],
      [4.7265, 0.025],
    ])
    // The +X end dragged to 2 m from the −X end (the pointer's depth does not matter).
    expect(scaleFromEnd(logo, model, 1, [3.2735, 0.4])).toEqual({
      scale: 0.579,
      cx: 2.273,
      cz: 0.025,
    })
    expect(scaleFromEnd(logo, model, -1, [2.7265, 0])).toEqual({
      scale: 0.579,
      cx: 3.727,
      cz: 0.025,
    })
  })

  it('stays within the scale limits and follows the rotation', () => {
    expect(scaleFromEnd(logo, model, 1, [0, 0]).scale).toBe(0.2)
    // On the left wall (rotation 270: its width runs along −z).
    const side = { cx: 0.025, cz: 2, rotation: 270 }
    const ends = widthEnds(side, model)
    expect(ends[0][0]).toBeCloseTo(0.025)
    expect(ends[0][1]).toBeCloseTo(3.7265)
    const grown = scaleFromEnd(side, model, 1, [0, -1])
    expect(grown.scale).toBeCloseTo(4.7265 / 3.453, 3)
    expect(grown.cx).toBeCloseTo(0.025)
  })
})

describe('scaleFromCorner', () => {
  it('grows along the diagonal from the opposite corner', () => {
    const corners = frontCorners(logo, model)
    expect(corners.find((c) => c.corner.x === 1 && c.corner.y === 1)?.at).toEqual([
      4.7265, 2.971, 0.05,
    ])
    // The top +X corner dragged to half size: the bottom −X corner stays.
    const half = scaleFromCorner(logo, model, { x: 1, y: 1 }, { plan: [3, 0.05], y: 2.7355 })
    expect(half).toEqual({ scale: 0.5, cx: 2.137, cz: 0.025, elevation: 2.5 })
    // The bottom −X corner dragged instead: the top +X corner stays, so the bottom rises.
    const low = scaleFromCorner(logo, model, { x: -1, y: -1 }, { plan: [3, 0.05], y: 2.7355 })
    expect(low.scale).toBe(0.5)
    expect(low.cx).toBeCloseTo(3.863)
    expect(low.elevation).toBeCloseTo(2.736)
  })
})
