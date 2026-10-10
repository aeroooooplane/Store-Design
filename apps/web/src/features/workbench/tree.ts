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
