import type { NodeSummary } from '@store/shared'

/**
 * Look of the history tree (用户 2026-10-10，参考 资源库/树状图). Every visual choice lives here so
 * the format can change without touching the layout or the component.
 */
export const TREE_STYLE = {
  /** 'down': root at the top, branches grow downwards (as specified); 'up': like the picture. */
  orientation: 'down' as 'down' | 'up',
  fontSize: 13,
  /** Width of one CJK character relative to the font size; other characters count 0.6. */
  wideChar: 1,
  narrowChar: 0.6,
  paddingX: 14,
  nodeHeight: 30,
  cornerRadius: 5,
  /** Longest label before it is shortened (the full name stays in the tooltip). */
  maxLabelChars: 14,
  /** Horizontal room between neighbouring subtrees, vertical distance between levels. */
  siblingGap: 28,
  levelGap: 78,
  /** Leaves next to each other alternate up and down by this much, like the reference. */
  leafStagger: 14,
  margin: 24,
  levels: {
    root: { fill: '#4a2b25', text: '#ffffff' },
    branch: { fill: '#3e6b48', text: '#ffffff' },
    leaf: { fill: '#e3ea9b', text: '#1d1d1b' },
  },
  edge: { color: '#3a3a3a', width: 1.2, arrow: 6 },
  /** Dashed ellipse around the selected node and its children. */
  group: { color: '#5b9b2f', width: 2, dash: '8 6', padding: 12 },
} as const

export type TreeLevel = keyof typeof TREE_STYLE.levels

export interface TreeBox {
  id: string
  /** The project itself is the root; it is not a history node. */
  node: NodeSummary | null
  label: string
  fullLabel: string
  level: TreeLevel
  depth: number
  /** Centre of the box in pixels. */
  x: number
  y: number
  width: number
  height: number
  hiddenBranch: boolean
}

export interface TreeEdge {
  from: string
  to: string
  /** SVG path from the parent's bottom centre to the child's top centre. */
  d: string
}

export interface TreeLayout {
  boxes: TreeBox[]
  edges: TreeEdge[]
  width: number
  height: number
}

export const ROOT_ID = 'project'

export function textWidth(text: string, style = TREE_STYLE): number {
  let units = 0
  for (const char of text) units += /[⺀-￿]/.test(char) ? style.wideChar : style.narrowChar
  return units * style.fontSize
}

function shorten(text: string, max: number): string {
  const chars = [...text]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text
}

interface Draft {
  id: string
  node: NodeSummary | null
  fullLabel: string
  children: Draft[]
  hiddenBranch: boolean
}

/**
 * Tidy top-down layout: each subtree gets the width it needs, children are centred under their
 * parent, so lines never cross and labels never overlap. Hidden branches are left out unless
 * `showHidden`.
 */
