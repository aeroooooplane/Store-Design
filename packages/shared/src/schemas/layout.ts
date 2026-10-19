import { z } from 'zod'
import { ItemFunctionSchema, PlanStrategySchema } from '../enums.ts'
import {
  nearestQuarter,
  obbBounds,
  obbCorners,
  obbInsidePolygon,
  placedBox,
  polygonOverlapsObb,
  quarterTilt,
  segmentIntersectsObbInterior,
  turnPoint,
} from '../geometry/index.ts'
import type { Point, Rect } from '../geometry/index.ts'
import { EPSILON_M, roundM } from '../units.ts'
import { fixtureIssues } from '../fixtures/index.ts'
import { embeddedWall } from '../mounting/embedded.ts'
import { itemMount, itemsCollide, mountedWall, verticalRange } from '../mounting/index.ts'
import { InstallationSchema } from './asset.ts'
import type { AssetExtent } from './asset.ts'
import { CoordinateSchema, NameSchema, SizeSchema } from './common.ts'
import { openingPieces } from './space.ts'
import type { IssueSeverity, Space } from './space.ts'

export const MAX_LAYOUT_ITEMS = 200

/**
 * Turn of a prop in degrees, any angle from 0 to below 360 (confirmed by the user, 2026-10-14/15).
 * Same convention as the viewer: three.js rotation.y = −rotation, a quarter turn takes +Z to −X.
 */
export const RotationSchema = z.number().finite().min(0).lt(360)
export type Rotation = z.infer<typeof RotationSchema>

/** An angle in degrees brought into 0 ≤ angle < 360, to a tenth of a degree. */
export function normalizeRotation(angle: number): Rotation {
  // Wrap first, then round: rounding first leaves float noise from the wrap (124.60000000000002).
  const tenth = Math.round((((angle % 360) + 360) % 360) * 10) / 10
  return tenth >= 360 ? 0 : tenth + 0
}

/** Smallest and largest LOGO scale (see LayoutItemSchema.scale). */
export const MIN_ITEM_SCALE = 0.2
export const MAX_ITEM_SCALE = 5

/**
 * One placed prop. Positioned by footprint centre. `w`/`d` are the footprint at the nearest
 * quarter turn of `rotation` (swapped at 90° and 270°); any further angle turns that box about
 * its centre (see itemCorners). They must equal the real asset size (props are never stretched
 * or mirrored), times `scale` for a LOGO.
 */
export const LayoutItemSchema = z.object({
  id: z.string().trim().min(1).max(64),
  assetId: z
    .string()
    .regex(/^asset-\d+$/)
    .nullable(),
  function: ItemFunctionSchema,
  name: NameSchema,
  cx: CoordinateSchema,
  cz: CoordinateSchema,
  rotation: RotationSchema,
  w: SizeSchema,
  d: SizeSchema,
  h: SizeSchema,
  /** Parametric stand-in while the real model is missing; shown as such in the UI. */
  placeholder: z.boolean().default(false),
  /** Locked items are kept in place by the planner and the agent. */
  locked: z.boolean().default(false),
  /** Wall and ceiling pieces (LOGO, 画面); absent for props standing on the floor. */
  mount: InstallationSchema.optional(),
  /** Height of the bottom above the floor (metres) for wall and ceiling pieces. */
  elevation: z.number().finite().min(0).max(20).optional(),
  /**
   * Uniform scale of a LOGO (signage) against its model, absent at 1; other props keep their true
   * size. `w`/`d`/`h` already include it.
   */
  scale: z.number().finite().min(MIN_ITEM_SCALE).max(MAX_ITEM_SCALE).optional(),
})

export const RelaxationSchema = z.object({
  rule: z.string().trim().min(1).max(64),
  target: z.number().finite(),
  actual: z.number().finite(),
})

export const PlanningSchema = z.object({
  strategy: PlanStrategySchema,
  requested: z.int().min(0).max(MAX_LAYOUT_ITEMS),
  placed: z.int().min(0).max(MAX_LAYOUT_ITEMS),
  /** Soft rules that were relaxed to fit the space, e.g. main aisle 1.2 m → 1.0 m. */
  relaxations: z.array(RelaxationSchema).max(20).default([]),
  note: z.string().trim().max(500).nullable().default(null),
})

export const FIXTURE_KINDS = ['hollow_partition'] as const
export const FixtureKindSchema = z.enum(FIXTURE_KINDS)
export type FixtureKind = z.infer<typeof FixtureKindSchema>
export const MAX_FIXTURES = 50

/**
 * A hard-finish piece drawn on the plan (硬装构件). For now only 空心隔板: a box built around
 * accessory cabinets, a stop-gap until cabinets can sit inside walls. Axis-aligned, by centre.
 */
