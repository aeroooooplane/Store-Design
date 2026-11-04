import { useState } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeSummary } from '@store/shared'
import { makeNodeSummary } from '../../test-utils/factories.ts'
import { json, stubFetch } from '../../test-utils/fake-api.ts'
import type { RecordedCall } from '../../test-utils/fake-api.ts'
import { renderWithClient } from '../../test-utils/render.tsx'
import { HistoryTree, HistoryViewProvider, nodeLabel } from './HistoryTree.tsx'

const PID = '11111111-1111-4111-8111-111111111111'
const S1 = '22222222-2222-4222-8222-222222222222'
const P1 = '33333333-3333-4333-8333-333333333333'

const createdAt = '2026-10-10T03:00:00.000Z'
const nodes = [
  makeNodeSummary(S1, null, { name: '一层空间', createdAt }),
  makeNodeSummary(P1, S1, { name: '方案 · 按面积推荐', strategy: 'area', createdAt }),
]
let calls: RecordedCall[] = []

beforeEach(() => {
  localStorage.clear()
  ;({ calls } = stubFetch(() =>
    json(200, { ...nodes[1], projectId: PID, space: null, layout: null }),
  ))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderTree(onSelect = vi.fn(), selectedId: string | null = P1) {
  // This tree keeps React Query's default retries.
  renderWithClient(
    <HistoryTree
      projectId={PID}
      projectName="南京德基"
      nodes={nodes}
      selectedId={selectedId}
      draftBaseId={P1}
      onSelect={onSelect}
      onNewSpace={vi.fn()}
      newSpaceDisabled={false}
    />,
    { client: new QueryClient() },
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
    expect(screen.getByRole('img', { name: '南京德基' })).toBeTruthy()
    expect(document.querySelectorAll('.history-canvas text')).toHaveLength(0)
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
    const before = plan.querySelector('.tree-node')?.getAttribute('cx')
    fireEvent.pointerDown(plan, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(plan, { clientX: 160, clientY: 120 })
    fireEvent.pointerUp(plan, { clientX: 160, clientY: 120 })
    expect(onSelect).not.toHaveBeenCalled()
    expect(Number(plan.querySelector('.tree-node')?.getAttribute('cx'))).toBe(Number(before) + 60)
    expect(JSON.parse(localStorage.getItem(`store-design:tree-offsets:${PID}`) ?? '{}')).toEqual({
      [P1]: [60, 20],
    })
    fireEvent.click(screen.getByRole('button', { name: '重置位置' }))
    expect(plan.querySelector('.tree-node')?.getAttribute('cx')).toBe(before)
  })

  it('shows accessible hover names and highlights a branch without moving any node or the viewport', () => {
    const branchNodes = [
      ...nodes,
      makeNodeSummary('sibling', S1, { name: '另一个方案' }),
      makeNodeSummary('child', P1, { kind: 'white', name: '三维甲' }),
    ]
    function Harness() {
      const [selectedId, select] = useState<string | null>(P1)
      return (
        <HistoryTree
          projectId={PID}
          projectName="南京德基"
          nodes={branchNodes}
          selectedId={selectedId}
          draftBaseId={P1}
          onSelect={select}
          onNewSpace={vi.fn()}
          newSpaceDisabled={false}
        />
      )
    }
    renderWithClient(<Harness />)
    const snapshot = () => ({
      points: Array.from(document.querySelectorAll('.tree-node')).map((n) => [
        n.getAttribute('cx'),
        n.getAttribute('cy'),
      ]),
      frame: screen.getByRole('group', { name: '历史树图' }).getAttribute('viewBox'),
    })
    const before = snapshot()
    const plan = screen.getByRole('button', { name: '方案 · 按面积推荐（有草稿）' })
    fireEvent.pointerEnter(plan)
    expect(screen.getByRole('tooltip').textContent).toContain('方案 · 按面积推荐')
    expect(screen.getByRole('tooltip').textContent).toContain('有草稿')
    expect(snapshot()).toEqual(before)
    expect(document.querySelector('[data-node-id="child"]')?.classList.contains('unrelated')).toBe(
      false,
    )
    expect(
      document.querySelector('[data-node-id="sibling"]')?.classList.contains('unrelated'),
    ).toBe(true)
    const sibling = document.querySelector('[data-node-id="sibling"]')!
    fireEvent.keyDown(sibling, { key: 'Enter' })
    expect(snapshot()).toEqual(before)
    expect(sibling.getAttribute('aria-current')).toBe('true')
    expect(plan.classList.contains('unrelated')).toBe(true)
    fireEvent.focus(sibling)
    expect(screen.getByRole('tooltip').textContent).toContain('另一个方案')
    fireEvent.keyDown(sibling, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('preserves enlarged view, offsets and viewport when the workbench remounts a node panel', () => {
    function Harness() {
      const [selectedId, select] = useState(S1)
      return (
        <HistoryViewProvider>
          <HistoryTree
            key={selectedId}
            projectId={PID}
            projectName="南京德基"
            nodes={nodes}
            selectedId={selectedId}
            draftBaseId={null}
            onSelect={select}
            onNewSpace={vi.fn()}
            newSpaceDisabled={false}
          />
        </HistoryViewProvider>
      )
    }
    renderWithClient(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    const space = screen.getByRole('button', { name: '空间 · 一层空间' })
    const frame = screen.getByRole('group', { name: '历史树图' }).getAttribute('viewBox')
    fireEvent.pointerDown(space, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(space, { clientX: -400, clientY: 100 })
    fireEvent.pointerUp(space)
    const x = space.querySelector('.tree-node')?.getAttribute('cx')
    fireEvent.keyDown(screen.getByRole('button', { name: '方案 · 按面积推荐' }), { key: 'Enter' })
    expect(screen.getByRole('button', { name: '还原' })).toBeTruthy()
    expect(screen.getByRole('group', { name: '历史树图' }).getAttribute('viewBox')).toBe(frame)
    expect(
      screen
        .getByRole('button', { name: '空间 · 一层空间' })
        .querySelector('.tree-node')
        ?.getAttribute('cx'),
    ).toBe(x)
  })

  it('keeps other nodes and the viewport fixed while dragging beyond the old bounds, and restores saved offsets on remount', () => {
    const select = renderTree()
    const plan = screen.getByRole('button', { name: '方案 · 按面积推荐（有草稿）' })
    const svg = screen.getByRole('group', { name: '历史树图' })
    const frame = svg.getAttribute('viewBox')
    const root = document.querySelector('.tree-root .tree-node')!
    const rootPosition = root.outerHTML
    fireEvent.pointerDown(plan, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(plan, { pointerId: 1, clientX: -200, clientY: 140 })
    fireEvent.pointerUp(plan, { pointerId: 1 })
    expect(select).not.toHaveBeenCalled()
    expect(svg.getAttribute('viewBox')).toBe(frame)
    expect(root.outerHTML).toBe(rootPosition)
    const moved = plan.querySelector('.tree-node')?.outerHTML
    cleanup()
    renderTree()
    expect(document.querySelector(`[data-node-id="${P1}"] .tree-node`)?.outerHTML).toBe(moved)
    fireEvent.click(screen.getByRole('button', { name: '重置位置' }))
    expect(JSON.parse(localStorage.getItem(`store-design:tree-offsets:${PID}`) ?? '{}')).toEqual({})
    expect(screen.getByRole('group', { name: '历史树图' }).getAttribute('viewBox')).toBe(frame)
  })

  it('fits newly added nodes and removes obsolete saved offsets without mixing projects', () => {
    function Harness() {
      const [list, setList] = useState(nodes)
      const [projectId, setProjectId] = useState(PID)
      return (
        <>
          <button
            onClick={() => setList([...nodes, makeNodeSummary('added', S1, { name: '新增方案' })])}
          >
            增加节点
          </button>
          <button onClick={() => setList([nodes[0]!])}>删除方案</button>
          <button onClick={() => setProjectId('second-project')}>切换项目</button>
          <HistoryViewProvider key={projectId}>
            <HistoryTree
              projectId={projectId}
              projectName="项目"
              nodes={list}
              selectedId={S1}
              draftBaseId={null}
              onSelect={vi.fn()}
              onNewSpace={vi.fn()}
              newSpaceDisabled={false}
            />
          </HistoryViewProvider>
        </>
      )
    }
    renderWithClient(<Harness />)
    const plan = screen.getByRole('button', { name: '方案 · 按面积推荐' })
    fireEvent.pointerDown(plan, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(plan, { clientX: 410, clientY: 10 })
    fireEvent.pointerUp(plan)
    fireEvent.click(screen.getByRole('button', { name: '增加节点' }))
    const [left, top, width, height] = screen
      .getByRole('group', { name: '历史树图' })
      .getAttribute('viewBox')!
      .split(' ')
      .map(Number) as [number, number, number, number]
    for (const dot of document.querySelectorAll('.tree-node')) {
      expect(Number(dot.getAttribute('cx'))).toBeGreaterThan(left)
      expect(Number(dot.getAttribute('cx'))).toBeLessThan(left + width)
      expect(Number(dot.getAttribute('cy'))).toBeGreaterThan(top)
      expect(Number(dot.getAttribute('cy'))).toBeLessThan(top + height)
    }
    fireEvent.click(screen.getByRole('button', { name: '删除方案' }))
    expect(JSON.parse(localStorage.getItem(`store-design:tree-offsets:${PID}`) ?? '{}')).toEqual({})
    const space = screen.getByRole('button', { name: '空间 · 一层空间' })
    const before = space.querySelector('.tree-node')?.getAttribute('cx')
    fireEvent.pointerDown(space, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(space, { clientX: 110, clientY: 10 })
    fireEvent.pointerUp(space)
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    fireEvent.click(screen.getByRole('button', { name: '切换项目' }))
    expect(screen.getByRole('button', { name: '放大' })).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: '空间 · 一层空间' })
        .querySelector('.tree-node')
        ?.getAttribute('cx'),
    ).toBe(before)
    expect(screen.getByRole('button', { name: '重置位置' }).hasAttribute('disabled')).toBe(true)
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

  it('hides the selected step with the eye button and shows the hidden ones with the switch', async () => {
    renderTree()
    // Two rows at most: the icon row and the row with the current step and the switch.
    expect(screen.getByRole('toolbar', { name: '历史操作' })).toBeTruthy()
    expect(screen.getByText(/当前：方案 · 按面积推荐/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '隐藏' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: `/api/v1/nodes/${P1}/hide`,
      }),
    )
    expect(screen.getByRole('switch', { name: '显示已隐藏' })).toBeTruthy()
  })
})
