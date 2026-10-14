import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WALL_THICKNESS_M, rectangleSpace, sceneFrame } from '@store/shared'
import type { Layout, Point, Space } from '@store/shared'
import { PlanView } from './PlanView.tsx'

afterEach(cleanup)

const round = (v: number) => Math.round(v * 1000) / 1000

/** 7 m wide, 6 m deep at the sides, a 4-piece arc front bulging 0.8 m. */
function arcShop(extra: Partial<Space>): Space {
  const arc = [0, 1, 2, 3, 4].map((i): [number, number] => [
    round(7 - 1.75 * i),
    round(6 + 0.8 * Math.sin((Math.PI * i) / 4)),
  ])
  return {
    ...rectangleSpace(7, 6.8, 3),
    boundary: [[0, 0], [7, 0], ...arc],
    entrances: [],
    ...extra,
  }
}
/** The whole arc front is the main entrance. */
const arcFront = () => arcShop({ entrances: [{ a: [7, 6], b: [0, 6], kind: 'main' }] })

const lines = (svg: Element, selector: string) =>
  [...svg.querySelectorAll(selector)].map((line) =>
    ['x1', 'y1', 'x2', 'y2'].map((name) => Number(line.getAttribute(name))),
  )
const labels = (svg: Element) =>
  [...svg.querySelectorAll('text')].filter((text) => text.textContent === '主入口')

function plan(space: Space, numbers?: Record<string, number>) {
  const layout: Layout = { schemaVersion: 3, items: [], planning: null }
  const { container } = render(
    <PlanView space={space} layout={layout} numbers={numbers} title="平面" />,
  )
  return container.querySelector('svg') as SVGSVGElement
}

describe('PlanView openings across several edges', () => {
  it('draws an arc entrance along its four pieces, labelled once at the middle of the arc', () => {
    const space = arcFront()
    const svg = plan(space)
    const arc = space.boundary.slice(2)
    expect(lines(svg, 'line.plan-entrance')).toEqual(
      arc.slice(1).map((q, i) => [...(arc[i] as Point), ...q]),
    )
    expect([...svg.querySelectorAll('line.plan-entrance title')].map((t) => t.textContent)).toEqual(
      ['主入口', '主入口', '主入口', '主入口'],
    )

    const [label, ...more] = labels(svg)
    expect(more).toHaveLength(0)
    // Halfway along the boundary (the top of the arc, not the chord at z = 6), just outside.
    const middle = sceneFrame(space).entrance
    expect(middle[0]).toBeCloseTo(3.5, 6)
    expect(middle[1]).toBeCloseTo(6.8, 6)
    const fontSize = Number(label?.getAttribute('font-size'))
    expect(Number(label?.getAttribute('x'))).toBeCloseTo(3.5, 6)
    expect(Number(label?.getAttribute('y'))).toBeCloseTo(6.8 + WALL_THICKNESS_M + fontSize * 0.9, 6)
  })

  it('starts the delivery flow arrow at the middle of the arc and keeps one label', () => {
    const svg = plan(arcFront(), {})
    expect(labels(svg)).toHaveLength(1)
    const shaft = svg.querySelector('.plan-flow polygon')?.getAttribute('points') ?? ''
    const corners = shaft.split(' ').map((p) => p.split(',').map(Number))
    const [first, , , last] = corners as [number[], number[], number[], number[]]
    // 0.15 m inside the entrance, square to its chord.
    expect(((first[0] ?? 0) + (last[0] ?? 0)) / 2).toBeCloseTo(3.5, 6)
    expect(((first[1] ?? 0) + (last[1] ?? 0)) / 2).toBeCloseTo(6.65, 6)
  })

  it('dashes an open edge piece by piece round a corner and along an arc', () => {
    const corner: Space = {
      ...rectangleSpace(8, 6, 3),
      entrances: [{ a: [3, 6], b: [5, 6], kind: 'main' }],
      openEdges: [{ a: [8, 2], b: [6, 0] }],
    }
    expect(lines(plan(corner), 'line.plan-open-edge')).toEqual([
      [8, 2, 8, 0],
      [8, 0, 6, 0],
    ])
    cleanup()

    const space = arcShop({
      entrances: [{ a: [2, 0], b: [5, 0], kind: 'main' }],
      openEdges: [{ a: [0, 6], b: [7, 6] }],
    })
    const arc = space.boundary.slice(2).reverse()
    expect(lines(plan(space), 'line.plan-open-edge')).toEqual(
      arc.slice(1).map((q, i) => [...(arc[i] as Point), ...q]),
    )
  })

  it('keeps one line per opening within an edge', () => {
    const svg = plan({
      ...rectangleSpace(8, 6, 3),
      entrances: [
        { a: [5, 6], b: [3, 6], kind: 'main' },
        { a: [8, 1], b: [8, 2], kind: 'side' },
      ],
    })
    expect(lines(svg, 'line.plan-entrance')).toEqual([
      [5, 6, 3, 6],
      [8, 1, 8, 2],
    ])
    expect(labels(svg)).toHaveLength(1)
  })
})