export const FixtureSchema = z.object({
  id: z.string().trim().min(1).max(64),
  kind: FixtureKindSchema,
  cx: CoordinateSchema,
  cz: CoordinateSchema,
  w: SizeSchema,
  d: SizeSchema,
  h: SizeSchema,
})
export type Fixture = z.output<typeof FixtureSchema>

export const LayoutSchema = z
  .object({
    schemaVersion: z.literal(3),
    items: z.array(LayoutItemSchema).max(MAX_LAYOUT_ITEMS),
    planning: PlanningSchema.nullable().default(null),
    /** Hard-finish pieces (空心隔板); absent in layouts without any. */
    fixtures: z.array(FixtureSchema).max(MAX_FIXTURES).optional(),
  })
  .superRefine((layout, ctx) => {
    const seen = new Set<string>()
    layout.items.forEach((item, index) => {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `道具编号重复：${item.id}`,
          path: ['items', index, 'id'],
        })
      }
      seen.add(item.id)
    })
  })

export type LayoutItem = z.output<typeof LayoutItemSchema>
export type Layout = z.output<typeof LayoutSchema>
export type LayoutInput = z.input<typeof LayoutSchema>

type Placed = Pick<LayoutItem, 'cx' | 'cz' | 'w' | 'd'> & { rotation?: number | undefined }

/**
 * Axis-aligned rectangle around an item: its footprint at a quarter turn, the bounds of the
 * turned box otherwise. Collision and fit checks use the true box (itemCorners, placedBox).
 */
export function itemFootprint(item: Placed): Rect {
  return obbBounds(placedBox(item))
}

/** The four corners of the box an item takes, turned by its tilt off the nearest quarter turn. */
export function itemCorners(item: Placed): [Point, Point, Point, Point] {
  return obbCorners(placedBox(item))
}

/** What an item's rotation adds to its nearest quarter turn, in degrees (−45 ≤ tilt < 45). */
export function itemTilt(item: { rotation?: number | undefined }): number {
  return quarterTilt(item.rotation ?? 0)
}

export type LayoutIssueCode =
  | 'item_outside_boundary'
  | 'item_overlaps_obstacle'
  | 'item_overlap'
  | 'item_blocks_entrance'
  | 'item_too_tall'
  | 'item_not_on_wall'
  | 'item_not_in_wall'
  | 'item_extent_blocked'
  | 'fixture_outside_boundary'
  | 'fixture_overlaps_item'
  | 'item_asset_unknown'
  | 'item_asset_size_mismatch'

export interface LayoutIssue {
  code: LayoutIssueCode
  severity: IssueSeverity
  message: string
  itemIds: string[]
}

/** What the asset contract needs to know about a catalogue model. */
export interface AssetFit {
  footprint: { w: number; d: number; h: number }
  placeable: boolean
  /** The whole model around a smaller body (a 开箱桌 with its stools), see AssetExtentSchema. */
  extent?: AssetExtent | null
}

/**
 * An offset in the model's own frame (X, Z) after a layout rotation, on the plan. Same
 * convention as facingAfter and the viewer (three.js rotation.y = −rotation).
 */
export function turnOffset(x: number, z: number, rotation: number): [number, number] {
  return turnPoint(x, z, rotation)
}

/**
 * Where the whole model of an item stands on the plan: its centre and rotated size. Equal to the
 * item's footprint unless the catalogue model has a smaller body (see AssetFit.extent).
 */
export function modelBox(
  item: Pick<LayoutItem, 'cx' | 'cz' | 'w' | 'd' | 'rotation'>,
  asset: Pick<AssetFit, 'extent'> | undefined,
): { cx: number; cz: number; w: number; d: number } {
  const extent = asset?.extent
  if (!extent) return { cx: item.cx, cz: item.cz, w: item.w, d: item.d }
  const [dx, dz] = turnOffset(extent.cx, extent.cz, item.rotation)
  const size = rotatedFootprint({ footprint: { ...extent, h: 0 } }, item.rotation)
  return { cx: item.cx + dx, cz: item.cz + dz, w: size.w, d: size.d }
}

/**
 * Footprint of a real model as an item stores it: at the nearest quarter turn of `rotation`
 * (width and depth swapped at 90° and 270°). Props are never stretched.
 */
export function rotatedFootprint(
  asset: Pick<AssetFit, 'footprint'>,
  rotation: number,
): { w: number; d: number; h: number } {
  const quarter = nearestQuarter(rotation)
  const swap = quarter === 90 || quarter === 270
  return {
    w: swap ? asset.footprint.d : asset.footprint.w,
    d: swap ? asset.footprint.w : asset.footprint.d,
    h: asset.footprint.h,
  }
}