export function layoutTree(
  projectName: string,
  nodes: readonly NodeSummary[],
  labelOf: (node: NodeSummary) => string,
  showHidden: boolean,
  style = TREE_STYLE,
): TreeLayout {
  const ids = new Set(nodes.map((n) => n.id))
  const byParent = new Map<string, NodeSummary[]>()
  for (const node of nodes) {
    const parent = node.parentId !== null && ids.has(node.parentId) ? node.parentId : ROOT_ID
    byParent.set(parent, [...(byParent.get(parent) ?? []), node])
  }
  const build = (id: string, node: NodeSummary | null, hiddenAbove: boolean): Draft | null => {
    const hiddenBranch = hiddenAbove || (node?.hidden ?? false)
    if (hiddenBranch && !showHidden) return null
    return {
      id,
      node,
      fullLabel: node ? labelOf(node) : projectName,
      hiddenBranch,
      children: (byParent.get(id) ?? [])
        .map((child) => build(child.id, child, hiddenBranch))
        .filter((d): d is Draft => d !== null),
    }
  }
  const root = build(ROOT_ID, null, false)
  if (!root) return { boxes: [], edges: [], width: 0, height: 0 }

  const boxWidth = (d: Draft) =>
    Math.ceil(textWidth(shorten(d.fullLabel, style.maxLabelChars), style) + style.paddingX * 2)
  const widths = new Map<string, number>()
  const measure = (d: Draft): number => {
    const own = boxWidth(d)
    const kids = d.children.reduce((sum, c) => sum + measure(c), 0)
    const total = Math.max(own, kids + style.siblingGap * Math.max(0, d.children.length - 1))
    widths.set(d.id, total)
    return total
  }
  measure(root)

  const boxes: TreeBox[] = []
  const edges: TreeEdge[] = []
  let maxDepth = 0
  const place = (d: Draft, left: number, depth: number, stagger: number) => {
    const total = widths.get(d.id) ?? 0
    const x = left + total / 2
    const y = depth * style.levelGap + stagger
    maxDepth = Math.max(maxDepth, depth)
    boxes.push({
      id: d.id,
      node: d.node,
      label: shorten(d.fullLabel, style.maxLabelChars),
      fullLabel: d.fullLabel,
      level: depth === 0 ? 'root' : depth === 1 ? 'branch' : 'leaf',
      depth,
      x,
      y,
      width: boxWidth(d),
      height: style.nodeHeight,
      hiddenBranch: d.hiddenBranch,
    })
    const kidsWidth =
      d.children.reduce((sum, c) => sum + (widths.get(c.id) ?? 0), 0) +
      style.siblingGap * Math.max(0, d.children.length - 1)
    let cursor = x - kidsWidth / 2
    const leaves = d.children.filter((c) => c.children.length === 0).length
    d.children.forEach((child, i) => {
      // Neighbouring leaves alternate up and down a little once there are two or more.
      const offset =
        child.children.length === 0 && leaves >= 2 && i % 2 === 1 ? style.leafStagger : 0
      place(child, cursor, depth + 1, offset)
      cursor += (widths.get(child.id) ?? 0) + style.siblingGap
    })
  }
  place(root, 0, 0, 0)

  // Shift into the margin and, for 'up', mirror vertically.
  const height = maxDepth * style.levelGap + style.leafStagger + style.nodeHeight + style.margin * 2
  for (const box of boxes) {
    box.x += style.margin
    const y = box.y + style.margin + style.nodeHeight / 2
    box.y = style.orientation === 'down' ? y : height - y
  }
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const sign = style.orientation === 'down' ? 1 : -1
  const walk = (d: Draft) => {
    const parent = byId.get(d.id)
    for (const child of d.children) {
      const box = byId.get(child.id)
      if (parent && box) {
        const x1 = parent.x
        const y1 = parent.y + (sign * parent.height) / 2
        const x2 = box.x
        const y2 = box.y - (sign * box.height) / 2 - sign * style.edge.arrow
        const bend = (y2 - y1) * 0.55
        edges.push({
          from: d.id,
          to: child.id,
          d: `M${x1} ${y1}C${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}`,
        })
      }
      walk(child)
    }
  }
  walk(root)
  return {
    boxes,
    edges,
    width: (widths.get(ROOT_ID) ?? 0) + style.margin * 2,
    height,
  }
}

/** Ellipse around a node and its direct children (the highlighted group). */
export function groupEllipse(layout: TreeLayout, id: string, style = TREE_STYLE) {
  const ids = new Set([id, ...layout.edges.filter((e) => e.from === id).map((e) => e.to)])
  const members = layout.boxes.filter((b) => ids.has(b.id))
  if (!members.length) return null
  const left = Math.min(...members.map((b) => b.x - b.width / 2))
  const right = Math.max(...members.map((b) => b.x + b.width / 2))
  const top = Math.min(...members.map((b) => b.y - b.height / 2))
  const bottom = Math.max(...members.map((b) => b.y + b.height / 2))
  // An ellipse through the box corners is √2 times the half extents; then add the padding.
  return {
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
    rx: ((right - left) / 2) * Math.SQRT2 + style.group.padding,
    ry: ((bottom - top) / 2) * Math.SQRT2 + style.group.padding,
  }
}
