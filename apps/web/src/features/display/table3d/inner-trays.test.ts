import { expect, it } from 'vitest'
import { innerPlaces, innerFitNote } from './inner-trays.ts'

it('按零件图取实体毫米值，同一模块不随槽长或组合改变', () => {
  for (const d of [0.68, 1.268]) {
    const strip = { x: 0, z: 0, w: 0.14, d }
    const places = innerPlaces(['A7', 'C4', 'A8'], strip, 'left')
    expect(places.map((p) => p.span)).toEqual([0.11, 0.445, 0.11])
    expect(places.every((p) => p.width === 0.125)).toBe(true)
    expect(places[0]!.z).toBeLessThan(places[2]!.z)
    expect(innerPlaces(['D4'], strip, 'left')[0]).toMatchObject({ span: 0.225, width: 0.125, z: 0 })
  }
})
it('三只 D 盘超净长 5mm 时提示复核且不压缩，未知编号不猜尺寸', () => {
  const ids = ['D16', 'D13', 'D12', '手填']
  expect(innerFitNote(ids)).toContain('5 mm')
  expect(innerFitNote(ids)).toContain('手填')
  expect(innerFitNote(['A7', 'C4', 'A8'])).toBe('')
  expect(innerPlaces(ids, { x: 0, z: 0, w: 0.14, d: 1 }, 'left').map((p) => p.span)).toEqual([
    0.225, 0.225, 0.225,
  ])
})
it('横桌左右端头镜像，不交换盘体的长宽', () => {
  const strip = { x: 0, z: 0, w: 1.2, d: 0.14 }
  const a = innerPlaces(['A2', 'D4'], strip, 'left'),
    b = innerPlaces(['A2', 'D4'], strip, 'right')
  expect(a[0]!.x).toBe(-b[0]!.x)
  expect(a[0]!.span).toBe(b[0]!.span)
})