/** Why an item cannot use a catalogue model, or null when it fits. */
export type AssetFitProblem = 'unknown' | 'not_placeable' | 'size'

/**
 * An item that references a catalogue model must keep the model's true size; a LOGO may be
 * scaled uniformly (`scale`). Models without a web model (信息化物料 for now) may only be used
 * as placeholders.
 */
export function assetFitProblem(
  item: Pick<LayoutItem, 'placeholder' | 'rotation' | 'w' | 'd' | 'h'> &
    Partial<Pick<LayoutItem, 'function' | 'scale'>>,
  asset: AssetFit | undefined,
): AssetFitProblem | null {
  if (!asset) return 'unknown'
  if (!asset.placeable && !item.placeholder) return 'not_placeable'
  const scale = item.scale ?? 1
  if (scale !== 1 && item.function !== 'signage') return 'size'
  const expected = scaledSize(rotatedFootprint(asset, item.rotation), scale)
  const differs = (size: { w: number; d: number; h: number }) =>
    (['w', 'd', 'h'] as const).some((k) => Math.abs(item[k] - size[k]) > EPSILON_M)
  // Items placed before the body was corrected keep the whole model's size until reopened
  // (fitBodyFootprints); they are still the real model.
  const legacy = asset.extent
    ? rotatedFootprint({ footprint: { ...asset.extent, h: asset.footprint.h } }, item.rotation)
    : null
  return differs(expected) && (!legacy || differs(legacy)) ? 'size' : null
}

/**
 * Items placed with the whole model's size (before body-footprint.json corrected their model)
 * moved to the body: its size, and its centre where the body stands within the model. Other
 * items are returned unchanged, so this is safe to apply to any layout, any number of times.
 */
export function fitBodyFootprints(layout: Layout, assets: ReadonlyMap<string, AssetFit>): Layout {
  let changed = false
  const items = layout.items.map((item) => {
    const asset = item.assetId === null ? undefined : assets.get(item.assetId)
    if (!asset?.extent || item.placeholder) return item
    const legacy = rotatedFootprint(
      { footprint: { ...asset.extent, h: asset.footprint.h } },
      item.rotation,
    )
    if (Math.abs(item.w - legacy.w) > EPSILON_M || Math.abs(item.d - legacy.d) > EPSILON_M)
      return item
    const body = rotatedFootprint(asset, item.rotation)
    if (Math.abs(item.w - body.w) <= EPSILON_M && Math.abs(item.d - body.d) <= EPSILON_M)
      return item
    const [dx, dz] = turnOffset(asset.extent.cx, asset.extent.cz, item.rotation)
    changed = true
    return { ...item, cx: roundMm(item.cx - dx), cz: roundMm(item.cz - dz), w: body.w, d: body.d }
  })
  return changed ? { ...layout, items } : layout
}

const roundMm = (v: number) => Math.round(v * 1000) / 1000 + 0

/** A size times a uniform scale, to the millimetre (as stored). */
function scaledSize(size: { w: number; d: number; h: number }, scale: number) {
  if (scale === 1) return size
  return { w: roundM(size.w * scale), d: roundM(size.d * scale), h: roundM(size.h * scale) }
}

/**
 * A LOGO (signage) scaled uniformly against its model: `scale` is clamped to
 * MIN_ITEM_SCALE–MAX_ITEM_SCALE and the size follows; the centre stays. A piece on a wall should
 * be snapped back onto it afterwards (wallMountSnap). Other props are returned unchanged.
 */
export function scaleItem<T extends Pick<LayoutItem, 'function' | 'rotation' | 'w' | 'd' | 'h'>>(
  item: T & { scale?: number | undefined },
  asset: Pick<AssetFit, 'footprint'>,
  scale: number,
): T & { scale?: number | undefined } {
  if (item.function !== 'signage') return item
  const clamped = Math.min(
    MAX_ITEM_SCALE,
    Math.max(MIN_ITEM_SCALE, Math.round(scale * 1000) / 1000),
  )
  const { scale: _old, ...rest } = item
  const size = scaledSize(rotatedFootprint(asset, item.rotation), clamped)
  return { ...(rest as T), ...size, ...(clamped === 1 ? {} : { scale: clamped }) }
}

/**
 * Items must reference known catalogue models at their true size (see assetFitProblem).
 * This is a contract violation rather than a design issue, so callers reject such layouts.
 */
