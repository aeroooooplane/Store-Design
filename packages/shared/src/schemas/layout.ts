import { z } from 'zod'
import { ItemFunctionSchema, PlanStrategySchema } from '../enums.ts'
import {
  polygonOverlapsRect,
  rectFromCenter,
  rectInsidePolygon,
  segmentIntersectsRectInterior,
} from '../geometry/index.ts'
import type { Rect } from '../geometry/index.ts'
import { EPSILON_M } from '../units.ts'
import { fixtureIssues } from '../fixtures/index.ts'
import { itemMount, itemsCollide, mountedWall, verticalRange } from '../mounting/index.ts'
import { InstallationSchema } from './asset.ts'
import type { AssetExtent } from './asset.ts'
import { CoordinateSchema, NameSchema, SizeSchema } from './common.ts'
import { openingPieces } from './space.ts'
import type { IssueSeverity, Space } from './space.ts'

export const MAX_LAYOUT_ITEMS = 200

export const RotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
export type Rotation = z.infer<typeof RotationSchema>

/**
 * One placed prop. Positioned by footprint centre; `w`/`d` are the footprint after rotation
 * and must equal the real asset size (props are never stretched or mirrored).
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

export function itemFootprint(item: Pick<LayoutItem, 'cx' | 'cz' | 'w' | 'd'>): Rect {
  return rectFromCenter(item.cx, item.cz, item.w, item.d)
}

export type LayoutIssueCode =
  | 'item_outside_boundary'
  | 'item_overlaps_obstacle'
  | 'item_overlap'
  | 'item_blocks_entrance'
  | 'item_too_tall'
  | 'item_not_on_wall'
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
  const theta = (-rotation * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const clean = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v)
  return [clean(x * cos + z * sin), clean(-x * sin + z * cos)]
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

/** Footprint of a real model after a quarter-turn rotation (props are never scaled). */
export function rotatedFootprint(
  asset: Pick<AssetFit, 'footprint'>,
  rotation: Rotation,
): { w: number; d: number; h: number } {
  const swap = rotation === 90 || rotation === 270
  return {
    w: swap ? asset.footprint.d : asset.footprint.w,
    d: swap ? asset.footprint.w : asset.footprint.d,
    h: asset.footprint.h,
  }
}

/** Why an item cannot use a catalogue model, or null when it fits. */
export type AssetFitProblem = 'unknown' | 'not_placeable' | 'size'

/**
 * An item that references a catalogue model must keep the model's true size. Models without
 * a web model (信息化物料 for now) may only be used as placeholders.
 */
export function assetFitProblem(
  item: Pick<LayoutItem, 'placeholder' | 'rotation' | 'w' | 'd' | 'h'>,
  asset: AssetFit | undefined,
): AssetFitProblem | null {
  if (!asset) return 'unknown'
  if (!asset.placeable && !item.placeholder) return 'not_placeable'
  const expected = rotatedFootprint(asset, item.rotation)
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
  const footprints = layout.items.map((item) => ({ item, rect: itemFootprint(item) }))

  for (const { item, rect } of footprints) {
    if (!rectInsidePolygon(rect, space.boundary)) {
      issues.push({
        code: 'item_outside_boundary',
        severity: 'error',
        message: `${item.name}超出空间边界`,
        itemIds: [item.id],
      })
    }
    space.obstacles.forEach((obstacle, index) => {
      if (polygonOverlapsRect(obstacle.polygon, rect)) {
        issues.push({
          code: 'item_overlaps_obstacle',
          severity: 'error',
          message: `${item.name}与${obstacle.label ?? `障碍物 ${index + 1}`}重叠`,
          itemIds: [item.id],
        })
      }
    })
    const mount = itemMount(item)
    space.entrances.forEach((entrance, index) => {
      if (mount !== 'floor') return
      // An entrance along several edges is checked piece by piece, not along its chord.
      const pieces = openingPieces(space, entrance) ?? [entrance]
      if (pieces.some((p) => segmentIntersectsRectInterior(p.a, p.b, rect))) {
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
      const box = itemFootprint(whole)
      const blocked =
        !rectInsidePolygon(box, space.boundary) ||
        space.obstacles.some((o) => polygonOverlapsRect(o.polygon, box)) ||
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
