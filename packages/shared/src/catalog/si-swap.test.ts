import { describe, expect, it } from 'vitest'
import type { Asset } from '../schemas/asset.ts'
import type { Layout, LayoutItem } from '../schemas/layout.ts'
import {
  SI_SWAP,
  layoutSi,
  nodeSiStyle,
  sameLayoutProps,
  siSwapName,
  swapLayoutSi,
} from './si-swap.ts'

type Mini = Pick<Asset, 'id' | 'name' | 'function' | 'footprint' | 'front' | 'placeable'>
const asset = (
  id: string,
  name: string,
  fn: Asset['function'],
  w: number,
  d: number,
  h: number,
  front: Asset['front'],
): Mini => ({ id, name, function: fn, footprint: { w, d, h }, front, placeable: true })

const catalog = new Map(
  [
    asset('asset-2595882', '1.2米配件柜', 'accessory_cabinet', 1.2, 0.45, 2.4, '+Z'),
    asset('asset-34327615', '1.2米配件柜', 'accessory_cabinet', 1.2, 0.54, 2.4, '+Z'),
    asset('asset-36890994', '2.4米配件柜(场景)', 'accessory_cabinet', 2.4, 0.54, 2.425, '+Z'),
    asset('asset-34320268', '1.8米边桌配件柜', 'side_cabinet', 0.5, 1.8, 1.214, '+X'),
    asset('asset-33660153', '1.8米配件边柜(带托盘)', 'side_cabinet', 1.8, 0.531, 1.214, '+Z'),
    asset('asset-408124', '1.8米普通中岛桌', 'island_table', 1, 1.8, 1.327, 'any'),
    asset('asset-24312623', '1.8米普通中岛桌', 'island_table', 1.8, 0.804, 1.214, 'any'),
    asset('asset-16510684', '试飞台', 'display_stand', 0.8, 0.8, 0.921, 'any'),
    asset('asset-1788391', '1.8米普通开箱桌', 'unboxing_table', 1.8, 2.199, 0.907, 'any'),
    asset('asset-16469753', '1.8米普通开箱桌', 'unboxing_table', 1.8, 1.63, 0.902, 'any'),
  ].map((a) => [a.id, a]),
)

const item = (
  id: string,
  assetId: string | null,
  cx: number,
  cz: number,
  extra: Partial<LayoutItem> = {},
): LayoutItem => {
  const a = assetId ? catalog.get(assetId) : undefined
  return {
    id,
    assetId,
    function: a?.function ?? 'other',
    name: a?.name ?? '参数化道具',
    cx,
    cz,
    rotation: 0,
    w: a?.footprint.w ?? 1,
    d: a?.footprint.d ?? 1,
    h: a?.footprint.h ?? 1,
    placeholder: false,
    locked: false,
    ...extra,
  }
}
const layout = (...items: LayoutItem[]): Layout => ({ schemaVersion: 3, items, planning: null })

