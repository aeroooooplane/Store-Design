import { describe, expect, it } from 'vitest'
import {
  CustomLogoTextSchema,
  changeLogoText,
  customLogoAsset,
  customLogoSize,
  logoTextBounds,
} from './custom-logo.ts'
import { LayoutItemSchema, LayoutSchema, assetFitProblem, scaleItem } from '../schemas/layout.ts'
import { deliveryLegend } from '../delivery/index.ts'

const asset = customLogoAsset()
const item = () =>
  LayoutItemSchema.parse({
    id: 'logo',
    assetId: asset.id,
    name: asset.name,
    function: 'signage',
    cx: 2,
    cz: 2,
    rotation: 0,
    ...asset.footprint,
    mount: 'wall',
    elevation: 1.5,
    logoText: 'LOGO',
  })

describe('自定义 LOGO', () => {
  it('交付图例按实际文字和尺寸分组，旋转不改变型号', () => {
    const a = changeLogoText(item(), '门店'),
      b = changeLogoText(item(), '影石')
    const rotated = { ...a, id: 'turned', rotation: 90, ...customLogoSize('门店', 1, 90) }
    const legend = deliveryLegend([a, { ...b, id: 'b' }, rotated], new Map([[asset.id, asset]]))
    expect(legend.entries).toHaveLength(2)
    expect(legend.entries.find((e) => e.name === '自定义LOGO：门店')?.count).toBe(2)
    expect(legend.entries.find((e) => e.name === '自定义LOGO：门店')?.size).toEqual(
      customLogoSize('门店'),
    )
  })
  it('支持常用中英文，拒绝空白、未收录字符和超长文字', () => {
    expect(CustomLogoTextSchema.parse('  门店 Insta360  ')).toBe('门店 Insta360')
    for (const text of ['', '   ', '😀', '\n', '\u200b', '字'.repeat(41)])
      expect(CustomLogoTextSchema.safeParse(text).success).toBe(false)
  })
  it('按实际字形决定宽度，修改文字保留字高、厚度、位置和缩放', () => {
    const scaled = scaleItem(item(), asset, 2)
    const next = changeLogoText(scaled, '影石 Insta360')
    expect(next.h).toBe(0.6)
    expect(next.d).toBe(0.06)
    expect(next.cx).toBe(2)
    expect(next.w).toBeGreaterThan(scaled.w)
    expect(assetFitProblem(next, asset)).toBeNull()
    expect(assetFitProblem({ ...next, w: next.w + 0.01 }, asset)).toBe('size')
    const bounds = logoTextBounds('LOGO')
    expect(asset.footprint.w).toBeCloseTo((0.3 * bounds.w) / bounds.h, 3)
  })
  it('旋转尺寸与字形一致，非自定义或锁定模型不可改字', () => {
    expect(customLogoSize('门店', 1, 90)).toEqual({ w: 0.03, d: customLogoSize('门店').w, h: 0.3 })
    const locked = { ...item(), locked: true }
    expect(changeLogoText(locked, '新文字')).toBe(locked)
    const normal = { ...item(), assetId: 'asset-1' }
    expect(changeLogoText(normal, '新文字')).toBe(normal)
    expect(LayoutSchema.safeParse({ schemaVersion: 3, items: [normal] }).success).toBe(false)
  })
})
