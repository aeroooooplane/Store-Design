import type { PlanStrategy, SiStyle } from '../enums.ts'

/**
 * Rules for the low cabinets (配件边柜) an island shop stands along its edge, kept apart from the
 * planner code as data: once the cleaned store data (store.json, bom.json, plan.json of the gold
 * standard) is counted, a measured rule set replaces DEFAULT_SIDE_CABINET_RULES as a whole, or
 * per call (`sideCabinetRules` of planLayout, the `rules` argument of plannerCatalog).
 *
 * Where a cabinet may stand is judged per wall piece, not per side (confirmed by the user,
 * 2026-10-15): entrances, open edges, the main aisle and the entrance buffers take none, but a
 * piece of wall long enough for the cabinet does, on whichever side it is.
 */
export interface SideCabinetRules {
  /** Usable floor area (㎡, see usableArea) below which an island shop stands none. */
  minArea: number
  /** One cabinet per this much usable floor area (㎡), rounded down; at least one from minArea. */
  areaPerCabinet: number
  /** Most cabinets by area, however large the shop. */
  maxCount: number
  /** Most cabinets per strategy, below the count by area. */
  strategyMax: Record<Exclude<PlanStrategy, 'case'>, number>
  /**
   * Walls to the left and right of the main entrance take cabinets only beyond this share of the
   * shop's depth from the entrance (0.5: the back half). The wall facing the entrance comes first
   * and takes them anywhere; walls on the entrance side take none.
   */
  sideFromDepth: number
  /** Height band (m) chosen first among the catalogue's 配件边柜; kept below ISLAND_CABINET_MAX_H. */
  preferHeight: { min: number; max: number }
  /** Models chosen first per SI style, by asset id, in order; the rest follow by height and depth. */
  preferredAssets: Partial<Record<SiStyle, string[]>>
}

/** Confirmed by the user, 2026-10-14/15: the default until store data gives a measured rule. */
export const DEFAULT_SIDE_CABINET_RULES: SideCabinetRules = {
  minArea: 20,
  areaPerCabinet: 25,
  maxCount: 3,
  strategyMax: { max: 3, area: 2, min: 1 },
  sideFromDepth: 0.5,
  preferHeight: { min: 1.2, max: 1.4 },
  // 1.8米配件边柜(带托盘)：3 tray seats, so it also serves as a display side table.
  preferredAssets: { 'SI2.0': ['asset-33660153'] },
}

/** Side cabinets an island shop of this usable floor area (㎡) asks for under a strategy. */
export function sideCabinetsForArea(
  area: number,
  strategy: Exclude<PlanStrategy, 'case'>,
  rules: SideCabinetRules = DEFAULT_SIDE_CABINET_RULES,
): number {
  if (area < rules.minArea) return 0
  const byArea = Math.min(rules.maxCount, Math.max(1, Math.floor(area / rules.areaPerCabinet)))
  return Math.min(byArea, rules.strategyMax[strategy])
}
