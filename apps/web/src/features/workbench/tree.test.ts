import { describe, expect, it } from 'vitest'
import type { NodeSummary } from '@store/shared'
import { copyName, flattenTree, freshName, spaceAncestor, stageOf, stageParentId } from './tree.ts'
import { defaultNodeId } from './Workbench.tsx'

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
    createdAt: new Date(Date.UTC(2026, 9, 9, 0, seq)).toISOString(),
    ...overrides,
  } satisfies NodeSummary
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
  it('maps kinds to stages, old edit nodes to the plan stage', () => {
    expect(['space', 'plan', 'edit', 'white', 'render'].map((k) => stageOf(k as never))).toEqual([
      'space',
      'plan',
      'plan',
      'white',
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
    expect(stageParentId(list, at('w1'))).toBe('pl')
    // The old chain white → edit → white: a copy of the inner white goes under the edit (plan level).
    expect(stageParentId(list, at('w2'))).toBe('ed')
    expect(stageParentId(list, at('rd'))).toBe('w2')
  })

  it('numbers copies and fresh names without clashing', () => {
    expect(copyName('方案 A', [])).toBe('方案 A 副本2')
    expect(copyName('方案 A 副本2', ['方案 A 副本2'])).toBe('方案 A 副本3')
    expect(freshName('白模确认', [])).toBe('白模确认')
    expect(freshName('白模确认', ['白模确认', '白模确认（2）'])).toBe('白模确认（3）')
  })
})
