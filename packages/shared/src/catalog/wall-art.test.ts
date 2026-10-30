import { expect, it } from 'vitest'
import { deliveryLegend } from '../delivery/index.ts'
import { assetFitProblem, LayoutSchema } from '../schemas/layout.ts'
import type { LayoutItem } from '../schemas/layout.ts'
import {
  wallArtAsset,
  resizeWallArt,
  wallArtSize,
  wallArtFromEnd,
  wallArtFromCorner,
} from './wall-art.ts'

const art = wallArtAsset()
const item: LayoutItem = {
  id: 'signage-1',
  assetId: art.id,
  function: 'signage',
  name: art.name,
  cx: 3,
  cz: 0,
  w: 1.5,
  d: 0.001,
  h: 0.85,
  rotation: 0,
  mount: 'wall',
  elevation: 1,
  placeholder: false,
  locked: false,
}

it('独立宽高精确到毫米，固定厚度，布局序列化后仍通过资产尺寸校验', () => {
  const next = resizeWallArt(item, 1.777, 1.234)
  expect(wallArtSize(next)).toEqual({ w: 1.777, d: 0.001, h: 1.234 })
  expect(next.scale).toBeUndefined()
  const loaded = LayoutSchema.parse(JSON.parse(JSON.stringify({ schemaVersion: 3, items: [next] })))
    .items[0]!
  expect(assetFitProblem(loaded, art)).toBeNull()
  expect(assetFitProblem({ ...loaded, d: 0.2 }, art)).toBe('size')
  expect(assetFitProblem({ ...loaded, mount: 'floor' }, art)).toBe('size')
  expect(assetFitProblem({ ...loaded, scale: 2 }, art)).toBe('size')
  expect(assetFitProblem({ ...loaded, assetId: 'asset-8' }, { ...art, id: 'asset-8' })).toBe('size')
})

it('90度及任意角度下保持自身宽高，端点与对角拖动不做等比缩放', () => {
  const turned = resizeWallArt({ ...item, rotation: 90 }, 2, 0.9)
  expect(turned).toMatchObject({ w: 0.001, d: 2, h: 0.9 })
  expect(wallArtFromEnd(turned, 1, [3, 2])).toMatchObject({ w: 3, h: 0.9, cx: 3, cz: 0.5 })
  expect(wallArtFromCorner(item, { x: 1, y: 1 }, { plan: [4.25, 0.0005], y: 2.2 })).toMatchObject({
    w: 2,
    h: 1.2,
    cx: 3.25,
    elevation: 1,
  })
})

it('PDF图例使用实例尺寸；相同尺寸跨旋转合并，不同尺寸分别编号', () => {
  const a = resizeWallArt(item, 1.777, 1.234)
  const b = resizeWallArt({ ...item, id: 'b', rotation: 90 }, 1.777, 1.234)
  const legend = deliveryLegend([a, b, { ...item, id: 'standard' }], new Map([[art.id, art]]))
  expect(legend.entries).toHaveLength(2)
  expect(legend.entries.find((entry) => entry.size.w === 1.777)).toMatchObject({
    size: { w: 1.777, d: 0.001, h: 1.234 },
    count: 2,
  })
  expect(legend.numbers[a.id]).toBe(legend.numbers.b)
  expect(legend.numbers.standard).not.toBe(legend.numbers.b)
})

it('旧灯箱和LOGO的图例及真实模型尺寸契约保持原行为', () => {
  const oldLightbox = { ...art, id: 'asset-8', footprint: { w: 2, d: 0.1, h: 1 } }
  const oldLogo = { ...art, id: 'asset-90000001', footprint: { w: 1.4, d: 0.05, h: 0.3 } }
  const lightbox = {
    ...item,
    assetId: oldLightbox.id,
    ...oldLightbox.footprint,
    id: 'old-lightbox',
  }
  const logo = { ...item, assetId: oldLogo.id, w: 2.8, d: 0.1, h: 0.6, scale: 2, id: 'old-logo' }
  expect(assetFitProblem(lightbox, oldLightbox)).toBeNull()
  expect(assetFitProblem(logo, oldLogo)).toBeNull()
  const legend = deliveryLegend(
    [lightbox, logo],
    new Map([
      [oldLightbox.id, oldLightbox],
      [oldLogo.id, oldLogo],
    ]),
  )
  expect(legend.entries.find((entry) => entry.assetId === oldLightbox.id)?.size).toEqual(
    oldLightbox.footprint,
  )
  expect(legend.entries.find((entry) => entry.assetId === oldLogo.id)?.size).toEqual(
    oldLogo.footprint,
  )
})
