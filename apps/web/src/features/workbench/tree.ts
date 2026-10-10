import type { NodeKind, NodeSummary } from '@store/shared'

export const NODE_KIND_LABELS: Record<NodeKind, string> = {
  space: '空间',
  plan: '方案',
  edit: '编辑',
  white: '白模',
  render: '渲染',
}

export interface TreeEntry {
  node: NodeSummary
  depth: number
  /** Hidden itself or below a hidden node. */
  hiddenBranch: boolean
}

/** Depth-first order, children in creation order; orphans (parent missing) start at the top. */
export function flattenTree(nodes: NodeSummary[]): TreeEntry[] {
  const ids = new Set(nodes.map((n) => n.id))
  const children = new Map<string | null, NodeSummary[]>()
  for (const node of nodes) {
    const key = node.parentId !== null && ids.has(node.parentId) ? node.parentId : null
    children.set(key, [...(children.get(key) ?? []), node])
  }
  const result: TreeEntry[] = []
  const walk = (parent: string | null, depth: number, hiddenAbove: boolean) => {
    for (const node of children.get(parent) ?? []) {
      const hiddenBranch = hiddenAbove || node.hidden
      result.push({ node, depth, hiddenBranch })
      walk(node.id, depth + 1, hiddenBranch)
    }
  }
  walk(null, 0, false)
  return result
}

/** The nearest `space` node at or above `nodeId` (layouts live in it). */
export function spaceAncestor(nodes: NodeSummary[], nodeId: string): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let current = byId.get(nodeId)
  for (let guard = 0; current && guard <= nodes.length; guard++) {
    if (current.kind === 'space') return current.id
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return null
}

/** Stages in history order; 'edit' nodes are the plan-level variants of earlier versions. */
export type Stage = 'space' | 'plan' | 'white' | 'render'

export function stageOf(kind: NodeKind): Stage {
  return kind === 'edit' ? 'plan' : kind
}

const STAGE_PARENT: Record<Stage, NodeKind[] | null> = {
  space: null,
  plan: ['space'],
  white: ['plan', 'edit'],
  render: ['white'],
}

/**
 * Where a copy of this node goes: next to it, under its stage's parent (a plan under its space,
 * a white model under its plan). Old projects nested deeper; their copies come back up a level.
 */
export function stageParentId(nodes: NodeSummary[], node: NodeSummary): string | null {
  const kinds = STAGE_PARENT[stageOf(node.kind)]
  if (!kinds) return node.parentId
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let current = node.parentId ? byId.get(node.parentId) : undefined
  for (let guard = 0; current && guard <= nodes.length; guard++) {
    if (kinds.includes(current.kind)) return current.id
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return null
}

/** "方案 · 按面积推荐" → "方案 · 按面积推荐 副本2", then 副本3 … avoiding names already used. */
export function copyName(name: string, taken: readonly string[]): string {
  const base = name.replace(/ 副本\d+$/, '')
  const used = new Set(taken)
  let n = 2
  while (used.has(`${base} 副本${n}`)) n++
  return `${base} 副本${n}`
}

/** A name not used yet among siblings: "方案 · 尽量多放", then "方案 · 尽量多放（2）" … */
export function freshName(name: string, taken: readonly string[]): string {
  const used = new Set(taken)
  if (!used.has(name)) return name
  let n = 2
  while (used.has(`${name}（${n}）`)) n++
  return `${name}（${n}）`
}
