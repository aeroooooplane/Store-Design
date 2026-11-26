import { describe, expect, it } from 'vitest'
import type { NodeSummary } from '@store/shared'
import { makeNodeSummary } from '../../test-utils/factories.ts'
import {
  freshName,
  nextHistoryName,
  nextRenderName,
  nextSpaceRevisionName,
  spaceAncestor,
  stageOf,
  stageParentId,
} from '@store/shared'
import { flattenTree } from './tree.ts'
import { defaultNodeId } from './Workbench.tsx'

let seq = 0
function node(id: string, parentId: string | null, overrides: Partial<NodeSummary> = {}) {
  seq += 1
  const createdAt = new Date(Date.UTC(2026, 9, 9, 0, seq)).toISOString()
  return makeNodeSummary(id, parentId, { createdAt, ...overrides })
}

const nodes = [
  node('s1', null),
  node('p1', 's1'),
  node('e1', 'p1', { kind: 'edit', hidden: true }),
  node('w1', 'e1', { kind: 'white' }),
  node('p2', 's1'),
  node('s2', 's1', { kind: 'space' }),
  node('p3', 's2'),
  node('orphan', 'missing', { kind: 'edit' }),
]

describe('flattenTree', () => {
  it('orders depth-first and marks everything below a hidden node', () => {
    expect(flattenTree(nodes).map((e) => [e.node.id, e.depth, e.hiddenBranch])).toEqual([
      ['s1', 0, false],
      ['p1', 1, false],
      ['e1', 2, true],
      ['w1', 3, true],
      ['p2', 1, false],
      ['s2', 1, false],
      ['p3', 2, false],
      ['orphan', 0, false],
    ])
  })
})

describe('spaceAncestor', () => {
  it('finds the nearest space at or above a node', () => {
    expect(spaceAncestor(nodes, 'w1')).toBe('s1')
    expect(spaceAncestor(nodes, 'p3')).toBe('s2')
    expect(spaceAncestor(nodes, 's2')).toBe('s2')
  })

  it('returns null without a space above, for unknown ids and on cycles', () => {
    expect(spaceAncestor(nodes, 'orphan')).toBeNull()
    expect(spaceAncestor(nodes, 'nope')).toBeNull()
    const cycle = [node('a', 'b', { kind: 'edit' }), node('b', 'a', { kind: 'edit' })]
    expect(spaceAncestor(cycle, 'a')).toBeNull()
  })
})

describe('defaultNodeId', () => {
  const draft = {
    projectId: '00000000-0000-4000-8000-000000000000',
    baseNodeId: 'p1',
    layout: { schemaVersion: 3 as const, items: [], planning: null },
    revision: 1,
    updatedAt: '2026-10-09T00:00:00.000Z',
  }

  it('prefers the draft base, then the newest visible node', () => {
    expect(defaultNodeId(nodes, draft)).toBe('p1')
    expect(defaultNodeId(nodes, { ...draft, baseNodeId: 'gone' })).toBe('orphan')
    expect(defaultNodeId(nodes.slice(0, 4), null)).toBe('p1')
    expect(defaultNodeId([], null)).toBeNull()
  })
})

describe('stages', () => {
  it('maps old edit and white nodes to the plan stage', () => {
    expect(['space', 'plan', 'edit', 'white', 'render'].map((k) => stageOf(k as never))).toEqual([
      'space',
      'plan',
      'plan',
      'plan',
      'render',
    ])
  })

  it('puts copies next to the original, lifting deeply nested old nodes back to their stage', () => {
    const list = [
      node('sp', null),
      node('pl', 'sp'),
      node('w1', 'pl', { kind: 'white' }),
      node('ed', 'w1', { kind: 'edit' }),
      node('w2', 'ed', { kind: 'white' }),
      node('rd', 'w2', { kind: 'render' }),
    ]
    const at = (id: string) => list.find((n) => n.id === id) as NodeSummary
    expect(stageParentId(list, at('pl'))).toBe('sp')
    expect(stageParentId(list, at('w1'))).toBe('sp')
    expect(stageParentId(list, at('w2'))).toBe('sp')
    expect(stageParentId(list, at('rd'))).toBe('w2')
  })

  it('continues the highest space version and cleans only old default suffixes', () => {
    expect(nextSpaceRevisionName('空间 A（修改）（修改）', ['空间 A · v5', '空间 B · v9'])).toBe(
      '空间 A · v6',
    )
    expect(nextSpaceRevisionName('旗舰店（东区） · v2', ['旗舰店（东区） · 改墙（2）'])).toBe(
      '旗舰店（东区） · v4',
    )
    expect(nextSpaceRevisionName('空间 A（修改）（修改）', [])).toBe('空间 A · v4')
  })

  it('numbers copies and fresh names without clashing', () => {
    expect(nextHistoryName('plan', ['方案 A', '方案 C · SI2.0'])).toBe('方案 D')
    expect(nextHistoryName('plan', ['方案 Z'], '尽量少放')).toBe('方案 AA · 尽量少放')
    expect(nextHistoryName('space', ['空间 A · v2', '空间 B（修改）'])).toBe('空间 C')
    expect(nextRenderName(['渲染', '渲染（4）', '客户提案渲染'])).toBe('渲染 5')
    expect(freshName('白模', [])).toBe('白模')
    expect(freshName('白模', ['白模', '白模（2）'])).toBe('白模（3）')
  })
})
