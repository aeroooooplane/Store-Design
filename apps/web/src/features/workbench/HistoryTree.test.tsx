import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeSummary } from '@store/shared'
import { HistoryTree, nodeLabel } from './HistoryTree.tsx'

const PID = '11111111-1111-4111-8111-111111111111'
const S1 = '22222222-2222-4222-8222-222222222222'
const P1 = '33333333-3333-4333-8333-333333333333'

const summary = (id: string, parentId: string | null, overrides: Partial<NodeSummary> = {}) =>
  ({
    id,
    parentId,
    kind: parentId === null ? 'space' : 'plan',
    name: parentId === null ? '一层空间' : '方案 · 按面积推荐',
    strategy: parentId === null ? null : 'area',
    siStyle: null,
    origin: 'user',
    importedFrom: null,
    hidden: false,
    createdAt: '2026-10-10T03:00:00.000Z',
    ...overrides,
  }) satisfies NodeSummary

const nodes = [summary(S1, null), summary(P1, S1)]
const calls: { method: string; path: string; body: unknown }[] = []

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const text = request.method === 'GET' ? '' : await request.text()
      calls.push({
        method: request.method,
        path: new URL(request.url).pathname,
        body: text ? JSON.parse(text) : undefined,
      })
      return new Response(
        JSON.stringify({ ...nodes[1], projectId: PID, space: null, layout: null }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderTree(onSelect = vi.fn(), selectedId: string | null = P1) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HistoryTree
        projectId={PID}
        projectName="南京德基"
        nodes={nodes}
        selectedId={selectedId}
        draftBaseId={P1}
        onSelect={onSelect}
        onNewSpace={vi.fn()}
        newSpaceDisabled={false}
      />
    </QueryClientProvider>,
  )
  return onSelect
}

describe('nodeLabel', () => {
  it('adds the kind only when the name lacks it', () => {
    expect(nodeLabel(nodes[0] as NodeSummary)).toBe('空间 · 一层空间')
    expect(nodeLabel(nodes[1] as NodeSummary)).toBe('方案 · 按面积推荐')
  })
})

describe('HistoryTree', () => {
  it('draws the project as root and opens steps by click or keyboard', () => {
    const onSelect = renderTree()
    expect(document.querySelector('.tree-root text')?.textContent).toBe('南京德基')
    const space = screen.getByRole('button', { name: '空间 · 一层空间' })
    fireEvent.pointerDown(space, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(space, { clientX: 10, clientY: 10 })
    expect(onSelect).toHaveBeenLastCalledWith(S1)
    fireEvent.keyDown(screen.getByRole('button', { name: '方案 · 按面积推荐（有草稿）' }), {
      key: 'Enter',
    })
    expect(onSelect).toHaveBeenLastCalledWith(P1)
    expect(document.querySelector('ellipse')).toBeNull()
  })

  it('drags a node without opening it, remembers where, and resets', () => {
    localStorage.clear()
    const onSelect = renderTree()
    const plan = screen.getByRole('button', { name: '方案 · 按面积推荐（有草稿）' })
    const before = plan.querySelector('rect')?.getAttribute('x')
    fireEvent.pointerDown(plan, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(plan, { clientX: 160, clientY: 120 })
    fireEvent.pointerUp(plan, { clientX: 160, clientY: 120 })
    expect(onSelect).not.toHaveBeenCalled()
    expect(Number(plan.querySelector('rect')?.getAttribute('x'))).toBe(Number(before) + 60)
    expect(JSON.parse(localStorage.getItem(`store-design:tree-offsets:${PID}`) ?? '{}')).toEqual({
      [P1]: [60, 20],
    })
    fireEvent.click(screen.getByRole('button', { name: '重置位置' }))
    expect(plan.querySelector('rect')?.getAttribute('x')).toBe(before)
  })

  it('renames the selected step and can fold the diagram away', async () => {
    renderTree()
    fireEvent.click(screen.getByRole('button', { name: '改名' }))
    fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '方案 · 主推' } })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
        path: `/api/v1/nodes/${P1}`,
        body: { name: '方案 · 主推' },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: '收起树图' }))
    expect(screen.queryByRole('group', { name: '历史树图' })).toBeNull()
  })
})
