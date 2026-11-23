import { describe, expect, it } from 'vitest'
import { Box3, Group, Vector3 } from 'three'
import { buildAdditionalProduct } from './four-table-products.ts'
import { productTray, outwardAngle, placeProductTray } from './product-tray.ts'

describe('SI2.0 产品托盘', () => {
  it('按实际选款匹配，同时区分普通、场景及打样款', () => {
    for (const unit of ['X5', 'X6', 'X4 Air']) expect(productTray('SI2.0', unit)).toBe('single')
    expect(productTray('SI2.0', 'X5+X4 Air')).toBe('double')
    expect(productTray('SI2.0', 'scene-X6')).toBe('scene')
    expect(productTray('SI2.0', 'AP2')).toBe('ace')
    expect(productTray('SI2.0', 'Mic Pro')).toBe('mic-pro')
    expect(productTray('SI2.0', 'GO Ultra')).toBe('go-ultra')
    for (const unit of ['scene-Luna Ultra', 'Luna C', 'scene-X6-opt', null])
      expect(productTray('SI2.0', unit)).toBeUndefined()
    expect(productTray('SI1.0', 'X5')).toBeUndefined()
  })
  it.each([
    ['portrait', 'L1', 'left', -1, 0],
    ['portrait', 'R3', 'left', 1, 0],
    ['portrait', 'E', 'right', 0, 1],
    ['landscape', 'T3', 'right', 0, -1],
    ['landscape', 'B2', 'left', 0, 1],
    ['landscape', 'E', 'left', -1, 0],
    ['landscape', 'E', 'right', 1, 0],
    ['landscape', 'S1', 'left', 0, 1],
  ] as const)('按照 %s %s %s 的顾客方向摆放', (orientation, slot, end, x, z) => {
    const group = new Group()
    placeProductTray(
      { group, width: 0.32, depth: 0.18 },
      { slot, x: 0.1, z: -0.2, w: 0.18, d: 0.32, hero: false },
      0.9,
      outwardAngle(slot, orientation, end),
    )
    const front = group.getWorldDirection(new Vector3())
    expect(front.x).toBeCloseTo(x)
    expect(front.z).toBeCloseTo(z)
    expect(group.position.toArray()).toEqual([0.1, 0.901, -0.2])
    expect(group.scale.x).toBeCloseTo(x === 0 ? 0.18 / 0.32 : 1)
  })
})

it.each([
  'Luna A',
  'Luna B',
  'Flow2',
  'Link2',
  'AG',
  'AG Pac Air',
  'AG Pac Neo',
  'GO Ultra HK',
  'GO 3S 复古',
  'AP2 大师',
  'AP2 街拍',
] as const)('将四桌选款 %s 装到一个可旋转的实体托盘', (unit) => {
  expect(productTray('SI2.0', unit)).toBe(unit)
  expect(productTray('SI1.0', unit)).toBeUndefined()
  const group = new Group()
  buildAdditionalProduct(unit, group)
  const bounds = new Box3().setFromObject(group)
  expect(bounds.max.y).toBeGreaterThan(0.06)
  expect(bounds.max.y).toBeLessThan(0.4)
  expect(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x))).toBeLessThan(0.16)
})
