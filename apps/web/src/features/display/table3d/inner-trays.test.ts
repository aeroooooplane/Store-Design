import { expect, it } from 'vitest'
import { innerPlaces } from './inner-trays.ts'

it('按保存顺序摆入内盘，保留长短比例和重复或自填编号', () => {
  const ids = ['A7', 'C4', 'A8']
  const places = innerPlaces(ids, { x: 0.1, z: 0.2, w: 0.14, d: 1.2 }, 'left')
  expect(places.map((p) => p.id)).toEqual(ids)
  expect(places[1]!.span / places[0]!.span).toBe(4)
  expect(places.map((p) => +p.z.toFixed(2))).toEqual([-0.3, 0.2, 0.7])
  expect(
    innerPlaces(['D4', 'D4', '手填'], { x: 0, z: 0, w: 1, d: 0.1 }, 'right').map((p) => p.span),
  ).toEqual([0.4, 0.4, 0.2])
})
it('横桌在两种端头方向下互为镜像', () => {
  const strip = { x: 0, z: 0, w: 1.2, d: 0.14 }
  for (const end of ['left', 'right'] as const) {
    const places = innerPlaces(['A2', 'D4'], strip, end)
    expect(places[0]!.x * (end === 'left' ? 1 : -1)).toBeGreaterThan(0)
    expect(places[1]!.x * (end === 'left' ? 1 : -1)).toBeLessThan(0)
  }
})
