import { describe, expect, it } from 'vitest'
import type { LayoutItem } from '../schemas/layout.ts'
import { deliveryFileNames, deliveryFolderName, deliveryLegend, storeTitle } from './index.ts'

const item = (id: string, overrides: Partial<LayoutItem>): LayoutItem => ({
  id,
  assetId: null,
  function: 'other',
  name: '道具',
  cx: 1,
  cz: 1,
  rotation: 0,
  w: 1,
  d: 1,
  h: 1,
  placeholder: false,
  locked: false,
  ...overrides,
})

describe('storeTitle', () => {
  it('adds 影石 and 店 once', () => {
    expect(storeTitle('西安赛高世纪金花照材店')).toBe('影石西安赛高世纪金花照材店')
    expect(storeTitle('影石西安店')).toBe('影石西安店')
    expect(storeTitle(' 南昌  武商 ')).toBe('影石南昌 武商店')
    expect(storeTitle('')).toBe('影石概念专区店')
  })

  it('names the folder and both PDFs', () => {
    expect(deliveryFolderName('西安店', 'side_hall', 48, '2026-10-10')).toBe(
      '影石西安店_边厅店_48.0㎡_2026-10-10',
    )
    expect(deliveryFolderName('西安店', 'island', 30.25, '2026-10-10', 2)).toBe(
      '影石西安店_中岛店_30.3㎡_2026-10-10_修订02',
    )
    expect(deliveryFileNames('A/B 店')).toEqual({
      full: '00-影石A_B 店完整方案.pdf',
      show: '影石A_B 店方案.pdf',
    })
  })
})

describe('deliveryLegend', () => {
  const assets = new Map([
    ['asset-1', { name: '1.8米普通中岛桌', footprint: { w: 1, d: 1.8, h: 0.9 } }],
    ['asset-2', { name: '1.8米收银台', footprint: { w: 1.786, d: 0.602, h: 1.205 } }],
  ])

  it('numbers each model once, islands first, and counts its uses', () => {
    const legend = deliveryLegend(
      [
        item('cash', { assetId: 'asset-2', function: 'cashier', name: '收银台' }),
        item('isl-1', { assetId: 'asset-1', function: 'island_table', w: 1.8, d: 1 }),
        item('isl-2', { assetId: 'asset-1', function: 'island_table', rotation: 90 }),
        item('box', {
          function: 'other',
          name: '待定道具',
          w: 0.6,
          d: 1.2,
          h: 0.8,
          placeholder: true,
        }),
      ],
      assets,
    )
    expect(legend.entries.map((e) => [e.no, e.name, e.count])).toEqual([
      [1, '1.8米普通中岛桌', 2],
      [2, '1.8米收银台', 1],
      [3, '待定道具', 1],
    ])
    expect(legend.numbers).toEqual({ 'isl-1': 1, 'isl-2': 1, cash: 2, box: 3 })
    // Model size as built; a box without a model is listed long side first.
    expect(legend.entries[0]?.size).toEqual({ w: 1, d: 1.8, h: 0.9 })
    expect(legend.entries[2]).toMatchObject({ assetId: null, placeholder: true })
    expect(legend.entries[2]?.size).toEqual({ w: 1.2, d: 0.6, h: 0.8 })
  })
})
