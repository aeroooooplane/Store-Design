import { describe, it, expect } from 'vitest'
import { resizeFine } from './fine-model.ts'
describe('原图尺寸编辑', () => {
  it('按局部轴改斜矩形宽度，中心与深度保持', () => {
    const p = resizeFine(
      [
        [10, 0],
        [20, 10],
        [15, 15],
        [5, 5],
      ],
      'w',
      Math.sqrt(200) * 2,
    )
    expect(p[0]![0]).toBeCloseTo(5)
    expect(p[0]![1]).toBeCloseTo(-5)
    expect(p.reduce((s, q) => s + q[0], 0) / 4).toBeCloseTo(12.5)
    expect(Math.hypot(p[3]![0] - p[0]![0], p[3]![1] - p[0]![1])).toBeCloseTo(Math.sqrt(50))
  })
  it('拒绝零尺寸与非矩形点数', () => {
    expect(() =>
      resizeFine(
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        'w',
        2,
      ),
    ).toThrow()
    expect(() =>
      resizeFine(
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        'w',
        0,
      ),
    ).toThrow()
  })
})
