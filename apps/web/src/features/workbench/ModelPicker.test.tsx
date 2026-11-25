import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Asset, AssetCategory, Market, SiStyle } from '@store/shared'
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
  asset('asset-20533337', '墙面LOGO', '品牌标识', {
    siFamily: '通用',
    function: 'signage',
    placeable: false,
  }),
  asset('asset-6', '休闲沙发', '非标陈列', { siFamily: '非标', function: 'seating' }),
  asset('asset-7', '消防栓箱', '环境设施', { siFamily: '通用', placeable: false }),
  asset('asset-8', '灯箱墙贴', '信息化物料', { siFamily: '通用', function: 'signage' }),
]

it('allows the current Leica wall combinations under SI1.0 signage', () => {
  const leica = asset('asset-90000111', '徕卡墙画框组合 1200（含联名LOGO）', '软装道具', {
    function: 'signage',
    siFamily: 'SI2.0',
  })
  const ordinary = asset('asset-other', '普通墙面标识', '软装道具', {
    function: 'signage',
    siFamily: 'SI2.0',
  })
  expect(
    pickableSections([leica, ordinary], 'SI1.0').find((section) => section.key === 'signage')
      ?.assets,
  ).toEqual([{ ...leica, name: '徕卡墙组合 1200' }])
})

it('shows one advertising machine per size with no separate portrait entry', () => {
  const screens = [
    asset('asset-11479197', '75寸横屏广告机', '信息化物料', { function: 'screen' }),
    asset('asset-2595839', '75寸竖屏广告机', '信息化物料', { function: 'screen' }),
    asset('asset-2597250', '55寸竖屏广告机', '信息化物料', { function: 'screen' }),
    asset('asset-3021147', '65寸横屏广告机', '信息化物料', { function: 'screen' }),
  ]
  expect(
    pickableSections(screens, 'SI1.0').flatMap((section) =>
      section.assets.map((item) => item.name),
    ),
  ).toEqual(['65寸广告机', '75寸广告机'])
})

afterEach(cleanup)

describe('pickableSections', () => {
  it.each([
    ['SI1.0', 'domestic'],
    ['SI1.0', 'overseas'],
    ['SI2.0', 'domestic'],
    ['SI2.0', 'overseas'],
  ] as [SiStyle, Market][])('在 %s / %s 仅提供审核的六款标识', (si, market) => {
    const selected = [
      ['asset-90000111', '徕卡墙组合 1200', '徕卡墙组合 1200'],
      ['asset-90000112', '徕卡墙组合 1990', '徕卡墙组合 1990'],
      ['asset-90000113', '徕卡墙组合 3000', '徕卡墙组合 3000'],
      ['asset-20533337', '影石 Insta360', 'Insta360'],
      ['asset-33868330', '影石 Insta360 始于敢想', 'Insta360 Think Bold'],
      ['asset-11483499', '影翎 ANTIGRAVITY', 'ANTIGRAVITY'],
    ] as const
    const source = [
      ...selected.map(([id]) =>
        asset(id, id.startsWith('asset-900001') ? '徕卡墙画面组合' : '墙面LOGO', '软装道具', {
          siFamily: 'SI2.0',
          category: id.startsWith('asset-900001') ? '软装道具' : '品牌标识',
          function: 'signage',
        }),
      ),
      ...['asset-90000101', 'asset-36929204', 'asset-33917980', 'asset-40910342'].map((id) =>
        asset(id, '徕卡墙或旧标识', '品牌标识', { function: 'signage' }),
      ),
    ]
    const before = structuredClone(source)
    const signs = pickableSections(source, si, market).find((s) => s.key === 'signage')?.assets
    expect(signs?.map(({ id, name }) => [id, name])).toEqual(
      selected.map(([id, domestic, overseas]) => [id, market === 'domestic' ? domestic : overseas]),
    )
    expect(source).toEqual(before)
  })

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
      ['坐凳', ['asset-6']],
      ['屏幕', ['asset-4']],
      ['灯箱', ['asset-8']],
      ['标识', ['asset-20533337']],
    ])
    const si2 = pickableSections(catalog, 'SI2.0')
    expect(si2.find((s) => s.label === '中岛桌')?.assets.map((a) => a.id)).toEqual(['asset-3'])
  })
})

