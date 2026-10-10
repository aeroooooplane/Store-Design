import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Asset, AssetCategory } from '@store/shared'
import { ModelPicker, pickableGroups } from './ModelPicker.tsx'

const file = (name: string) => ({
  fileId: '00000000-0000-4000-8000-000000000001',
  url: `/api/v1/files/${name}`,
  bytes: 1,
  sha256: 'a'.repeat(64),
})

function asset(
  id: string,
  standardName: string,
  category: AssetCategory,
  overrides: Partial<Asset> = {},
): Asset {
  return {
    id,
    name: `${standardName} · 变体`,
    standardName,
    variant: '变体',
    materialCategory: '软装物料',
    siFamily: 'SI1.0',
    category,
    function: 'other',
    installation: 'floor',
    footprint: { w: 1.8, d: 1, h: 0.9 },
    footprintSource: 'glb',
    front: 'any',
    staffSide: null,
    facingConfidence: null,
    placeable: true,
    judgment: null,
    glb: null,
    whiteGlb: null,
    preview: file(`${id}-preview`),
    productImage: null,
    productImageMatch: null,
    planSymbol: null,
    ...overrides,
  }
}

const catalog = [
  asset('asset-1', '1.8米配件柜', '软装道具', { function: 'accessory_cabinet' }),
  asset('asset-2', '1.8米中岛桌', '软装道具', {
    function: 'island_table',
    productImage: file('island'),
    productImageMatch: 'exact',
  }),
  asset('asset-3', '1.8米亮脚中岛桌', '软装道具', {
    siFamily: 'SI2.0',
    function: 'island_table',
    productImage: file('island'),
    productImageMatch: 'approximate',
  }),
  asset('asset-4', '广告机', '信息化物料', {
    siFamily: '通用',
    placeable: false,
    footprint: { w: 1.69, d: 0.05, h: 0.958 },
  }),
  asset('asset-5', '墙面LOGO', '品牌标识', { siFamily: '通用', placeable: false }),
  asset('asset-6', '休闲沙发', '非标陈列', { siFamily: '非标' }),
  asset('asset-7', '消防栓箱', '环境设施', { siFamily: '通用', placeable: false }),
]

afterEach(cleanup)

describe('pickableGroups', () => {
  it('offers furniture of the project SI and every style-free category, never 环境设施', () => {
    const si1 = pickableGroups(catalog, 'SI1.0')
    expect(si1.map((g) => [g.title, g.assets.map((a) => a.id)])).toEqual([
      ['软装道具 · SI1.0', ['asset-2', 'asset-1']],
      ['信息化物料', ['asset-4']],
      ['品牌标识', ['asset-5']],
      ['非标陈列', ['asset-6']],
    ])
    const si2 = pickableGroups(catalog, 'SI2.0')
    expect(si2[0]).toMatchObject({ title: '软装道具 · SI2.0' })
    expect(si2[0]?.assets.map((a) => a.id)).toEqual(['asset-3'])
  })
})

describe('ModelPicker', () => {
  it('shows pictures and labels, searches, and keeps picking until closed', () => {
    const onPick = vi.fn()
    render(<ModelPicker assets={catalog} siStyle="SI2.0" onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: '添加模型' }))

    const panel = screen.getByRole('region', { name: '选择模型' })
    expect(within(panel).queryByText('1.8米配件柜')).toBeNull()
    expect(within(panel).queryByText('消防栓箱')).toBeNull()
    const leggy = screen.getByRole('button', { name: '添加 1.8米亮脚中岛桌 · 变体' })
    expect(within(leggy).getByText('同类参考图')).toBeTruthy()
    expect(within(leggy).getByRole('presentation').getAttribute('src')).toBe('/api/v1/files/island')
    const screenCard = screen.getByRole('button', { name: '添加 广告机 · 变体' })
    expect(within(screenCard).getByText('无三维模型 · 占位')).toBeTruthy()
    expect(within(screenCard).getByText('1690 × 50 × 958 mm')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'LOGO' } })
    expect(screen.queryByRole('button', { name: '添加 广告机 · 变体' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '添加 墙面LOGO · 变体' }))
    expect(onPick).toHaveBeenCalledWith(catalog[4])
    expect(screen.getByText('已添加')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(screen.queryByRole('region', { name: '选择模型' })).toBeNull()
  })
})
