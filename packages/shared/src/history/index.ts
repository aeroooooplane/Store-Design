import type { NodeKind } from '../enums.ts'

/** History rules shared by the workbench and the design assistant (names, stages, ancestors). */

/** The fields of a history node these rules need; DesignNode and NodeSummary both fit. */
export interface HistoryNode {
  id: string
  parentId: string | null
  kind: NodeKind
}

export const NODE_KIND_LABELS: Record<NodeKind, string> = {
  space: '空间',
  plan: '方案',
  edit: '方案',
  white: '方案',
  render: '渲染',
}

/** Legacy edit and white nodes are displayed in the plan stage. */
export type Stage = 'space' | 'plan' | 'render'

export const STAGE_LABELS: Record<Stage, string> = {
  space: '空间',
  plan: '方案',
  render: '渲染',
}

export function stageOf(kind: NodeKind): Stage {
  return kind === 'edit' || kind === 'white' ? 'plan' : kind
}

/** Parent kinds for new nodes in each stage. */
export const STAGE_PARENT_KINDS: Record<Stage, readonly NodeKind[] | null> = {
  space: null,
  plan: ['space'],
  render: ['plan', 'edit', 'white'],
}

/** The nearest `space` node at or above `nodeId` (layouts live in it). */
export function spaceAncestor(nodes: readonly HistoryNode[], nodeId: string): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let current = byId.get(nodeId)
  for (let guard = 0; current && guard <= nodes.length; guard++) {
    if (current.kind === 'space') return current.id
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return null
}

/**
 * A copy belongs under its stage's parent. Copies of legacy design nodes go under their space.
 */
export function stageParentId(nodes: readonly HistoryNode[], node: HistoryNode): string | null {
  const kinds = STAGE_PARENT_KINDS[stageOf(node.kind)]
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
