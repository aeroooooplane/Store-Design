import { describe, expect, it } from 'vitest'
import {
  distanceToSegment,
  isSimplePolygon,
  locatePoint,
  polygonIntersectionArea,
  signedArea,
} from '../geometry/polygon.ts'
import type { Point } from '../geometry/types.ts'
import { rectangleSpace } from '../schemas/space.ts'
import { wallBands, wallContours } from './wall-bands.ts'
import { WALL_THICKNESS_M } from './walls.ts'

const contains = (rings: Point[][], p: Point) =>
  rings.reduce(
    (n, r) => n + (locatePoint(p, r, 1e-7) === 'outside' ? 0 : Math.sign(signedArea(r))),
    0,
  ) > 0
describe('连续200mm边界墙', () => {
  it('平移和斜转后的凹形墙仍闭合，面积等于200mm轮廓带且不侵占室内', () => {
    const base: [number, number][] = [
      [0, 0],
      [8, 0],
      [8, 4],
      [5, 4],
      [5, 6],
      [0, 6],
    ]
    for (let i = 1; i <= 20; i++) {
      const angle = i * 0.131,
        c = Math.cos(angle),
        s = Math.sin(angle)
      const boundary = base.map(([x, z]): [number, number] => [
        x * c - z * s + 12.3456789,
        x * s + z * c - 23.456789,
      ])
      const rings = wallContours(
        { ...rectangleSpace(8, 6, 3), boundary, entrances: [] },
        'side_hall',
      )
      expect(rings.every((r) => isSimplePolygon(r, 1e-8))).toBe(true)
      expect(rings.reduce((n, r) => n + signedArea(r), 0)).toBeCloseTo(5.76, 5)
      expect(
        rings.reduce(
          (n, r) => n + Math.sign(signedArea(r)) * polygonIntersectionArea(r, boundary),
          0,
        ),
      ).toBeCloseTo(0, 5)
    }
  })
  it('封闭矩形只有内外两圈，厚度200mm且不占用租赁面积', () => {
    const space = { ...rectangleSpace(8, 6, 3), entrances: [] }
    const rings = wallContours(space, 'side_hall')
    expect(WALL_THICKNESS_M).toBe(0.2)
    expect(rings).toHaveLength(2)
    expect(rings.reduce((n, r) => n + signedArea(r), 0)).toBeCloseTo(8.4 * 6.4 - 48)
    expect(
      rings.reduce(
        (n, r) => n + Math.sign(signedArea(r)) * polygonIntersectionArea(r, space.boundary),
        0,
      ),
    ).toBeCloseTo(0)
    expect(contains(rings, [-0.1, -0.1])).toBe(true)
    expect(contains(rings, [0.01, 0.01])).toBe(false)
  })
  it('部分入口和开边保持通透，墙端有封口，反向轮廓相同', () => {
    const space = {
      ...rectangleSpace(8, 6, 3),
      entrances: [
        { a: [3, 6] as [number, number], b: [5, 6] as [number, number], kind: 'main' as const },
      ],
      openEdges: [{ a: [8, 1] as [number, number], b: [8, 2] as [number, number] }],
    }
    for (const boundary of [space.boundary, [...space.boundary].reverse()]) {
      const rings = wallContours({ ...space, boundary }, 'side_hall')
      expect(contains(rings, [4, 6.1])).toBe(false)
      expect(contains(rings, [8.1, 1.5])).toBe(false)
      expect(contains(rings, [2, 6.1])).toBe(true)
      expect(contains(rings, [8.1, 3])).toBe(true)
      expect(rings.every((r) => isSimplePolygon(r, 1e-8))).toBe(true)
    }
  })
  it('短于墙厚的凹角台阶不交叉、不侵入原空间，曲线分段无裂缝', () => {
    const notch: [number, number][] = [
      [0, 0],
      [8, 0],
      [8, 5],
      [4.1, 5],
      [4.1, 4.9],
      [4, 4.9],
      [4, 6],
      [0, 6],
    ]
    const circle: [number, number][] = Array.from({ length: 64 }, (_, i) => [
      4 + 3 * Math.cos((i * 2 * Math.PI) / 64),
      4 + 3 * Math.sin((i * 2 * Math.PI) / 64),
    ])
    for (const boundary of [notch, circle]) {
      const space = { ...rectangleSpace(8, 6, 3), boundary, entrances: [] },
        rings = wallContours(space, 'side_hall')
      expect(rings.every((r) => isSimplePolygon(r, 1e-8))).toBe(true)
      expect(
        rings.reduce(
          (n, r) => n + Math.sign(signedArea(r)) * polygonIntersectionArea(r, boundary),
          0,
        ),
      ).toBeCloseTo(0, 5)
      const bands = wallBands(space, 'side_hall')
      for (let i = 0; i < bands.length; i++)
        expect(
          distanceToSegment(
            bands[i]!.polygon[2]!,
            bands[(i + 1) % bands.length]!.polygon[3]!,
            bands[(i + 1) % bands.length]!.polygon[3]!,
          ),
        ).toBeLessThan(1e-6)
    }
  })
  it('中岛没有凭空生成外围墙', () =>
    expect(wallContours(rectangleSpace(8, 6, 3), 'island')).toEqual([]))
})
