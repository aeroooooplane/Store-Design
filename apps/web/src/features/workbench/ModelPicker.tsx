import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { canSelectCatalogAsset, ITEM_FUNCTIONS, mToMm } from '@store/shared'
import type { Asset, ItemFunction, SiStyle } from '@store/shared'
import { ItemFunctionIcon } from '../../components/StoreIcons.tsx'

/**
 * The picker lists one section per prop category (2026-11-12, 用户确认), in this order.
 * Function 'signage' is shown as two categories: 灯箱 (name says so) and 标识 (LOGO plates etc.).
 * 环境设施 (fire boxes, spotlights) are not placed by hand.
 */
const SECTIONS: {
  key: string
  fn: ItemFunction
  label: string
  match: (a: Asset) => boolean
}[] = (
  [
    ['island_table', '中岛桌'],
    ['unboxing_table', '开箱桌'],
    ['cashier', '收银'],
    ['accessory_cabinet', '配件柜'],
    ['side_cabinet', '配件边柜'],
    ['display_stand', '展示台'],
    ['screen', '屏幕'],
    ['seating', '坐凳'],
    ['storage', '储物柜'],
    ['other', '其他'],
  ] as [ItemFunction, string][]
).map(([fn, label]) => ({ key: fn, fn, label, match: (a: Asset) => a.function === fn }))
SECTIONS.splice(7, 0, {
  key: 'lightbox',
  fn: 'signage',
  label: '灯箱',
  match: (a) => a.function === 'signage' && a.name.includes('灯箱'),
})
SECTIONS.splice(8, 0, {
  key: 'signage',
  fn: 'signage',
  label: '标识',
  match: (a) => a.function === 'signage' && !a.name.includes('灯箱'),
})

export interface PickableSection {
  /** Unique per section (灯箱 and 标识 share the model function 'signage'). */
  key: string
  fn: ItemFunction
  label: string
  assets: Asset[]
}

/** 环境设施 (fire boxes, spotlights) are part of the store, not props placed by hand. */
const PLACEABLE_CATEGORIES = new Set(['软装道具', '信息化物料', '品牌标识', '非标陈列'])

/**
 * The models a project may use: furniture of its own SI style, plus every model that is not tied
 * to a style. Retired models (模型选用表 删除) are left out. One section per category, in UI order.
 */
export function pickableSections(assets: readonly Asset[], si: SiStyle): PickableSection[] {
  const order = (a: Asset) => ITEM_FUNCTIONS.indexOf(a.function)
  return SECTIONS.map(({ key, fn, label, match }) => ({
    key,
    fn,
    label,
    assets: assets
      .filter(
        (a) =>
          canSelectCatalogAsset(a) &&
          PLACEABLE_CATEGORIES.has(a.category) &&
          match(a) &&
          (a.category !== '软装道具' || a.siFamily === si),
      )
      .sort(
        (a, b) =>
          order(a) - order(b) || a.name.localeCompare(b.name, 'zh') || a.id.localeCompare(b.id),
      ),
  })).filter((section) => section.assets.length > 0)
}

/** Models that share a name in one section are told apart by their manual variant. */
function sharedNames(assets: readonly Asset[]): Set<string> {
  const seen = new Set<string>()
  const shared = new Set<string>()
  for (const a of assets) (seen.has(a.name) ? shared : seen).add(a.name)
  return shared
}

const size = (a: Asset) =>
  `${mToMm(a.footprint.w)} × ${mToMm(a.footprint.d)} × ${mToMm(a.footprint.h)} mm`

/** The card shows its picture at 56 × 42 CSS px; the API serves a 160 px WebP instead of the original. */
const thumbnailUrl = (url: string) => `${url}${url.includes('?') ? '&' : '?'}w=160`

interface ModelPickerProps {
  assets: readonly Asset[]
  siStyle: SiStyle
  onPick: (asset: Asset) => void
}

