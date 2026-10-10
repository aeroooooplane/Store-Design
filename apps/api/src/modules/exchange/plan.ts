import { assetFitProblem } from '@store/shared'
import type {
  AssetFit,
  Layout,
  LayoutItem,
  NodeKind,
  NodeOrigin,
  PlanStrategy,
  ShopType,
  SiStyle,
  Space,
} from '@store/shared'
import { AppError } from '../../lib/app-error.ts'

/** A node about to be imported; `ref` is its id inside the file. */
export interface PlannedNode {
  ref: string
  parentRef: string | null
  kind: NodeKind
  name: string
  space: Space | null
  layout: Layout | null
  strategy: PlanStrategy | null
  siStyle: SiStyle | null
  origin: NodeOrigin
  importedFrom: string | null
  hidden: boolean
}

export interface PlannedProject {
  name: string
  shopType: ShopType
  market: 'domestic' | 'overseas'
  siStyle: SiStyle
  /** Parents always precede their children. */
  nodes: PlannedNode[]
  draft: { baseRef: string; layout: Layout } | null
  warnings: string[]
}

/** Orders nodes parent-first; rejects missing parents and cycles. */
export function parentsFirst<T extends { ref: string; parentRef: string | null }>(nodes: T[]): T[] {
  const byRef = new Map<string, T>()
  for (const node of nodes) {
    if (byRef.has(node.ref)) throw new AppError('VALIDATION_FAILED', `节点编号重复：${node.ref}`)
    byRef.set(node.ref, node)
  }
  const done = new Set<string>()
  const visiting = new Set<string>()
  const sorted: T[] = []
  const visit = (node: T) => {
    if (done.has(node.ref)) return
    if (visiting.has(node.ref))
      throw new AppError('VALIDATION_FAILED', `节点引用存在循环：${node.ref}`)
    visiting.add(node.ref)
    if (node.parentRef !== null) {
      const parent = byRef.get(node.parentRef)
      if (!parent)
        throw new AppError(
          'VALIDATION_FAILED',
          `节点 ${node.ref} 的父节点 ${node.parentRef} 不存在`,
        )
      visit(parent)
    }
    visiting.delete(node.ref)
    done.add(node.ref)
    sorted.push(node)
  }
  for (const node of nodes) visit(node)
  return sorted
}

/**
 * Keeps a model reference only if the current catalogue still has that model at the item's
 * size; otherwise the item becomes a parametric placeholder of the same footprint.
 */
export function reconcileAssets(
  items: LayoutItem[],
  assets: ReadonlyMap<string, AssetFit>,
  where: string,
  warnings: string[],
): LayoutItem[] {
  return items.map((item) => {
    if (item.assetId === null) return item
    const problem = assetFitProblem(item, assets.get(item.assetId))
    if (problem === null) return item
    const reason = {
      unknown: '在当前模型目录中不存在',
      not_placeable: '在当前模型目录中没有网页模型',
      size: '尺寸与当前模型不符',
    }[problem]
    warnings.push(`${where}：${item.name}（${item.assetId}）${reason}，改为参数化占位`)
    return { ...item, assetId: null, placeholder: true }
  })
}
