import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Space } from '@store/shared'
import { SpaceEditor } from './SpaceEditor.tsx'

afterEach(cleanup)

function renderEditor(initial?: Space) {
  const onSubmit = vi.fn<(space: Space, name: string) => void>()
  const view = render(<SpaceEditor initial={initial} submitting={false} onSubmit={onSubmit} />)
  const submitted = () => {
    fireEvent.click(screen.getByRole('button', { name: '保存空间' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    return onSubmit.mock.calls[0]?.[0] as Space
  }
  const marked = () =>
    [...view.container.querySelectorAll('.space-edge-mark')].map((line) =>
      Number(line.parentElement?.getAttribute('data-edge')),
    )
  return { submitted, marked }
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const change = (label: string, value: string | number) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value: String(value) } })
const valueOf = (label: string) => screen.getByLabelText<HTMLInputElement>(label).value

describe('SpaceEditor', () => {
  it('builds an L shape from a template, then sets a storefront and an open edge', () => {
    const { submitted, marked } = renderEditor()
    click('模板')
    change('模板', 'l')
    change('缺口宽（左右）', 5000)
    click('多边形')
    // The template's front edge (edge 5) is selected and highlighted.
    expect(marked()).toEqual([4])

    // The two walls of the notch become an open edge.
    change('起始边', 1)
    change('结束边', 2)
    expect(marked()).toEqual([1, 2])
    click('设为开放边')

    // Narrow the main entrance to 4 m of the front.
    change('起始边', 4)
    change('起点（距边起点）', 2000)
    change('终点（距边起点）', 6000)
    click('设为主入口')
    expect(screen.getByText(/原来的主入口（其余 2 段）已恢复为墙/)).toBeTruthy()

    const space = submitted()
    expect(space.boundary).toEqual([
      [0, 0],
      [5, 0],
      [5, 3],
      [10, 3],
      [10, 8],
      [0, 8],
    ])
    expect(space.height).toBe(3.2)
    expect(space.entrances).toEqual([{ a: [8, 8], b: [4, 8], kind: 'main' }])
    expect(space.openEdges).toEqual([
      { a: [5, 0], b: [5, 3] },
      { a: [5, 3], b: [10, 3] },
    ])
  })

  it('keeps the edge and coordinate tables in sync and shows the closing error', () => {
    const { submitted, marked } = renderEditor()
    click('多边形')
    // Focusing a row of the edge table selects that edge.
    fireEvent.focusIn(screen.getByLabelText('边 2 长度'))
    expect(marked()).toEqual([1])
    change('边 2 长度', 4000)
    // The last edge still says 6000 mm, but 4000 mm closes the ring.
    expect(screen.getByText(/闭合误差 2000 mm/)).toBeTruthy()

    click('坐标')
    expect(valueOf('顶点 3 z')).toBe('4000')
    expect(valueOf('顶点 4 z')).toBe('4000')
    change('顶点 3 x', 9000)
    click('逐边')
    expect(valueOf('边 2 长度')).toBe('4123.1')
    expect(screen.getByText(/闭合误差 0 mm/)).toBeTruthy()

    // A 45° left turn on edge 2 keeps edge 1 and turns everything after it.
    change('边 2 转向', 'left')
    change('边 2 角度', 45)
    expect(valueOf('边 2 角度')).toBe('45')
    click('坐标')
    expect(valueOf('顶点 2 x')).toBe('8000')
    expect(valueOf('顶点 3 x')).toBe('10915')
    expect(valueOf('顶点 3 z')).toBe('-2915')

    expect(submitted().boundary).toHaveLength(4)
  })

  it('turns the front edge into an arc and makes it the main storefront', () => {
    const { submitted, marked } = renderEditor()
    click('多边形')
    expect(marked()).toEqual([2])
    change('段数', 4)
    click('改为弧线')
    expect(marked()).toEqual([2, 3, 4, 5])
    click('设为主入口')

    const space = submitted()
    expect(space.boundary).toHaveLength(7)
    expect(space.boundary[4]).toEqual([4, 7])
    expect(space.entrances).toHaveLength(4)
    expect(space.entrances.every((e) => e.kind === 'main')).toBe(true)
    expect(space.entrances[0]).toMatchObject({ b: [4, 7] })
  })

  it('inserts and deletes vertices without losing unrelated entrances', () => {
    const { submitted } = renderEditor()
    click('多边形')
    click('坐标')
    click('在顶点 2 与顶点 3 之间插入顶点')
    expect(valueOf('顶点 3 z')).toBe('3000')
    // A 200 mm jog is allowed, with a warning.
    change('顶点 3 z', 5800)
    expect(screen.getByText(/边 3 只有 200 mm/)).toBeTruthy()
    click('删除顶点 3')
    click('删除顶点 2')

    const space = submitted()
    expect(space.boundary).toEqual([
      [0, 0],
      [8, 6],
      [0, 6],
    ])
    // The front entrance did not touch the deleted vertices and stays.
    expect(space.entrances).toEqual([{ a: [8, 6], b: [0, 6], kind: 'main' }])
  })

  it('keeps open edges, obstacle details and entrances across edges when editing', () => {
    const initial: Space = {
      schemaVersion: 1,
      boundary: [
        [0, 0],
        [8, 0],
        [8, 6],
        [4, 6],
        [0, 6],
      ],
      height: 3.2,
      entrances: [{ a: [6, 6], b: [2, 6], kind: 'main' }],
      openEdges: [{ a: [8, 1], b: [8, 3] }],
      obstacles: [
        {
          kind: 'fixed',
          label: '展台',
          height: 1.2,
          polygon: [
            [2, 2],
            [3, 2],
            [2.5, 3],
          ],
        },
        {
          kind: 'shaft',
          label: '管井',
          height: 2.5,
          polygon: [
            [5, 1],
            [6, 1],
            [6, 2],
            [5, 2],
          ],
        },
      ],
      calibration: null,
    }
    const { submitted } = renderEditor(initial)
    expect(screen.getByText('该障碍物为多边形，只能删除或原样保留')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^删除边 \d 上的/ })).toHaveLength(3)

    const space = submitted()
    expect(space.openEdges).toEqual(initial.openEdges)
    expect(space.obstacles[0]).toEqual(initial.obstacles[0])
    expect(space.obstacles[1]).toMatchObject({ kind: 'shaft', height: 2.5, label: '管井' })
    expect(space.entrances).toEqual([
      { a: [6, 6], b: [4, 6], kind: 'main' },
      { a: [4, 6], b: [2, 6], kind: 'main' },
    ])
  })
})