export function checkAssetFit(
  layout: Layout,
  assets: ReadonlyMap<string, AssetFit>,
): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  for (const item of layout.items) {
    if (item.assetId === null) continue
    const problem = assetFitProblem(item, assets.get(item.assetId))
    if (problem === 'unknown' || problem === 'not_placeable') {
      issues.push({
        code: 'item_asset_unknown',
        severity: 'error',
        message:
          problem === 'unknown'
            ? `${item.name}引用的模型 ${item.assetId} 不存在`
            : `${item.name}引用的模型 ${item.assetId} 还没有网页模型，只能作为占位摆放`,
        itemIds: [item.id],
      })
    } else if (problem === 'size') {
      issues.push({
        code: 'item_asset_size_mismatch',
        severity: 'error',
        message: `${item.name}的尺寸与真实模型不符，模型不可拉伸`,
        itemIds: [item.id],
      })
    }
  }
  return issues
}

/**
 * Hard constraints: inside the boundary, clear of obstacles, entrances and each other, and below
 * the ceiling; a wall piece off the wall is only a warning. Wall and ceiling pieces hang above
 * the floor, so they do not block entrances or clash with floor props (see itemsCollide).
 * Aisle widths and spacing are soft rules handled by the planner.
 */
export function validateLayout(
  space: Space,
  layout: Layout,
  assets?: ReadonlyMap<string, AssetFit>,
): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  // The true box of each item: turned by its tilt off the nearest quarter turn.
  const footprints = layout.items.map((item) => ({ item, box: placedBox(item) }))

  for (const { item, box } of footprints) {
    const mount = itemMount(item)
    // A built-in piece's body is inside the wall, beyond the boundary, clear of the floor.
    const builtIn = mount === 'embedded'
    if (!builtIn && !obbInsidePolygon(box, space.boundary)) {
      issues.push({
        code: 'item_outside_boundary',
        severity: 'error',
        message: `${item.name}超出空间边界`,
        itemIds: [item.id],
      })
    }
    space.obstacles.forEach((obstacle, index) => {
      if (!builtIn && polygonOverlapsObb(obstacle.polygon, box)) {
        issues.push({
          code: 'item_overlaps_obstacle',
          severity: 'error',
          message: `${item.name}与${obstacle.label ?? `障碍物 ${index + 1}`}重叠`,
          itemIds: [item.id],
        })
      }
    })
    space.entrances.forEach((entrance, index) => {
      if (mount !== 'floor') return
      // An entrance along several edges is checked piece by piece, not along its chord.
      const pieces = openingPieces(space, entrance) ?? [entrance]
      if (pieces.some((p) => segmentIntersectsObbInterior(p.a, p.b, box))) {
        issues.push({
          code: 'item_blocks_entrance',
          severity: 'error',
          message: `${item.name}压在入口 ${index + 1} 上`,
          itemIds: [item.id],
        })
      }
    })
    if (verticalRange(item)[1] > space.height + EPSILON_M) {
      issues.push({
        code: 'item_too_tall',
        severity: 'error',
        message: `${item.name}高度超过层高`,
        itemIds: [item.id],
      })
    }
    if (builtIn && !embeddedWall(item, space)) {
      issues.push({
        code: 'item_not_in_wall',
        severity: 'warning',
        message: `${item.name}的正面没有落在墙面上`,
        itemIds: [item.id],
      })
    }
    if (mount === 'wall' && !mountedWall(item, space)) {
      issues.push({
        code: 'item_not_on_wall',
        severity: 'warning',
        message: `${item.name}没有贴在墙上`,
        itemIds: [item.id],
      })
    }
  }

  footprints.forEach((first, i) => {
    for (const second of footprints.slice(i + 1)) {
      if (itemsCollide(first.item, second.item)) {
        issues.push({
          code: 'item_overlap',
          severity: 'error',
          message: `${first.item.name}与${second.item.name}重叠`,
          itemIds: [first.item.id, second.item.id],
        })
      }
    }
  })
  issues.push(...fixtureIssues(space, layout))

  // The stools of a 开箱桌 (the model beyond its body) may reach a wall or another prop: worth a
  // look, not an error (confirmed by the user, 2026-10-15).
  if (assets) {
    for (const { item } of footprints) {
      const asset = item.assetId === null ? undefined : assets.get(item.assetId)
      if (!asset?.extent || item.placeholder) continue
      const whole = { ...item, ...modelBox(item, asset) }
      const wholeBox = placedBox(whole)
      const blocked =
        !obbInsidePolygon(wholeBox, space.boundary) ||
        space.obstacles.some((o) => polygonOverlapsObb(o.polygon, wholeBox)) ||
        footprints.some(({ item: other }) => other.id !== item.id && itemsCollide(whole, other))
      if (blocked) {
        issues.push({
          code: 'item_extent_blocked',
          severity: 'warning',
          message: `${item.name}的凳子压到墙、障碍物或其他道具`,
          itemIds: [item.id],
        })
      }
    }
  }
  return issues
}