/** "添加模型": product pictures in one section per category, with jump icons on top. */
export function ModelPicker({ assets, siStyle, onPick }: ModelPickerProps) {
  const [search, setSearch] = useState('')
  const [lastPicked, setLastPicked] = useState<string | null>(null)
  const query = useDeferredValue(search.trim())
  const sections = useMemo(() => {
    const all = pickableSections(assets, siStyle)
    if (!query) return all
    return all
      .map((s) => ({
        ...s,
        assets: s.assets.filter((a) =>
          `${a.id} ${a.name} ${a.standardName} ${a.variant}`.includes(query),
        ),
      }))
      .filter((s) => s.assets.length > 0)
  }, [assets, siStyle, query])
  const listRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<string | null>(null)
  const current =
    active && sections.some((s) => s.key === active) ? active : (sections[0]?.key ?? null)

  // While the list scrolls, the jump icon of the section at the top lights up.
  useEffect(() => {
    const root = listRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const heads = [...root.querySelectorAll('[data-section]')]
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => (a.target as HTMLElement).offsetTop - (b.target as HTMLElement).offsetTop,
          )[0]
        if (top) setActive(((top.target as HTMLElement).dataset.section as string) ?? null)
      },
      { root, rootMargin: '-30px 0px -60% 0px', threshold: 0 },
    )
    for (const head of heads) observer.observe(head)
    return () => observer.disconnect()
  }, [sections])

  function jump(key: string) {
    listRef.current
      ?.querySelector(`[data-section="${key}"]`)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    setActive(key)
  }

  return (
    <section className="wb-card model-picker" aria-label="添加模型">
      <input
        type="search"
        aria-label="搜索模型"
        placeholder="搜索模型名称或编号"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="model-jump" role="toolbar" aria-label="按类别跳到">
        {SECTIONS.map(({ key, fn, label }) => {
          const section = sections.find((s) => s.key === key)
          const count = section?.assets.length ?? 0
          return (
            <button
              key={key}
              type="button"
              className="model-jump-cell"
              aria-current={current === key}
              disabled={!count}
              title={count ? `${label}（${count}）` : `${label}（当前没有）`}
              onClick={() => jump(key)}
            >
              <ItemFunctionIcon fn={fn} name={label === '灯箱' ? '灯箱' : undefined} size={18} />
              <span>{label}</span>
            </button>
          )
        })}
      </div>
      <div className="model-list" ref={listRef}>
        {sections.length === 0 && <p className="hint">没有符合条件的模型。</p>}
        {sections.map((section) => {
          const shared = sharedNames(section.assets)
          return (
            <div key={section.key} className="model-section">
              <h5 data-section={section.key}>
                <ItemFunctionIcon
                  fn={section.fn}
                  name={section.label === '灯箱' ? '灯箱' : undefined}
                  size={15}
                />
                {section.label}
                <em>{section.assets.length}</em>
              </h5>
              <ul>
                {section.assets.map((asset) => {
                  const image = asset.productImage ?? asset.preview
                  return (
                    <li key={asset.id}>
                      <button
                        type="button"
                        className="model-row"
                        aria-label={`添加 ${asset.name}`}
                        title="点击放到空间中央"
                        onClick={() => {
                          onPick(asset)
                          setLastPicked(asset.id)
                        }}
                      >
                        {image ? (
                          <img src={thumbnailUrl(image.url)} alt="" loading="lazy" />
                        ) : (
                          <span className="model-row-empty" />
                        )}
                        <span className="model-row-text">
                          <span className="model-row-name">{asset.name}</span>
                          <span className="hint">
                            {shared.has(asset.name) ? `${asset.variant} · ` : ''}
                            {size(asset)}
                          </span>
                          <span className="model-card-tags">
                            {!asset.placeable && (
                              <span className="tag" title="没有三维模型，按真实尺寸方框占位">
                                占位
                              </span>
                            )}
                            {asset.productImageMatch === 'approximate' && (
                              <span className="tag">同类参考图</span>
                            )}
                            {lastPicked === asset.id && <span className="tag done">已添加</span>}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}
