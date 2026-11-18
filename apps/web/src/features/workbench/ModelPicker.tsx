import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  advertisingScreenName,
  canSelectCatalogAsset,
  LEGACY_PORTRAIT_SCREENS,
  mToMm,
} from '@store/shared'
import type { Asset, ItemFunction, SiStyle } from '@store/shared'
import { ItemFunctionIcon } from '../../components/StoreIcons.tsx'

/**
 * The picker lists one section per prop category, in this order (用户 2026-11-18). The jump
 * icons above the list follow the same order. Function 'signage' is shown as two categories:
 * 灯箱 (the name says so) and 标识 (LOGO plates etc.); function 'storage' is shown as 储物边柜.
 * 环境设施 (fire boxes, spotlights) are not placed by hand.
 */
const section = (
  key: string,
  fn: ItemFunction,
  label: string,
  match: (a: Asset) => boolean = (a) => a.function === fn,
) => ({ key, fn, label, match })
const SECTIONS: {
  key: string
  fn: ItemFunction
  label: string
  match: (a: Asset) => boolean
}[] = [
  section('island_table', 'island_table', '中岛桌'),
  section('unboxing_table', 'unboxing_table', '开箱桌'),
  section('cashier', 'cashier', '收银'),
  section('accessory_cabinet', 'accessory_cabinet', '配件柜'),
  section('side_cabinet', 'side_cabinet', '配件边柜'),
  section('storage', 'storage', '储物边柜'),
  section('display_stand', 'display_stand', '展示台'),
  section('seating', 'seating', '坐凳'),
  section('screen', 'screen', '屏幕'),
  section(
    'lightbox',
    'signage',
    '灯箱',
    (a) => a.function === 'signage' && a.name.includes('灯箱'),
  ),
  section(
    'signage',
    'signage',
    '标识',
    (a) => a.function === 'signage' && !a.name.includes('灯箱'),
  ),
  section('other', 'other', '其他'),
]

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
  return SECTIONS.map(({ key, fn, label, match }) => ({
    key,
    fn,
    label,
    assets: assets
      .filter(
        (a) =>
          canSelectCatalogAsset(a) &&
          !LEGACY_PORTRAIT_SCREENS.has(a.id) &&
          PLACEABLE_CATEGORIES.has(a.category) &&
          match(a) &&
          (a.category !== '软装道具' ||
            a.siFamily === si ||
            (a.function === 'signage' && a.standardName.startsWith('徕卡墙'))),
      )
      .map((asset) => {
        const name = advertisingScreenName(asset.id)
        return name ? { ...asset, name } : asset
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh') || a.id.localeCompare(b.id)),
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
  // While a click is scrolling the list to its section, the scroll does not change the highlight:
  // the clicked icon stays lit even if the list stops short (first and last sections cannot reach
  // the top line). It lets go when the list stops moving or the user scrolls by hand.
  const target = useRef<{ key: string; timer: number } | null>(null)

  /** The section the list shows: the last one whose title has reached the top; at either end of the list, the first / last. */
  function sectionAtTop(root: HTMLDivElement): string | null {
    const heads = [...root.querySelectorAll<HTMLElement>('[data-section]')]
    if (heads.length === 0) return null
    if (root.scrollTop <= 1) return heads[0]?.dataset.section ?? null
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 1) {
      return heads[heads.length - 1]?.dataset.section ?? null
    }
    const line = root.getBoundingClientRect().top + 8
    let found = heads[0]
    for (const head of heads) {
      if (head.getBoundingClientRect().top <= line) found = head
      else break
    }
    return found?.dataset.section ?? null
  }

  // Scrolling the list lights the icon of the section at the top, unless a click is in charge.
  useEffect(() => {
    const root = listRef.current
    if (!root) return
    function onScroll() {
      if (!root) return
      const held = target.current
      if (held) {
        // Still scrolling towards the clicked section: keep the click's icon, release once the
        // list has been still for a moment.
        window.clearTimeout(held.timer)
        held.timer = window.setTimeout(() => {
          target.current = null
        }, 150)
        return
      }
      const key = sectionAtTop(root)
      if (key) setActive(key)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    // A wheel or touch by the user always takes over from a click.
    const release = () => {
      if (target.current) window.clearTimeout(target.current.timer)
      target.current = null
    }
    root.addEventListener('wheel', release, { passive: true })
    root.addEventListener('touchstart', release, { passive: true })
    return () => {
      root.removeEventListener('scroll', onScroll)
      root.removeEventListener('wheel', release)
      root.removeEventListener('touchstart', release)
      if (target.current) window.clearTimeout(target.current.timer)
      target.current = null
    }
  }, [sections])

  function jump(key: string) {
    const root = listRef.current
    if (target.current) window.clearTimeout(target.current.timer)
    setActive(key)
    // The section's own box tells where it starts: its title is sticky, so scrolling the title
    // into view would stop at the place where the sticky title happens to be pinned, not at the top
    // of the section (a section already scrolled past would land on its last rows).
    const section = root?.querySelector(`[data-section="${key}"]`)?.parentElement
    if (!root || !section) return
    const top =
      root.scrollTop + section.getBoundingClientRect().top - root.getBoundingClientRect().top
    // If the list is already there (e.g. the first section at the very top) no scroll event
    // follows, so the lock also lets go on its own after a short time.
    target.current = {
      key,
      timer: window.setTimeout(() => {
        target.current = null
      }, 400),
    }
    root.scrollTo?.({ top, behavior: 'smooth' })
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
                  const imageUrl = image && thumbnailUrl(image.url)
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
                        {imageUrl ? (
                          <img src={imageUrl} alt="" loading="lazy" />
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
