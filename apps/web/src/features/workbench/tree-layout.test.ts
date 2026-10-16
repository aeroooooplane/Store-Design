import { describe, expect, it } from 'vitest'
import type { NodeSummary } from '@store/shared'
import { makeNodeSummary } from '../../test-utils/factories.ts'
import {
  ROOT_ID,
  TREE_STYLE,
  applyOffsets,
  layoutRadial,
  layoutTree,
  textWidth,
} from './tree-layout.ts'

let seq = 0
function node(id: string, parentId: string | null, overrides: Partial<NodeSummary> = {}) {
  seq += 1
  const createdAt = new Date(Date.UTC(2026, 9, 10, 0, seq)).toISOString()
  return makeNodeSummary(id, parentId, { createdAt, ...overrides })
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

describe('applyOffsets', () => {
  it('moves dragged nodes, re-routes their branches and grows the drawing to fit', () => {
    const layout = layoutTree('项目', nodes, label, false)
    const moved = applyOffsets(layout, { p1: [-500, 40] })
    const before = layout.boxes.find((b) => b.id === 'p1')
    const after = moved.boxes.find((b) => b.id === 'p1')
    expect(after?.x).toBe((before?.x ?? 0) - 500)
    expect(after?.y).toBe((before?.y ?? 0) + 40)
    expect(moved.edges.find((e) => e.to === 'p1')?.d).not.toBe(
      layout.edges.find((e) => e.to === 'p1')?.d,
    )
    expect(moved.edges.find((e) => e.from === 'p1')?.d).toMatch(new RegExp(`^M${after?.x} `))
    // Dragged past the left margin: the drawing starts further left.
    expect(moved.x).toBeLessThan(0)
    expect(moved.width).toBeGreaterThan(layout.width)
    expect(applyOffsets(layout, {})).toMatchObject({ x: 0, y: 0, width: layout.width })
  })
})

describe('layoutRadial', () => {
  it('puts the first branching step in the middle with the project hanging below it', () => {
    const layout = layoutRadial('项目', nodes, label, false)
    const box = (id: string) => layout.boxes.find((b) => b.id === id)
    expect(layout.radial).toBe(true)
    // s1 has three plans, so it is the hub; the project is the stem straight below it.
    expect(box(ROOT_ID)?.x).toBeCloseTo(box('s1')?.x ?? 0)
    expect(box(ROOT_ID)?.y ?? 0).toBeGreaterThan(box('s1')?.y ?? 0)
    expect(box(ROOT_ID)).toMatchObject({ level: 'root', depth: 0 })
    expect(box('s1')).toMatchObject({ level: 'branch', depth: 1 })
    expect(box('w1')).toMatchObject({ level: 'leaf', depth: 3 })
    // Every plan is further from the hub than the hub is wide on its own, and w1 further than p1.
    const dist = (id: string) =>
      Math.hypot((box(id)?.x ?? 0) - (box('s1')?.x ?? 0), (box(id)?.y ?? 0) - (box('s1')?.y ?? 0))
    expect(dist('w1')).toBeGreaterThan(dist('p1'))
  })

  it('never lets two boxes overlap and draws straight branches without arrows', () => {
    const layout = layoutRadial('项目', nodes, label, true)
    const boxes = layout.boxes
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        if (!a || !b) continue
        const apartX = Math.abs(a.x - b.x) >= (a.width + b.width) / 2
        const apartY = Math.abs(a.y - b.y) >= (a.height + b.height) / 2
        expect(apartX || apartY).toBe(true)
      }
    }
    expect(layout.edges).toHaveLength(boxes.length - 1)
    expect(layout.edges.every((e) => /^M[\d.]+ [\d.]+L[\d.]+ [\d.]+$/.test(e.d))).toBe(true)
    // Everything lies inside the drawing.
    expect(Math.min(...boxes.map((b) => b.x - b.width / 2))).toBeGreaterThanOrEqual(0)
    expect(Math.max(...boxes.map((b) => b.x + b.width / 2))).toBeLessThanOrEqual(layout.width)
  })

  it('puts the project in the middle when it has several spaces, and survives an empty tree', () => {
    const layout = layoutRadial('项目', nodes, label, true)
    const root = layout.boxes.find((b) => b.id === ROOT_ID)
    const xs = layout.boxes.map((b) => b.x)
    expect((root?.x ?? 0) > Math.min(...xs) && (root?.x ?? 0) < Math.max(...xs)).toBe(true)
    expect(layoutRadial('项目', [], label, false).boxes).toHaveLength(1)
  })

  it('keeps branches straight after a drag', () => {
    const layout = layoutRadial('项目', nodes, label, false)
    const moved = applyOffsets(layout, { p1: [30, 20] })
    expect(moved.edges.find((e) => e.to === 'p1')?.d).toMatch(/^M[\d.]+ [\d.]+L/)
  })
})
