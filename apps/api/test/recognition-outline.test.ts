import { describe, expect, it } from 'vitest'
import { findOutline } from '../src/modules/recognition/local/outline.ts'
import { findRegion, inRing, ringArea } from '../src/modules/recognition/local/region.ts'
import type { Line } from '../src/modules/recognition/local/lines.ts'
import type { PxPoint } from '../src/modules/recognition/local/region.ts'

const ring = (points: PxPoint[], color = '#000000'): Line[] =>
  points.map(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length]!
    return { x1, y1, x2, y2, color }
  })
const rectangle = (x: number, y: number, w: number, h: number, color?: string) =>
  ring(
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    color,
  )
const anchors = [
  { x: 130, y: 140, w: 40, h: 30 },
  { x: 270, y: 180, w: 40, h: 30 },
  { x: 440, y: 330, w: 40, h: 30 },
]
const hints = { pxPerM: 60, thinPx: 15 }
const run = (lines: Line[]) => findOutline(800, 600, lines, anchors, hints)

describe('租赁线候选与全图边界', () => {
  it('四条长线与分成多段的同一租赁线得到相同边界', () => {
    const lease = rectangle(100, 100, 400, 300, '#ff0000')
    const split = lease.flatMap((l) =>
      Array.from({ length: 10 }, (_, i) => ({
        ...l,
        x1: l.x1 + ((l.x2 - l.x1) * i) / 10,
        y1: l.y1 + ((l.y2 - l.y1) * i) / 10,
        x2: l.x1 + ((l.x2 - l.x1) * (i + 1)) / 10,
        y2: l.y1 + ((l.y2 - l.y1) * (i + 1)) / 10,
      })),
    )
    const first = run(lease)
    const second = run(split)
    expect(first?.source).toBe('lease')
    expect(second?.source).toBe('lease')
    expect(ringArea(first!.points)).toBeCloseTo(ringArea(second!.points), 0)
  })

  it('不完整红线不能抢占包含更多道具的全图边界', () => {
    // The red loop closes around two of three anchors: enough for the region's 60% gate.
    const red = rectangle(100, 100, 230, 160, '#ff0000')
    const result = run([...rectangle(100, 100, 400, 300), ...red])
    expect(result?.source).toBe('drawing')
    expect(inRing([460, 345], result!.points)).toBe(true)
    expect(ringArea(result!.points)).toBeCloseTo(120000, -2)
  })

  it('未闭合的红线退回全图，不用颜色强行补出整面墙', () => {
    const red = rectangle(110, 110, 380, 280, '#ff0000').slice(0, 3)
    expect(run([...rectangle(100, 100, 400, 300), ...red])?.source).toBe('drawing')
    expect(run(red)).toBeNull()
  })

  it('拒绝与独立比例及图注面积明显冲突的红色外框', () => {
    const drawing = rectangle(100, 100, 400, 300)
    const red = rectangle(70, 70, 550, 450, '#ff0000')
    const result = findOutline(1000, 800, [...drawing, ...red], anchors, {
      ...hints,
      expectedArea: 120000,
    })
    expect(result?.source).toBe('drawing')
  })

  it('圆形岛店的虚线租赁边界保留圆弧，内侧墙开口不泄漏', () => {
    const circle: PxPoint[] = Array.from({ length: 96 }, (_, i) => {
      const angle = (2 * Math.PI * i) / 96
      return [350 + 190 * Math.cos(angle), 300 + 190 * Math.sin(angle)]
    })
    const lease = ring(circle, '#ff0000').map((l) => ({
      ...l,
      x2: l.x1 + (l.x2 - l.x1) * 0.65,
      y2: l.y1 + (l.y2 - l.y1) * 0.65,
    }))
    const interior = [
      { x: 270, y: 230, w: 40, h: 30 },
      { x: 360, y: 330, w: 40, h: 30 },
    ]
    const openWall = ring(
      circle.map(([x, y]) => [350 + (x - 350) * 0.9, 300 + (y - 300) * 0.9]),
    ).slice(8, 88)
    const result = findOutline(800, 600, [...openWall, ...lease], interior, hints)
    expect(result?.source).toBe('lease')
    expect(result!.points.length).toBeGreaterThan(12)
    expect(ringArea(result!.points) / (Math.PI * 190 ** 2)).toBeCloseTo(1, 1)
  })

  it('贴边封闭道具框不使整店边界退化为道具区域', () => {
    const props = [
      { x: 100, y: 180, w: 60, h: 80 },
      { x: 400, y: 320, w: 80, h: 80 },
    ]
    const result = findOutline(
      800,
      600,
      [...rectangle(100, 100, 400, 300), ...props.flatMap((b) => rectangle(b.x, b.y, b.w, b.h))],
      props,
      hints,
    )
    expect(result?.source).toBe('drawing')
    expect(ringArea(result!.points) / 120000).toBeCloseTo(1, 1)
  })

  const structural = (points: PxPoint[]) => ring(points).map((l) => ({ ...l, w: 2 }))
  const furniture = () =>
    [200, 350].flatMap((x) => rectangle(x, 380, 35, 20, '#999999').map((l) => ({ ...l, w: 0.5 })))
  const shop: PxPoint[] = [
    [100, 100],
    [500, 100],
    [500, 400],
    [100, 400],
  ]

  it('以独立闭合的线条补回家具造成的假凹口，不用凸包补边', () => {
    const lines = [...structural(shop), ...furniture()]
    const baseline = findRegion(800, 600, lines, anchors, hints)
    expect(ringArea(baseline!)).toBeLessThan(120000)
    const result = findOutline(800, 600, lines, anchors, { ...hints, expectedArea: 120000 })
    expect(result?.source).toBe('stroke')
    expect(result!.points).toHaveLength(4)
    expect(ringArea(result!.points)).toBeCloseTo(120000, -1)
  })

  it('保留同一结构轮廓中真实的柱位凹角', () => {
    const notch: PxPoint[] = [
      [100, 100],
      [260, 100],
      [260, 160],
      [320, 160],
      [320, 100],
      [500, 100],
      [500, 400],
      [100, 400],
    ]
    const lines = [...structural(notch), ...furniture()]
    const result = findOutline(800, 600, lines, anchors, { ...hints, expectedArea: 116400 })
    expect(result?.source).toBe('stroke')
    expect(inRing([290, 120], result!.points)).toBe(false)
    expect(inRing([220, 390], result!.points)).toBe(true)
    expect(ringArea(result!.points)).toBeCloseTo(116400, -1)
  })

  it('缺少独立面积依据时不按线宽猜测外边界', () => {
    const lines = [...structural(shop), ...furniture()]
    const result = findOutline(800, 600, lines, anchors, hints)
    expect(result?.source).toBe('drawing')
  })

  it('面积不符时不把粗线图框标为独立结构轮廓', () => {
    const lines = [
      ...structural([
        [70, 70],
        [550, 70],
        [550, 450],
        [70, 450],
      ]),
      ...rectangle(100, 100, 400, 300, '#404040'),
    ]
    const result = findOutline(800, 600, lines, anchors, { ...hints, expectedArea: 120000 })
    expect(result?.source).toBe('drawing')
    expect(result!.points).toEqual(
      findRegion(800, 600, lines, anchors, { ...hints, expectedArea: 120000 }),
    )
  })
})
