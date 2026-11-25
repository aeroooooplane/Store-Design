import { describe, expect, it } from 'vitest'
import { rectangleSpace } from '../schemas/space.ts'
import { modelWithinBoundary } from './index.ts'

const boundary = rectangleSpace(8, 6, 3).boundary
const box = { cx: 4, cz: 3, w: 1.8, d: 0.9, rotation: 0 }

describe('模型完整占地的外扩一米范围', () => {
  it('边缘恰好超出一米合法，中心尚在范围内但边缘超过时拒绝', () => {
    expect(modelWithinBoundary({ ...box, cx: 8.1 }, boundary)).toBe(true)
    expect(modelWithinBoundary({ ...box, cx: 8.11 }, boundary)).toBe(false)
    expect(modelWithinBoundary({ ...box, cx: -0.1 }, boundary)).toBe(true)
  })

  it('角点用欧氏距离，旋转用实际外轮廓', () => {
    expect(modelWithinBoundary({ ...box, cx: -0.6, cz: -0.6, w: 0.2, d: 0.2 }, boundary)).toBe(true)
    expect(modelWithinBoundary({ ...box, cx: -0.65, cz: -0.65, w: 0.2, d: 0.2 }, boundary)).toBe(
      false,
    )
    expect(modelWithinBoundary({ ...box, cx: 0, w: 2, d: 2, rotation: 45 }, boundary)).toBe(false)
    expect(modelWithinBoundary({ ...box, cx: 0.5, w: 2, d: 2, rotation: 45 }, boundary)).toBe(true)
  })

  it('跨越凹形缺口时也检查内部，四角和中心都在店内仍不能漏检', () => {
    const recessed = [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
      [0, 7],
      [7, 7],
      [7, 3],
      [0, 3],
    ] as const
    expect(modelWithinBoundary({ ...box, cx: 10, cz: 5, w: 18, d: 8 }, recessed)).toBe(false)
    const narrow = [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
      [0, 5.9],
      [7, 5.9],
      [7, 4.1],
      [0, 4.1],
    ] as const
    expect(modelWithinBoundary({ ...box, cx: 10, cz: 5, w: 18, d: 8 }, narrow)).toBe(true)
  })
})