describe('swapLayoutSi', () => {
  it('swaps a cabinet against the back wall and keeps it against the wall', () => {
    // SI1.0 1.2 m cabinet, back at z = 0, facing +z into the shop.
    const result = swapLayoutSi(layout(item('c1', 'asset-2595882', 2, 0.225)), 'SI2.0', catalog)
    expect(result.swapped).toBe(1)
    expect(result.layout.items[0]).toMatchObject({
      id: 'c1',
      assetId: 'asset-34327615',
      rotation: 0,
      w: 1.2,
      d: 0.54,
      cx: 2,
      cz: 0.27,
    })
  })

  it('splits a 2.4 m cabinet into two 1.2 m ones along its length', () => {
    const result = swapLayoutSi(layout(item('c2', 'asset-36890994', 3, 0.27)), 'SI1.0', catalog)
    expect(result.swapped).toBe(1)
    expect(result.layout.items.map((i) => [i.id, i.assetId, i.cx, i.cz])).toEqual([
      ['c2-1', 'asset-2595882', 2.4, 0.225],
      ['c2-2', 'asset-2595882', 3.6, 0.225],
    ])
  })

  it('turns a replacement so it faces the same way as the prop it replaces', () => {
    // SI1.0 side cabinet faces +x (its front axis), against the left wall at x = 0.
    const result = swapLayoutSi(layout(item('s1', 'asset-34320268', 0.25, 3)), 'SI2.0', catalog)
    const swapped = result.layout.items[0]
    // SI2.0 cabinet's front is +z; a 270° turn points it to +x. Its back stays at x = 0.
    expect(swapped).toMatchObject({ assetId: 'asset-33660153', rotation: 270, w: 0.531, d: 1.8 })
    expect(swapped?.cx).toBeCloseTo(0.266, 3)
    expect(swapped?.cz).toBe(3)
  })

  it('keeps the long side of a prop without a front where it was', () => {
    // SI1.0 island table drawn 1.0 × 1.8 (long along z) → SI2.0 drawn 1.8 × 0.804.
    const result = swapLayoutSi(layout(item('t1', 'asset-408124', 4, 3)), 'SI2.0', catalog)
    expect(result.layout.items[0]).toMatchObject({ rotation: 90, w: 0.804, d: 1.8, cx: 4, cz: 3 })
  })

  it('keeps the turn when it fits as well as a quarter turn (unboxing table with stools)', () => {
    // SI1.0 1800 × 2199 (stools make it deeper than long) → SI2.0 1800 × 1630: the table stays along x.
    const result = swapLayoutSi(layout(item('u1', 'asset-1788391', 6, 4)), 'SI2.0', catalog)
    expect(result.layout.items[0]).toMatchObject({ rotation: 0, w: 1.8, d: 1.63, cx: 6, cz: 4 })
  })

  it('leaves props without a counterpart, other categories and placeholders as they are', () => {
    const stand = item('d1', 'asset-16510684', 1, 1)
    const box = item('p1', null, 2, 2)
    const result = swapLayoutSi(layout(stand, box), 'SI1.0', catalog)
    expect(result.swapped).toBe(0)
    expect(result.kept).toEqual(['试飞台'])
    expect(result.layout.items).toEqual([stand, box])
  })

  it('avoids ids already in the layout when a prop splits', () => {
    const result = swapLayoutSi(
      layout(item('c2', 'asset-36890994', 3, 0.27), item('c2-1', 'asset-16510684', 6, 6)),
      'SI1.0',
      catalog,
    )
    const ids = result.layout.items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('SI_SWAP', () => {
  it('maps each prop to props of the other style only', () => {
    for (const [target, table] of Object.entries(SI_SWAP)) {
      for (const [from, to] of Object.entries(table)) {
        expect(to?.includes(from) ?? false, `${target} ${from}`).toBe(false)
      }
    }
  })

  it('names the switched copy after the step it came from', () => {
    expect(siSwapName('方案 · 按面积推荐', 'SI2.0')).toBe('方案 · 按面积推荐 · SI2.0')
    expect(siSwapName('方案 · 按面积推荐 · SI2.0（2）', 'SI1.0')).toBe('方案 · 按面积推荐 · SI1.0')
  })
})

describe('the SI style of a step', () => {
  // asset-2595882 is listed for swapping to SI2.0 (an SI1.0 cabinet), asset-34327615 the other way.
  const si1 = item('a', 'asset-2595882', 1, 0.3)
  const si2 = item('b', 'asset-34327615', 3, 0.3)

  it('is the style most of its swappable props belong to', () => {
    expect(layoutSi(layout(si1))).toBe('SI1.0')
    expect(layoutSi(layout(si2, { ...si2, id: 'c' }, si1))).toBe('SI2.0')
    expect(layoutSi(layout(si1, si2))).toBeNull()
    expect(layoutSi(layout(item('p', null, 2, 2)))).toBeNull()
  })

  it('is the step’s own when saved with one, else its props’, else the project’s', () => {
    expect(nodeSiStyle({ siStyle: 'SI2.0', layout: layout(si1) }, 'SI1.0')).toBe('SI2.0')
    expect(nodeSiStyle({ siStyle: null, layout: layout(si2) }, 'SI1.0')).toBe('SI2.0')
    expect(nodeSiStyle({ siStyle: null, layout: layout() }, 'SI2.0')).toBe('SI2.0')
    expect(nodeSiStyle({ siStyle: null, layout: null }, 'SI1.0')).toBe('SI1.0')
  })

  it('tells an untouched copy of a layout from a changed one', () => {
    const swapped = swapLayoutSi(layout(si1), 'SI2.0', catalog).layout
    expect(sameLayoutProps(swapped, swapLayoutSi(layout(si1), 'SI2.0', catalog).layout)).toBe(true)
    const moved = { ...swapped, items: swapped.items.map((i) => ({ ...i, cx: i.cx + 0.1 })) }
    expect(sameLayoutProps(moved, swapped)).toBe(false)
    expect(sameLayoutProps(layout(si1), layout(si1, si2))).toBe(false)
  })
})
