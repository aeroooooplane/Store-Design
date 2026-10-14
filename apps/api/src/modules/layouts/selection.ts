import type { Asset, PlannerAsset, PlannerCatalog, SiStyle } from '@store/shared'

function familyRank(asset: Asset, style: SiStyle): number {
  if (asset.siFamily === style) return 0
  if (asset.siFamily === '通用') return 1
  if (asset.siFamily === '非标') return 3
  return 2
}

const ISLAND_NAMES = [/普通中岛桌/, /亮脚中岛桌/]
const CASHIER_NAMES = [/收银台|收银桌/, /边桌收银柜/, /收银边柜/]

function nameRank(asset: Asset, patterns: RegExp[]): number {
  const index = patterns.findIndex((p) => p.test(asset.standardName))
  return index < 0 ? patterns.length : index
}

/**
 * Height band of the 配件边柜 an island shop stands along its edge, in metres: the 1.3 m class
 * (catalogue 1.214–1.3 m), kept below ISLAND_CABINET_MAX_H so the shop stays open to view.
 */
const SIDE_CABINET_HEIGHT = { min: 1.2, max: 1.4 }

const inSideCabinetBand = (asset: Asset) =>
  asset.footprint.h >= SIDE_CABINET_HEIGHT.min - 1e-9 &&
  asset.footprint.h <= SIDE_CABINET_HEIGHT.max + 1e-9

const toPlanner = (asset: Asset): PlannerAsset => ({
  id: asset.id,
  name: asset.name,
  function: asset.function,
  footprint: asset.footprint,
  front: asset.front,
})

/**
 * Chooses planner models from the placeable catalogue (retired models left out): the project's
 * SI family first, then 通用, then the standard model names; rotated-instance variants last. One
 * cabinet per length, so a wall is not lined with mixed display variants of the same size. The
 * 配件边柜 go apart (`sideCabinet`): only island shops stand them, a few along the edge.
 */
export function plannerCatalog(assets: Iterable<Asset>, style: SiStyle): PlannerCatalog {
  const all = [...assets].filter((a) => a.placeable && !a.retired)
  const sorted = (list: Asset[], names: RegExp[]) =>
    [...list].sort(
      (a, b) =>
        familyRank(a, style) - familyRank(b, style) ||
        nameRank(a, names) - nameRank(b, names) ||
        Number(/旋转实例/.test(a.variant)) - Number(/旋转实例/.test(b.variant)) ||
        a.id.localeCompare(b.id, undefined, { numeric: true }),
    )
  const cabinets = sorted(
    all.filter((a) => a.function === 'accessory_cabinet'),
    [],
  )
  const seen = new Set<string>()
  const oneSize = cabinets.filter((a) => {
    // Only the preferred family's cabinets line the walls when it has any.
    if (familyRank(a, style) > familyRank(cabinets[0] ?? a, style)) return false
    const key = Math.max(a.footprint.w, a.footprint.d).toFixed(1)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  // Side cabinets (island shops only): the preferred family alone, as for the wall cabinets; within
  // it the 1.2–1.4 m models first, then the shallowest, so they keep out of the walkway.
  const sideCabinets = sorted(
    all.filter((a) => a.function === 'side_cabinet'),
    [],
  ).sort(
    (a, b) =>
      familyRank(a, style) - familyRank(b, style) ||
      Number(!inSideCabinetBand(a)) - Number(!inSideCabinetBand(b)) ||
      Math.min(a.footprint.w, a.footprint.d) - Math.min(b.footprint.w, b.footprint.d),
  )
  const sideFamily = sideCabinets[0] ? familyRank(sideCabinets[0], style) : 0
  return {
    island: sorted(
      all.filter((a) => a.function === 'island_table'),
      ISLAND_NAMES,
    ).map(toPlanner),
    cashier: sorted(
      all.filter((a) => a.function === 'cashier'),
      CASHIER_NAMES,
    ).map(toPlanner),
    cabinet: oneSize.map(toPlanner),
    sideCabinet: sideCabinets.filter((a) => familyRank(a, style) === sideFamily).map(toPlanner),
  }
}
