import { z } from 'zod'
import {
  LayoutSchema,
  SpaceSchema,
  isSimplePolygon,
  polygonInsidePolygon,
  rectangleSpace,
  roundM,
} from '@store/shared'
import type {
  AssetFit,
  ItemFunction,
  Layout,
  LayoutItem,
  NodeKind,
  Rotation,
  ShopType,
  SiStyle,
  Space,
} from '@store/shared'
import type { Point } from '@store/shared'
import { AppError } from '../../lib/app-error.ts'
import { parentsFirst, reconcileAssets } from './plan.ts'
import type { PlannedNode, PlannedProject } from './plan.ts'

// Legacy workbench backup (demo/src/project-import.js), read leniently: unknown fields are ignored.
const Finite = z.number().finite()
const Positive = Finite.positive()
const LegacyRoom = z.looseObject({
  w: Positive,
  d: Positive,
  h: Positive,
  shopType: z.string().optional(),
})
const LegacyItem = z.looseObject({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  type: z.enum(['table', 'counter', 'display', 'structure']),
  x: Finite,
  z: Finite,
  w: Positive,
  d: Positive,
  h: Positive,
  rotation: Finite.optional(),
  assetId: z.string().nullish(),
})
const LegacyLayout = z.looseObject({ room: LegacyRoom, items: z.array(LegacyItem).max(200) })
const LegacyNode = z.looseObject({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  kind: z.enum(['root', 'plan', 'edit', 'white', 'render']),
  parent: z.string().nullish(),
  room: LegacyRoom.optional(),
  layout: LegacyLayout.nullish(),
  style: z.enum(['SI1.0', 'SI2.0', 'both']).optional(),
})
export const LegacyProjectSchema = z.looseObject({
  schemaVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  nodes: z.array(LegacyNode).min(1).max(500),
  editorDraft: z.looseObject({ parent: z.string(), layout: LegacyLayout }).nullish(),
})
type LegacyLayoutT = z.infer<typeof LegacyLayout>
type LegacyItemT = z.infer<typeof LegacyItem>

const SHOP_TYPES: Record<string, ShopType> = { 边厅店: 'side_hall', 中岛店: 'island' }
const KINDS: Record<string, NodeKind> = {
  root: 'space',
  plan: 'plan',
  edit: 'edit',
  white: 'white',
  render: 'render',
}

function functionFor(item: LegacyItemT): ItemFunction {
  if (item.type === 'counter') return 'cashier'
  if (item.type === 'display') return 'accessory_cabinet'
  return /开箱/.test(item.name) ? 'unboxing_table' : 'island_table'
}

function rect(x: number, z: number, w: number, d: number): Point[] {
  return [
    [roundM(x), roundM(z)],
    [roundM(x + w), roundM(z)],
    [roundM(x + w), roundM(z + d)],
    [roundM(x), roundM(z + d)],
  ]
}

/** Legacy rooms are rectangles with the whole front edge open; structure items become obstacles. */
function legacySpace(
  room: { w: number; d: number; h: number },
  structures: LegacyItemT[],
  where: string,
  warnings: string[],
): Space {
  const base = rectangleSpace(room.w, room.d, room.h)
  const obstacles = structures.flatMap((item) => {
    const polygon = rect(item.x, item.z, item.w, item.d)
    if (!isSimplePolygon(polygon) || !polygonInsidePolygon(polygon, base.boundary)) {
      warnings.push(`${where}：结构占位“${item.name}”超出空间边界，已略去`)
      return []
    }
    return [
      { kind: 'other' as const, polygon, height: roundM(item.h), label: item.name.slice(0, 100) },
    ]
  })
  return SpaceSchema.parse({ ...base, obstacles })
}

function convertItems(
  items: LegacyItemT[],
  assets: ReadonlyMap<string, AssetFit>,
  where: string,
  warnings: string[],
): LayoutItem[] {
  const used = new Set<string>()
  const converted = items
    .filter((item) => item.type !== 'structure')
    .map((item, index): LayoutItem => {
      const turned = (((item.rotation ?? 0) % 360) + 360) % 360
      let rotation: Rotation = 0
      if (turned === 0 || turned === 90 || turned === 180 || turned === 270) rotation = turned
      else
        warnings.push(
          `${where}：${item.name} 的旋转 ${item.rotation} 不是 90° 的整数倍，按 0° 处理`,
        )
      let id = item.id.length <= 64 ? item.id : `item-${index + 1}`
      while (used.has(id)) id = `${id}-dup`.slice(-64)
      used.add(id)
      return {
        id,
        assetId: item.assetId ?? null,
        function: functionFor(item),
        name: item.name.slice(0, 100),
        // Legacy positions are footprint top-left corners; the new contract uses centres.
        cx: roundM(item.x + item.w / 2),
        cz: roundM(item.z + item.d / 2),
        rotation,
        w: roundM(item.w),
        d: roundM(item.d),
        h: roundM(item.h),
        placeholder: !item.assetId,
        locked: false,
      }
    })
  return reconcileAssets(converted, assets, where, warnings)
}

