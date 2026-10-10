import { describe, expect, it } from 'vitest'
import type { NodeSummary } from '@store/shared'
import { ROOT_ID, TREE_STYLE, groupEllipse, layoutTree, textWidth } from './tree-layout.ts'

let seq = 0
function node(id: string, parentId: string | null, overrides: Partial<NodeSummary> = {}) {
  seq += 1
  return {
    id,
    parentId,
    kind: parentId === null ? 'space' : 'plan',
    name: id,
    strategy: null,
    siStyle: null,
    origin: 'user',
    importedFrom: null,
    hidden: false,
    createdAt: new Date(Date.UTC(2026, 9, 10, 0, seq)).toISOString(),
    ...overrides,
  } satisfies NodeSummary
}

const nodes = [
  node('s1', null),
  node('p1', 's1'),
  node('p2', 's1'),
  node('p3', 's1'),
  node('w1', 'p1', { kind: 'white' }),
  node('s2', null, { hidden: true }),
  node('p4', 's2'),
]
const label = (n: NodeSummary) => n.name

describe('layoutTree', () => {
  it('puts the project on top, spaces below, then their steps, by level colour', () => {
    const layout = layoutTree('南京德基', nodes, label, false)
    const box = (id: string) => layout.boxes.find((b) => b.id === id)
    expect(box(ROOT_ID)).toMatchObject({ level: 'root', label: '南京德基', depth: 0 })
    expect(box('s1')).toMatchObject({ level: 'branch', depth: 1 })
    expect(box('w1')).toMatchObject({ level: 'leaf', depth: 3 })
    expect(box('s2')).toBeUndefined()
    // Top-down: every child sits below its parent; the parent is centred over its children.
    for (const edge of layout.edges) {
      expect(box(edge.to)?.y ?? 0).toBeGreaterThan(box(edge.from)?.y ?? 0)
    }
    const kids = ['p1', 'p2', 'p3'].map((id) => box(id)?.x ?? 0)
    expect(box('s1')?.x).toBeCloseTo((Math.min(...kids) + Math.max(...kids)) / 2)
  })

  it('never lets boxes on a level overlap', () => {
    const layout = layoutTree('项目', nodes, label, true)
    for (const level of [1, 2, 3]) {
      const row = layout.boxes.filter((b) => b.depth === level).sort((a, b) => a.x - b.x)
      for (let i = 1; i < row.length; i++) {
        const prev = row[i - 1]
        const cur = row[i]
        if (!prev || !cur) continue
        expect(cur.x - cur.width / 2).toBeGreaterThanOrEqual(prev.x + prev.width / 2)
      }
    }
    expect(layout.boxes.find((b) => b.id === 'p4')?.hiddenBranch).toBe(true)
  })

  it('staggers neighbouring leaves and draws smooth curves with straight centre lines', () => {
    const layout = layoutTree('项目', nodes, label, false)
    const leaves = ['p2', 'p3'].map((id) => layout.boxes.find((b) => b.id === id)?.y)
    expect(Math.abs((leaves[0] ?? 0) - (leaves[1] ?? 0))).toBe(TREE_STYLE.leafStagger)
    const curve = layout.edges.find((e) => e.to === 'p1')?.d ?? ''
    expect(curve).toMatch(/^M[\d.]+ [\d.]+C/)
    const single = layout.edges.find((e) => e.to === 'w1')?.d ?? ''
    const xs = [...single.matchAll(/([\d.]+) [\d.]+/g)].map((m) => Number(m[1]))
    expect(new Set(xs.map((x) => Math.round(x))).size).toBe(1)
  })

  it('shortens long labels but keeps the full one, and measures CJK wider', () => {
    const long = [node('s', null, { name: '这是一个非常非常长的空间名称用于测试' })]
    const box = layoutTree('项目', long, label, false).boxes.find((b) => b.id === 's')
    expect(box?.label.endsWith('…')).toBe(true)
    expect(box?.fullLabel).toBe('这是一个非常非常长的空间名称用于测试')
    expect(textWidth('中文')).toBeGreaterThan(textWidth('ab'))
  })

  it('can grow upwards like the reference picture', () => {
    const up = layoutTree('项目', nodes, label, false, { ...TREE_STYLE, orientation: 'up' })
    const root = up.boxes.find((b) => b.id === ROOT_ID)
    const space = up.boxes.find((b) => b.id === 's1')
    expect(space?.y ?? 0).toBeLessThan(root?.y ?? 0)
  })
})

describe('groupEllipse', () => {
  it('encloses the node and its children', () => {
    const layout = layoutTree('项目', nodes, label, false)
    const ellipse = groupEllipse(layout, 's1')
    expect(ellipse).not.toBeNull()
    for (const id of ['s1', 'p1', 'p2', 'p3']) {
      const b = layout.boxes.find((x) => x.id === id)
      if (!b || !ellipse) continue
      for (const [dx, dy] of [
        [-b.width / 2, -b.height / 2],
        [b.width / 2, b.height / 2],
      ]) {
        const nx = (b.x + (dx ?? 0) - ellipse.cx) / ellipse.rx
        const ny = (b.y + (dy ?? 0) - ellipse.cy) / ellipse.ry
        expect(nx * nx + ny * ny).toBeLessThanOrEqual(1)
      }
    }
  })
})
