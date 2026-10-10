import { useDeferredValue, useMemo, useState } from 'react'
import { ITEM_FUNCTIONS, mToMm } from '@store/shared'
import type { Asset, AssetCategory, SiStyle } from '@store/shared'

/** Picker groups in order; 环境设施 (fire boxes, spotlights) are not placed by hand. */
const GROUPS: { category: AssetCategory; title: (si: SiStyle) => string }[] = [
  { category: '软装道具', title: (si) => `软装道具 · ${si}` },
  { category: '信息化物料', title: () => '信息化物料' },
  { category: '品牌标识', title: () => '品牌标识' },
  { category: '非标陈列', title: () => '非标陈列' },
]

/**
 * The models a project may use: furniture of its own SI style, plus every 信息化物料, 品牌标识
 * and 非标陈列 model, which are not tied to a style.
 */
export function pickableGroups(assets: readonly Asset[], si: SiStyle) {
  const order = (a: Asset) => ITEM_FUNCTIONS.indexOf(a.function)
  return GROUPS.map(({ category, title }) => ({
    category,
    title: title(si),
    assets: assets
      .filter((a) => a.category === category && (category !== '软装道具' || a.siFamily === si))
      .sort(
        (a, b) =>
          order(a) - order(b) ||
          a.standardName.localeCompare(b.standardName, 'zh') ||
          a.id.localeCompare(b.id),
      ),
  })).filter((group) => group.assets.length > 0)
}

const size = (a: Asset) =>
  `${mToMm(a.footprint.w)} × ${mToMm(a.footprint.d)} × ${mToMm(a.footprint.h)} mm`

interface ModelPickerProps {
  assets: readonly Asset[]
  siStyle: SiStyle
  onPick: (asset: Asset) => void
}

/** "添加模型": product pictures grouped by category; picking places the model in the middle. */
export function ModelPicker({ assets, siStyle, onPick }: ModelPickerProps) {
  const [search, setSearch] = useState('')
  const [lastPicked, setLastPicked] = useState<string | null>(null)
  const query = useDeferredValue(search.trim())
  const groups = useMemo(() => {
    const all = pickableGroups(assets, siStyle)
    if (!query) return all
    return all
      .map((g) => ({ ...g, assets: g.assets.filter((a) => `${a.id} ${a.name}`.includes(query)) }))
      .filter((g) => g.assets.length > 0)
  }, [assets, siStyle, query])

  return (
    <section className="wb-card model-picker" aria-label="添加模型">
      <h3>添加模型</h3>
      <input
        type="search"
        aria-label="搜索模型"
        placeholder="按名称或编号搜索"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <p className="hint">点击放到空间中央；没有三维模型的以真实尺寸方框占位。</p>
      <div className="model-list">
        {groups.length === 0 && <p className="hint">没有符合条件的模型。</p>}
        {groups.map((group) => (
          <div key={group.category} className="model-group">
            <h4>
              {group.title}（{group.assets.length}）
            </h4>
            <ul>
              {group.assets.map((asset) => {
                const image = asset.productImage ?? asset.preview
                return (
                  <li key={asset.id}>
                    <button
                      type="button"
                      className="model-row"
                      aria-label={`添加 ${asset.name}`}
                      onClick={() => {
                        onPick(asset)
                        setLastPicked(asset.id)
                      }}
                    >
                      {image ? (
                        <img src={image.url} alt="" loading="lazy" />
                      ) : (
                        <span className="model-row-empty" />
                      )}
                      <span className="model-row-text">
                        <span className="model-row-name">{asset.standardName}</span>
                        <span className="hint">
                          {asset.variant} · {size(asset)}
                        </span>
                        <span className="model-card-tags">
                          {!asset.placeable && <span className="tag">占位</span>}
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
        ))}
      </div>
    </section>
  )
}
