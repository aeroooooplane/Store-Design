import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import canvasHtml from './outline-sketch.html?raw'
import type { SpaceSketch } from './space-sketch.ts'

const rectangle: SpaceSketch['points'] = [
  [0, 0],
  [8000, 0],
  [8000, 6000],
  [0, 6000],
]

function mountCanvas(overrides: Partial<SpaceSketch> = {}) {
  const doc = new DOMParser().parseFromString(canvasHtml, 'text/html')
  const svg = doc.querySelector('svg')!
  const script = doc.querySelector('body script')?.textContent
  if (!script) throw Error('Canvas script is missing')
  const frame = Object.assign(new EventTarget(), { parent: window })
  Object.defineProperties(svg, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
    setPointerCapture: { value: vi.fn() },
  })
  runInNewContext(script, {
    document: doc,
    window: frame,
    ResizeObserver: class {
      observe() {}
    },
    structuredClone,
  })
  const state: SpaceSketch = {
    shop: 'side_hall',
    closed: true,
    points: rectangle,
    height: 3200,
    columns: [],
    openings: [],
    edge: 0,
    mainEdge: -1,
    ...overrides,
  }
  const submit = vi.fn<(message: { type: string; state: SpaceSketch }) => void>()
  const message = Object.assign(new Event('message'), {
    source: window,
    data: { type: 'store-space-capture', state, fixedObstacles: [] },
    ports: [{ postMessage: submit }],
  })
  frame.dispatchEvent(message)
  const locate = (node: number) => doc.querySelector(`[data-node-mark="${node}"]`)!
  const anchorX = Number(locate(0).getAttribute('cx'))
  const anchorY = Number(locate(0).getAttribute('cy'))
  const scale = (Number(locate(1).getAttribute('cx')) - anchorX) / 8000
  function pointer(type: string, x: number, y: number, target: Element = svg, altKey = false) {
    const event = new MouseEvent(type, {
      clientX: anchorX + x * scale,
      clientY: anchorY + y * scale,
      bubbles: true,
      altKey,
    })
    target.dispatchEvent(Object.assign(event, { pointerId: 1, pointerType: 'mouse' }))
  }
  return {
    pointer,
    doc,
    snap: () => doc.querySelector('.column-wall-snap'),
    alt: (held: boolean) =>
      frame.dispatchEvent(
        new KeyboardEvent(held ? 'keydown' : 'keyup', { key: 'Alt', altKey: held }),
      ),
    click: (selector: string) => doc.querySelector<HTMLButtonElement>(selector)!.click(),
    saved() {
      doc.querySelector<HTMLButtonElement>('[data-action="next"]')!.click()
      return submit.mock.lastCall?.[0].state.columns
    },
  }
}

describe('column wall snap in the captured space', () => {
  it('uses the same column edge position for the preview and the saved square column', () => {
    const canvas = mountCanvas()
    canvas.click('[data-column-kind="square"]')
    canvas.pointer('pointermove', 4000, 360)
    expect(canvas.snap()).not.toBeNull()
    canvas.alt(true)
    expect(canvas.snap()).toBeNull()
    canvas.alt(false)
    expect(canvas.snap()).not.toBeNull()

    canvas.pointer('click', 4000, 360)
    expect(canvas.saved()).toEqual([{ kind: 'square', x: 4000, y: 300, width: 600, depth: 600 }])
  })

  it('skips complete and partial openings, and still snaps a circle to the outside wall face', () => {
    const canvas = mountCanvas({
      openings: [{ mode: 'partial', start: 3000, width: 2000 }, null, { mode: 'full' }, null],
    })
    canvas.click('[data-column-kind="circle"]')
    canvas.pointer('pointermove', 4000, 360)
    expect(canvas.snap()).toBeNull()
    canvas.pointer('pointermove', 4000, 5660)
    expect(canvas.snap()).toBeNull()
    canvas.pointer('pointermove', 1800, -360)
    expect(canvas.snap()).not.toBeNull()

    canvas.pointer('click', 1800, -360)
    expect(canvas.saved()).toEqual([{ kind: 'circle', x: 1800, y: -300, width: 600, depth: 600 }])
  })

  it('lets an existing column drag and release with Alt for free placement', () => {
    const column = { kind: 'circle' as const, x: 4000, y: 1000, width: 600, depth: 600 }
    const canvas = mountCanvas({ columns: [column] })
    canvas.pointer(
      'pointerdown',
      column.x,
      column.y,
      canvas.doc.querySelector('[data-column="0"]')!,
    )
    canvas.pointer('pointermove', 4000, 350)
    expect(canvas.snap()).not.toBeNull()
    canvas.alt(true)
    expect(canvas.snap()).toBeNull()
    canvas.alt(false)
    expect(canvas.snap()).not.toBeNull()
    canvas.alt(true)
    canvas.pointer('pointerup', 4000, 350, undefined, true)
    expect(canvas.saved()).toEqual([{ ...column, y: 350 }])
  })

  it('touches a diagonal wall with the square corner without rotating the column', () => {
    const canvas = mountCanvas({
      points: [
        [0, 0],
        [8000, 0],
        [0, 8000],
      ],
    })
    canvas.click('[data-column-kind="square"]')
    canvas.pointer('click', 3600, 3900)
    const saved = canvas.saved()?.[0]
    expect(saved?.x).toBeCloseTo(3550)
    expect(saved?.y).toBeCloseTo(3850)
  })
})