describe('ModelPicker', () => {
  it('切换市场时同时更新名称与实际模型缩略图，添加时保留原市场模型引用', () => {
    const logo = asset('asset-33868330', '墙面LOGO', '品牌标识', {
      function: 'signage',
      market: 'domestic',
      glb: file('domestic-model'),
      otherMarketGlb: file('overseas-model'),
    })
    const onPick = vi.fn()
    const { rerender } = render(
      <ModelPicker assets={[logo]} siStyle="SI1.0" market="domestic" onPick={onPick} />,
    )
    const domestic = screen.getByRole('button', { name: '添加 影石 Insta360 始于敢想' })
    expect(within(domestic).getByRole('presentation').getAttribute('src')).toContain(
      'asset-33868330-domestic.webp',
    )
    rerender(<ModelPicker assets={[logo]} siStyle="SI1.0" market="overseas" onPick={onPick} />)
    expect(screen.queryByRole('button', { name: '添加 影石 Insta360 始于敢想' })).toBeNull()
    const overseas = screen.getByRole('button', { name: '添加 Insta360 Think Bold' })
    expect(within(overseas).getByRole('presentation').getAttribute('src')).toContain(
      'asset-33868330-overseas.webp',
    )
    fireEvent.click(overseas)
    expect(onPick).toHaveBeenCalledWith({ ...logo, name: 'Insta360 Think Bold' })
  })

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

    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'Insta360' } })
    expect(screen.queryByRole('button', { name: '添加 广告机 · 变体' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '添加 影石 Insta360' }))
    expect(onPick).toHaveBeenCalledWith({ ...catalog[4], name: '影石 Insta360' })
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

  it('lists the categories in the order the user chose, icons and sections alike', () => {
    const storage = asset('asset-9', '1.8米边桌储物柜', '软装道具', {
      siFamily: 'SI1.0',
      function: 'storage',
    })
    render(<ModelPicker assets={[...catalog, storage]} siStyle="SI1.0" onPick={vi.fn()} />)
    const order = [
      '中岛桌',
      '开箱桌',
      '收银',
      '配件柜',
      '配件边柜',
      '储物边柜',
      '展示台',
      '坐凳',
      '屏幕',
      '灯箱',
      '标识',
      '其他',
    ]
    const jump = screen.getByRole('toolbar', { name: '按类别跳到' })
    expect(
      within(jump)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(order)
    // The sections that have models appear in that same order (储物边柜 sits before 坐凳).
    const headings = [...document.querySelectorAll('.model-section h5')].map((h) =>
      h.textContent?.replace(/\d+$/, ''),
    )
    expect(headings).toEqual(order.filter((label) => headings.includes(label)))
    expect(headings.indexOf('储物边柜')).toBeLessThan(headings.indexOf('坐凳'))
  })

  it('keeps the clicked icon lit while the list scrolls, even where it cannot reach the top', () => {
    vi.useFakeTimers()
    try {
      render(<ModelPicker assets={catalog} siStyle="SI1.0" onPick={vi.fn()} />)
      const list = document.querySelector<HTMLElement>('.model-list') as HTMLElement
      const lit = () => document.querySelector('.model-jump-cell[aria-current="true"]')?.textContent
      // jsdom has no layout: fake a list that is scrolled to its very end.
      Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 })
      Object.defineProperty(list, 'clientHeight', { configurable: true, value: 400 })
      const scrollTo = vi.fn()
      list.scrollTo = scrollTo

      // The list ends in the last section (标识), so scrolling alone lights it up ...
      list.scrollTop = 600
      fireEvent.scroll(list)
      expect(lit()).toBe('标识')
      // ... but clicking an icon wins over the scroll events its own scrolling causes.
      fireEvent.click(screen.getByRole('button', { name: '中岛桌' }))
      expect(scrollTo).toHaveBeenCalled()
      list.scrollTop = 580
      fireEvent.scroll(list)
      expect(lit()).toBe('中岛桌')
      // Once the list stops, the highlight follows the list again; a wheel takes over at once.
      act(() => {
        vi.advanceTimersByTime(500)
      })
      list.scrollTop = 600
      fireEvent.scroll(list)
      expect(lit()).toBe('标识')
      fireEvent.click(screen.getByRole('button', { name: '中岛桌' }))
      fireEvent.wheel(list)
      list.scrollTop = 600
      fireEvent.scroll(list)
      expect(lit()).toBe('标识')
    } finally {
      vi.useRealTimers()
    }
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
