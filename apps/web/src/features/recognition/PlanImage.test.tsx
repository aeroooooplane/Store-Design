import { cleanup, fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_TRACE, PlanImage } from './PlanImage.tsx'
import type { Trace } from './PlanImage.tsx'

afterEach(cleanup)

/** The picture shown at its own size (1 screen pixel = 1 picture pixel), from the top left. */
function mockBox(svg: SVGSVGElement) {
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0 }) as DOMRect
}

function Harness({
  start = EMPTY_TRACE,
  vector = null,
  onChange,
}: {
  start?: Trace
  vector?: {
    width: number
    height: number
    texts: []
    lines: { x1: number; y1: number; x2: number; y2: number }[]
    rects: []
  } | null
  onChange: (trace: Trace) => void
}) {
  const [trace, setTrace] = useState(start)
  return (
    <PlanImage
      url="data:,"
      width={1000}
      height={800}
      tool="trace"
      crop={null}
      onCrop={() => {}}
      calibration={null}
      onCalibrate={() => {}}
      draft={null}
      trace={trace}
      onTrace={(next) => {
        setTrace(next)
        onChange(next)
      }}
      vector={vector}
    />
  )
}

const click = (target: Element, x: number, y: number, init: object = {}) =>
  fireEvent.pointerDown(target, { button: 0, clientX: x, clientY: y, ...init })

describe('tracing a boundary on the picture', () => {
  it('adds points, closes on the first one, and makes every edge a wall', () => {
    const onChange = vi.fn()
    const { container } = render(<Harness onChange={onChange} />)
    const svg = container.querySelector('svg') as SVGSVGElement
    mockBox(svg)
    click(svg, 100, 100)
    click(svg, 500, 100)
    // Shift: straight across from the last point.
    click(svg, 500, 412, { shiftKey: true })
    click(svg, 100, 400)
    click(svg, 104, 103)
    const trace = onChange.mock.lastCall?.[0] as Trace
    expect(trace.closed).toBe(true)
    expect(trace.points).toEqual([
      [100, 100],
      [500, 100],
      [500, 412],
      [100, 400],
    ])
    expect(trace.kinds).toEqual(['wall', 'wall', 'wall', 'wall'])
  })

  it('edits a closed outline: edge kinds, inserted and removed corners', () => {
    const onChange = vi.fn()
    const square: Trace = {
      points: [
        [100, 100],
        [500, 100],
        [500, 400],
        [100, 400],
      ],
      closed: true,
      kinds: ['wall', 'wall', 'wall', 'wall'],
      arc: false,
    }
    const { container } = render(<Harness start={square} onChange={onChange} />)
    mockBox(container.querySelector('svg') as SVGSVGElement)
    // The front edge's label: wall → entrance → open side.
    const label = () => container.querySelector('[data-trace-kind="2"]') as Element
    click(label(), 300, 400)
    expect((onChange.mock.lastCall?.[0] as Trace).kinds[2]).toBe('entrance')
    click(label(), 300, 400)
    expect((onChange.mock.lastCall?.[0] as Trace).kinds[2]).toBe('open')
    // A click on the top edge puts a corner where it was clicked; a double-click takes it out.
    click(container.querySelector('[data-trace-edge="0"] .trace-edge-hit') as Element, 220, 104)
    expect((onChange.mock.lastCall?.[0] as Trace).points[1]).toEqual([220, 100])
    expect((onChange.mock.lastCall?.[0] as Trace).kinds).toEqual([
      'wall',
      'wall',
      'wall',
      'open',
      'wall',
    ])
    fireEvent.doubleClick(container.querySelector('[data-trace-vertex="1"]') as Element)
    expect((onChange.mock.lastCall?.[0] as Trace).points).toEqual(square.points)
    expect((onChange.mock.lastCall?.[0] as Trace).kinds).toEqual(['wall', 'wall', 'open', 'wall'])
  })

  it('draws an arc from the last point through a middle point to its end', () => {
    const onChange = vi.fn()
    const start: Trace = { points: [[100, 300]], closed: false, kinds: [], arc: true }
    const { container } = render(<Harness start={start} onChange={onChange} />)
    const svg = container.querySelector('svg') as SVGSVGElement
    mockBox(svg)
    click(svg, 300, 100)
    expect(onChange).not.toHaveBeenCalled()
    click(svg, 500, 300)
    const trace = onChange.mock.lastCall?.[0] as Trace
    // A half circle of radius 200 round (300, 300): twelve 15° pieces.
    expect(trace.points).toHaveLength(13)
    expect(trace.points.at(-1)).toEqual([500, 300])
    expect(trace.arc).toBe(false)
  })

  it('snaps to the lines of a vector PDF unless Alt is held', () => {
    const onChange = vi.fn()
    const vector = {
      width: 1000,
      height: 800,
      texts: [] as [],
      rects: [] as [],
      lines: [
        { x1: 200, y1: 200, x2: 600, y2: 200 },
        { x1: 200, y1: 200, x2: 200, y2: 600 },
      ],
    }
    const { container } = render(<Harness vector={vector} onChange={onChange} />)
    const svg = container.querySelector('svg') as SVGSVGElement
    mockBox(svg)
    click(svg, 207, 194)
    expect((onChange.mock.lastCall?.[0] as Trace).points.at(-1)).toEqual([200, 200])
    click(svg, 407, 206, { altKey: true })
    expect((onChange.mock.lastCall?.[0] as Trace).points.at(-1)).toEqual([407, 206])
  })
})
