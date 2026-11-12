import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Asset, AssetCategory } from '@store/shared'
import { makeAsset } from '../../test-utils/factories.ts'
import { ModelPicker, pickableSections } from './ModelPicker.tsx'

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
  return makeAsset({
    id,
    name: `${standardName} · 变体`,
    standardName,
    variant: '变体',
    category,
    function: 'other',
    footprint: { w: 1.8, d: 1, h: 0.9 },
    front: 'any',
    facingConfidence: null,
    preview: file(`${id}-preview`),
    ...overrides,
  })
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
    function: 'screen',
    placeable: false,
    footprint: { w: 1.69, d: 0.05, h: 0.958 },
  }),
  asset('asset-5', '墙面LOGO', '品牌标识', {
    siFamily: '通用',
    function: 'signage',
    placeable: false,
  }),
  asset('asset-6', '休闲沙发', '非标陈列', { siFamily: '非标', function: 'seating' }),
  asset('asset-7', '消防栓箱', '环境设施', { siFamily: '通用', placeable: false }),
  asset('asset-8', '灯箱墙贴', '信息化物料', { siFamily: '通用', function: 'signage' }),
]

afterEach(cleanup)

describe('pickableSections', () => {
  it('按精确编号隐藏LED和审核停用款，保留在用水牌及其他名称含LED的物料', () => {
    const reviewed = [
      ...['asset-11525629', 'asset-11511980', 'asset-2463847'].map((id) =>
        asset(id, 'LED屏', '信息化物料', { retired: false }),
      ),
      asset('asset-958185', '电子水牌', '信息化物料'),
      asset('asset-2587726', '电子水牌', '信息化物料'),
      asset('asset-990001', 'LED摄影补光展示道具', '非标陈列'),
    ]
    const ids = pickableSections(reviewed, 'SI1.0').flatMap((s) => s.assets.map((a) => a.id))
    expect(ids).toEqual(['asset-2587726', 'asset-990001'])
    expect(reviewed).toHaveLength(6)
    expect(reviewed[0]?.retired).toBe(false)
  })

  it('offers furniture of the project SI and every style-free category, never 环境设施', () => {
    const si1 = pickableSections(catalog, 'SI1.0')
    expect(si1.map((s) => [s.label, s.assets.map((a) => a.id)])).toEqual([
      ['中岛桌', ['asset-2']],
      ['配件柜', ['asset-1']],
      ['屏幕', ['asset-4']],
      ['灯箱', ['asset-8']],
      ['标识', ['asset-5']],
      ['坐凳', ['asset-6']],
    ])
    const si2 = pickableSections(catalog, 'SI2.0')
    expect(si2.find((s) => s.label === '中岛桌')?.assets.map((a) => a.id)).toEqual(['asset-3'])
  })
})

describe('ModelPicker', () => {
  it('shows pictures and labels, searches, and keeps picking', () => {
    const onPick = vi.fn()
    render(<ModelPicker assets={catalog} siStyle="SI2.0" onPick={onPick} />)

    const panel = screen.getByRole('region', { name: '添加模型' })
    expect(within(panel).queryByText('1.8米配件柜')).toBeNull()
    expect(within(panel).queryByText('消防栓箱')).toBeNull()
    const leggy = screen.getByRole('button', { name: '添加 1.8米亮脚中岛桌 · 变体' })
    expect(within(leggy).getByText('同类参考图')).toBeTruthy()
    expect(within(leggy).getByRole('presentation').getAttribute('src')).toBe(
      '/api/v1/files/island?w=160',
    )
    const screenCard = screen.getByRole('button', { name: '添加 广告机 · 变体' })
    expect(within(screenCard).getByText('占位')).toBeTruthy()
    expect(within(screenCard).getByText(/1690 × 50 × 958 mm/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'LOGO' } })
    expect(screen.queryByRole('button', { name: '添加 广告机 · 变体' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '添加 墙面LOGO · 变体' }))
    expect(onPick).toHaveBeenCalledWith(catalog[4])
    expect(screen.getByText('已添加')).toBeTruthy()
  })

  it('uses the names from 模型选用表, hides retired models and tells twins apart', () => {
    const named = [
      asset('asset-11', '产品展示台', '非标陈列', { name: '0.6米产品展示台', variant: 'X5' }),
      asset('asset-12', '产品展示台', '非标陈列', { name: '0.6米产品展示台', variant: '空台' }),
      asset('asset-13', '广告机', '非标陈列', { name: '75寸横屏广告机', retired: true }),
    ]
    render(<ModelPicker assets={named} siStyle="SI1.0" onPick={vi.fn()} />)

    const twins = screen.getAllByRole('button', { name: '添加 0.6米产品展示台' })
    expect(twins.map((b) => within(b).getByText(/mm/).textContent)).toEqual([
      'X5 · 1800 × 1000 × 900 mm',
      '空台 · 1800 × 1000 × 900 mm',
    ])
    expect(screen.queryByText('75寸横屏广告机')).toBeNull()
    expect(pickableSections(named, 'SI1.0')[0]?.assets.map((a) => a.id)).toEqual([
      'asset-11',
      'asset-12',
    ])
  })

  it('splits signage into 灯箱 and 标识 and jumps to a section', () => {
    render(<ModelPicker assets={catalog} siStyle="SI1.0" onPick={vi.fn()} />)
    // Both the jump cell and the section title carry the label.
    expect(screen.getAllByText('灯箱').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('标识').length).toBeGreaterThanOrEqual(2)
    const lightbox = screen.getByRole('button', { name: '灯箱' })
    expect(lightbox).toBeTruthy()
    fireEvent.click(lightbox)
    expect(lightbox.getAttribute('aria-current')).toBe('true')
  })
})
