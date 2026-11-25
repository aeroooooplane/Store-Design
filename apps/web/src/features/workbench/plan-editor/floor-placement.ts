import {
  MAX_LAYOUT_ITEMS,
  PointSchema,
  advertisingScreenName,
  isDisplayPanel,
  itemsCollide,
  obbBounds,
  placedBox,
  roundM,
  validateLayout,
} from '@store/shared'
import type { Asset, Layout, LayoutItem, Space } from '@store/shared'

export function pointPlacedAsset(asset: Asset): boolean {
  return (
    (asset.installation ?? 'floor') === 'floor' &&
    !isDisplayPanel({
      assetId: asset.id,
      function: asset.function,
      name: advertisingScreenName(asset.id) ?? asset.name,
    })
  )
}

/** Point placement allows temporary geometry conflicts; suggested positions must be clear. */
export function floorPlacementProblem(
  layout: Layout,
  space: Space,
  item: LayoutItem,
  mode: 'point' | 'nearby',
): string | null {
  if (layout.items.length >= MAX_LAYOUT_ITEMS)
    return `本方案已达到 ${MAX_LAYOUT_ITEMS} 件道具上限。`
  if (!PointSchema.safeParse([item.cx, item.cz]).success) return '请在门店附近选择位置。'
  const issue = validateLayout(space, { ...layout, items: [item] }).find(
    ({ severity, itemIds, code }) =>
      severity === 'error' &&
      itemIds.includes(item.id) &&
      (mode === 'nearby' ||
        (code !== 'item_outside_boundary' &&
          code !== 'item_overlaps_obstacle' &&
          code !== 'item_blocks_entrance')),
  )
  if (issue) return issue.message
  if (mode === 'point') return null
  const clash = layout.items.find((other) => itemsCollide(item, other))
  return clash ? `此位置与「${clash.name}」重叠，请换个位置。` : null
}

/** Try the nearest sides of the original with a small gap for the two silhouettes. */
export function nearbyFurniture(layout: Layout, space: Space, item: LayoutItem): LayoutItem | null {
  const { minX, maxX, minZ, maxZ } = obbBounds(placedBox(item))
  const dx = maxX - minX + 0.2
  const dz = maxZ - minZ + 0.2
  for (const [x, z] of [
    [dx, 0],
    [-dx, 0],
    [0, dz],
    [0, -dz],
  ] as const) {
    const candidate = { ...item, cx: roundM(item.cx + x), cz: roundM(item.cz + z) }
    if (!floorPlacementProblem(layout, space, candidate, 'nearby')) return candidate
  }
  return null
}
