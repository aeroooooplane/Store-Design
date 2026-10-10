import { ITEM_FUNCTIONS, SHOP_TYPE_LABELS } from '../enums.ts'
import type { ShopType } from '../enums.ts'
import type { Asset } from '../schemas/asset.ts'
import type { LayoutItem } from '../schemas/layout.ts'

/**
 * The shop as it is named on deliveries: "影石" + project name + "店", without doubling either
 * (双PDF交付规则：不保留占位符、不重复追加“影石”或“店”).
 */
export function storeTitle(projectName: string): string {
  const core = projectName.trim().replace(/\s+/g, ' ') || '概念专区'
  const branded = core.startsWith('影石') ? core : `影石${core}`
  return branded.endsWith('店') ? branded : `${branded}店`
}

/** Characters Windows and macOS refuse in file and folder names. */
export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').trim()

/** `门店名称_门店类型_面积_YYYY-MM-DD`; a later delivery of the same day adds `_修订02`, … */
export function deliveryFolderName(
  projectName: string,
  shopType: ShopType,
  areaM2: number,
  date: string,
  revision = 1,
): string {
  const base = `${storeTitle(projectName)}_${SHOP_TYPE_LABELS[shopType]}_${areaM2.toFixed(1)}㎡_${date}`
  return safeFileName(revision > 1 ? `${base}_修订${String(revision).padStart(2, '0')}` : base)
}

/** The two PDFs of one delivery (双PDF交付规则). */
export function deliveryFileNames(projectName: string) {
  const title = safeFileName(storeTitle(projectName))
  return { full: `00-${title}完整方案.pdf`, show: `${title}方案.pdf` }
}

export interface LegendEntry {
  no: number
  /** Catalogue model, or null for a box placed without one. */
  assetId: string | null
  name: string
  /** Model size in metres (as built, not as rotated in the plan). */
  size: { w: number; d: number; h: number }
  count: number
  placeholder: boolean
}

export interface DeliveryLegend {
  entries: LegendEntry[]
  /** Legend number of every layout item. */
  numbers: Record<string, number>
}

const mm = (m: number) => Math.round(m * 1000)

/**
 * Numbered legend of a layout, as on the manuals' plans (yellow badges 01, 02, … with a list):
 * one number per model, ordered by use (islands, cashiers, cabinets, …) and name. The browser
 * draws the badges and the server lists the legend with this same function, so they agree.
 */
export function deliveryLegend(
  items: readonly LayoutItem[],
  assets: ReadonlyMap<string, Pick<Asset, 'name' | 'footprint'>>,
): DeliveryLegend {
  const groups = new Map<string, { entry: Omit<LegendEntry, 'no'>; fn: number; ids: string[] }>()
  for (const item of items) {
    const asset = item.assetId ? assets.get(item.assetId) : undefined
    const key = asset
      ? `asset:${item.assetId}:${item.placeholder ? 'box' : 'model'}`
      : `box:${item.name}:${mm(item.w)}x${mm(item.d)}x${mm(item.h)}`
    let group = groups.get(key)
    if (!group) {
      group = {
        entry: {
          assetId: asset ? (item.assetId ?? null) : null,
          name: (asset?.name ?? item.name).trim(),
          size: asset
            ? { ...asset.footprint }
            : { w: Math.max(item.w, item.d), d: Math.min(item.w, item.d), h: item.h },
          count: 0,
          placeholder: item.placeholder,
        },
        fn: ITEM_FUNCTIONS.indexOf(item.function),
        ids: [],
      }
      groups.set(key, group)
    }
    group.entry.count++
    group.ids.push(item.id)
  }
  const ordered = [...groups.entries()].sort(
    ([ka, a], [kb, b]) =>
      a.fn - b.fn || a.entry.name.localeCompare(b.entry.name, 'zh') || ka.localeCompare(kb),
  )
  const numbers: Record<string, number> = {}
  const entries = ordered.map(([, group], index) => {
    for (const id of group.ids) numbers[id] = index + 1
    return { no: index + 1, ...group.entry }
  })
  return { entries, numbers }
}
