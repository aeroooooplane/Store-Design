import { z } from 'zod'
import { ItemFunctionSchema, PlanStrategySchema } from '../enums.ts'
import {
  polygonOverlapsRect,
  rectFromCenter,
  rectInsidePolygon,
  rectsOverlap,
  segmentIntersectsRectInterior,
} from '../geometry/index.ts'
import type { Rect } from '../geometry/index.ts'
import { EPSILON_M } from '../units.ts'
import { CoordinateSchema, NameSchema, SizeSchema } from './common.ts'
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

export const LayoutSchema = z
  .object({
    schemaVersion: z.literal(3),
    items: z.array(LayoutItemSchema).max(MAX_LAYOUT_ITEMS),
    planning: PlanningSchema.nullable().default(null),
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
  return (['w', 'd', 'h'] as const).some((k) => Math.abs(item[k] - expected[k]) > EPSILON_M)
    ? 'size'
    : null
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
 * Hard constraints only: inside the boundary, clear of obstacles, entrances and each other,
 * and not taller than the ceiling. Aisle widths and spacing are soft rules handled by the planner.
 */
export function validateLayout(space: Space, layout: Layout): LayoutIssue[] {
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
    space.entrances.forEach((entrance, index) => {
      if (segmentIntersectsRectInterior(entrance.a, entrance.b, rect)) {
        issues.push({
          code: 'item_blocks_entrance',
          severity: 'error',
          message: `${item.name}压在入口 ${index + 1} 上`,
          itemIds: [item.id],
        })
      }
    })
    if (item.h > space.height + EPSILON_M) {
      issues.push({
        code: 'item_too_tall',
        severity: 'error',
        message: `${item.name}高度超过层高`,
        itemIds: [item.id],
      })
    }
  }

  footprints.forEach((first, i) => {
    for (const second of footprints.slice(i + 1)) {
      if (rectsOverlap(first.rect, second.rect)) {
        issues.push({
          code: 'item_overlap',
          severity: 'error',
          message: `${first.item.name}与${second.item.name}重叠`,
          itemIds: [first.item.id, second.item.id],
        })
      }
    }
  })
  return issues
}