function convertLayout(
  layout: LegacyLayoutT,
  assets: ReadonlyMap<string, AssetFit>,
  where: string,
  warnings: string[],
): Layout {
  return LayoutSchema.parse({
    schemaVersion: 3,
    items: convertItems(layout.items, assets, where, warnings),
    planning: null,
  })
}

/**
 * Converts a legacy backup into new-style nodes. A layout whose room or structure placeholders
 * differ from the space above it gets its own space node, so every layout keeps its geometry.
 */
export function convertLegacy(
  raw: unknown,
  assets: ReadonlyMap<string, AssetFit>,
  name?: string,
): PlannedProject {
  const parsed = LegacyProjectSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      '无法识别的项目文件（既不是新格式，也不是旧版工作台备份）',
      parsed.error.issues,
    )
  }
  const legacy = parsed.data
  const warnings: string[] = []
  const ordered = parentsFirst(
    legacy.nodes.map((node) => ({ ...node, ref: node.id, parentRef: node.parent ?? null })),
  )

  const nodes: PlannedNode[] = []
  const spaceKeyOf = new Map<string, string>() // ref → JSON of the effective space
  let shopType: ShopType | undefined
  let firstRootName: string | undefined

  for (const node of ordered) {
    const where = `节点“${node.name}”`
    const siStyle: SiStyle | null =
      node.style === 'SI1.0' || node.style === 'SI2.0' ? node.style : null
    if (node.kind === 'root') {
      if (!node.room) throw new AppError('VALIDATION_FAILED', `${where}缺少空间尺寸`)
      shopType ??= SHOP_TYPES[node.room.shopType ?? ''] ?? 'side_hall'
      firstRootName ??= node.name
      const space = legacySpace(node.room, [], where, warnings)
      spaceKeyOf.set(node.ref, JSON.stringify(space))
      nodes.push({
        ref: node.ref,
        parentRef: node.parentRef,
        kind: 'space',
        name: node.name.slice(0, 100),
        space,
        layout: null,
        strategy: null,
        siStyle: null,
        origin: 'import',
        importedFrom: node.id,
        hidden: false,
      })
      continue
    }
    if (!node.layout) throw new AppError('VALIDATION_FAILED', `${where}缺少布局`)
    if (node.parentRef === null) throw new AppError('VALIDATION_FAILED', `${where}缺少父节点`)
    const space = legacySpace(
      node.layout.room,
      node.layout.items.filter((i) => i.type === 'structure'),
      where,
      warnings,
    )
    const key = JSON.stringify(space)
    let parentRef = node.parentRef
    if (spaceKeyOf.get(parentRef) !== key) {
      // The layout was drawn in a different room: keep that room as its own space step.
      const spaceRef = `${node.ref}#space`
      nodes.push({
        ref: spaceRef,
        parentRef,
        kind: 'space',
        name: `${node.name.slice(0, 90)} · 空间`,
        space,
        layout: null,
        strategy: null,
        siStyle: null,
        origin: 'import',
        importedFrom: node.id,
        hidden: false,
      })
      spaceKeyOf.set(spaceRef, key)
      parentRef = spaceRef
    }
    let kindSiStyle = siStyle
    if (node.kind === 'render' && !siStyle) {
      kindSiStyle = 'SI1.0'
      warnings.push(`${where}：渲染风格“${node.style ?? '未指定'}”按 SI1.0 导入`)
    }
    spaceKeyOf.set(node.ref, key)
    nodes.push({
      ref: node.ref,
      parentRef,
      kind: KINDS[node.kind] ?? 'edit',
      name: node.name.slice(0, 100),
      space: null,
      layout: convertLayout(node.layout, assets, where, warnings),
      strategy: null,
      siStyle: kindSiStyle,
      origin: 'import',
      importedFrom: node.id,
      hidden: false,
    })
  }

  let draft: PlannedProject['draft'] = null
  if (legacy.editorDraft) {
    const base = nodes.find((n) => n.ref === legacy.editorDraft?.parent)
    if (!base) warnings.push('未定稿调整所基于的节点不存在，已略去')
    else {
      if (legacy.editorDraft.layout.items.some((i) => i.type === 'structure')) {
        warnings.push('未定稿调整中的结构占位不随草稿导入，以所属空间为准')
      }
      draft = {
        baseRef: base.ref,
        layout: convertLayout(legacy.editorDraft.layout, assets, '未定稿调整', warnings),
      }
    }
  }
  if (!firstRootName) throw new AppError('VALIDATION_FAILED', '项目缺少根空间节点')
  return {
    name: (name ?? firstRootName).slice(0, 100),
    shopType: shopType ?? 'side_hall',
    market: 'domestic',
    siStyle: 'SI1.0',
    nodes,
    draft,
    warnings,
  }
}
