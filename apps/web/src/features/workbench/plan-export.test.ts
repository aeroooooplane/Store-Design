/**
 * Characterization tests: they pin the current behaviour of standaloneSvg before refactoring.
 * exportPlan's PNG step needs a real canvas and image decoding, which jsdom lacks; it is not
 * covered here. jsdom does not resolve CSS custom properties (var(--ink)) and reports
 * "depends on user agent" for font-family, so styles are asserted per property.
 */
import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliveryLegend, rectangleSpace } from '@store/shared'
import type { Layout, LayoutItem, Space } from '@store/shared'
import { PlanView } from './PlanView.tsx'
import { standaloneSvg } from './plan-export.ts'

const STYLE_ORDER = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'paint-order',
  'opacity',
  'font-family',
  'font-weight',
  'display',
  'visibility',
]

/** The inline style of every element of an exported SVG, in document order. */
function styles(text: string): Map<string, string>[] {
  return [...text.matchAll(/ style="([^"]*)"/g)].map(
    (m) =>
      new Map(
        (m[1] ?? '').split(';').map((pair) => {
          const at = pair.indexOf(':')
          return [pair.slice(0, at), pair.slice(at + 1)] as [string, string]
        }),
      ),
  )
}

const withoutStyles = (text: string) => text.replace(/ style="[^"]*"/g, '')

let cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.forEach((fn) => fn())
  cleanups = []
  cleanup()
  vi.restoreAllMocks()
})

function mount(css: string, markup: string): SVGSVGElement {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  const host = document.createElement('div')
  host.innerHTML = markup
  document.body.append(host)
  cleanups.push(() => {
    style.remove()
    host.remove()
  })
  return host.querySelector('svg') as SVGSVGElement
}

const PLAN_CSS = `
  svg.plan * { vector-effect: non-scaling-stroke; }
  svg.plan pattern * { vector-effect: none; }
  .plan-lease { fill: none; stroke: #d0021b; stroke-width: 1.5px; }
  .plan-open-edge { stroke-width: 1px; stroke-dasharray: 6 4; }
  .plan-hatch-line { stroke-width: 0.006; }
  .plan-label { paint-order: stroke; stroke-linejoin: round; }
`
const PLAN_MARKUP =
  '<svg class="plan" viewBox="0 0 10 5">' +
  '<defs><pattern id="h"><path class="plan-hatch-line" d="M0 0V1"/></pattern></defs>' +
  '<polygon class="plan-lease" points="0,0 10,0 10,5"/>' +
  '<line class="plan-open-edge" x1="0" y1="0" x2="1" y2="0"/>' +
  '<rect width="1" height="1" fill="#ffd200"/>' +
  '<text class="plan-label">T</text>' +
  '</svg>'

describe('standaloneSvg', () => {
  it('sizes the file to the output width and the viewBox aspect, with the SVG namespace', () => {
    const svg = mount(PLAN_CSS, PLAN_MARKUP)
    const text = standaloneSvg(svg, 400)
    expect(text.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"')).toBe(true)
    expect(text).toContain(' width="400" height="200"')

    const odd = mount('', '<svg viewBox="0 0 3 2"><rect width="1" height="1"/></svg>')
    // 1000 × 2 / 3 = 666.67, rounded.
    expect(standaloneSvg(odd, 1000)).toContain(' width="1000" height="667"')
  })

  it('inlines the computed styles in a fixed order and drops class attributes', () => {
    const svg = mount(PLAN_CSS, PLAN_MARKUP)
    const text = standaloneSvg(svg, 400)
    expect(text).not.toContain('class=')
    const all = styles(text)
    // svg, defs, pattern, path, polygon, line, rect, text: every element gets a style.
    expect(all).toHaveLength(8)
    expect([...(all[0]?.keys() ?? [])]).toEqual(STYLE_ORDER)
    // Elements under the non-scaling rule end with it; the pattern contents do not.
    expect([...(all[4]?.keys() ?? [])]).toEqual([...STYLE_ORDER, 'vector-effect'])
    expect(all[4]?.get('vector-effect')).toBe('non-scaling-stroke')
    expect(all[3]?.has('vector-effect')).toBe(false)
    expect(all[0]?.has('vector-effect')).toBe(false)
    // A label's white halo is drawn first, so it does not cover the text in the file (10-16:
    // the spacing numbers were missing from the delivery PDFs).
    expect(all[7]?.get('paint-order')).toBe('stroke')
  })

  it('keeps print colours: CSS colours as computed values, attribute colours as they are', () => {
    const svg = mount(PLAN_CSS, PLAN_MARKUP)
    const text = standaloneSvg(svg, 400)
    const lease = styles(text)[4]
    expect(lease?.get('stroke')).toBe('rgb(208, 2, 27)')
    // Whatever the engine computes is copied as is.
    const polygon = svg.querySelector('polygon') as SVGElement
    expect(lease?.get('fill')).toBe(getComputedStyle(polygon).getPropertyValue('fill'))
    expect(styles(text)[5]?.get('stroke-dasharray')).toBe('6 4')
    expect(withoutStyles(text)).toContain('<rect width="1" height="1" fill="#ffd200"/>')
  })

  it('widens non-scaling strokes by output width ÷ on-screen width', () => {
    const svg = mount(PLAN_CSS, PLAN_MARKUP)
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ width: 200 } as DOMRect)
    const all = styles(standaloneSvg(svg, 800))
    // × 4: 1.5px → 6px, 1px → 4px.
    expect(all[4]?.get('stroke-width')).toBe('6px')
    expect(all[5]?.get('stroke-width')).toBe('4px')
    // Pattern lines keep their computed width (no vector-effect).
    const hatch = svg.querySelector('path') as SVGElement
    expect(all[3]?.get('stroke-width')).toBe(
      getComputedStyle(hatch).getPropertyValue('stroke-width'),
    )
    expect(all[3]?.get('stroke-width')).not.toBe('0.024px')
  })

  it('treats an unlaid-out drawing (width 0) as already at output size', () => {
    const svg = mount(PLAN_CSS, PLAN_MARKUP)
    expect(svg.getBoundingClientRect().width).toBe(0)
    expect(styles(standaloneSvg(svg, 800))[4]?.get('stroke-width')).toBe('1.5px')
  })

  it('leaves the on-screen drawing unchanged', () => {
    const svg = mount(PLAN_CSS, PLAN_MARKUP)
    const before = svg.outerHTML
    standaloneSvg(svg, 400)
    expect(svg.outerHTML).toBe(before)
    expect(svg.getAttribute('width')).toBeNull()
  })
})

describe('standaloneSvg of a numbered delivery plan', () => {
  const space: Space = {
    ...rectangleSpace(6, 4, 3),
    entrances: [{ a: [2, 4], b: [4, 4], kind: 'main' }],
  }
  const item = (id: string, fn: LayoutItem['function'], name: string, cx: number): LayoutItem => ({
    id,
    assetId: null,
    function: fn,
    name,
    cx,
    cz: 2,
    rotation: 0,
    w: 1.2,
    d: 0.6,
    h: 0.9,
    placeholder: false,
    locked: false,
  })
  const layout: Layout = {
    schemaVersion: 3,
    items: [
      item('c', 'side_cabinet', '配件柜', 1),
      item('a', 'island_table', '中岛桌', 3),
      item('b', 'side_cabinet', '配件柜', 5),
    ],
    planning: null,
  }

  function exported() {
    const legend = deliveryLegend(layout.items, new Map())
    const { container } = render(
      createElement(PlanView, { space, layout, numbers: legend.numbers, title: '交付平面' }),
    )
    const svg = container.querySelector('svg') as SVGSVGElement
    return { legend, svg, text: standaloneSvg(svg, 4000) }
  }

  it('numbers the legend by function, then name; equal props share a number', () => {
    const { legend } = exported()
    expect(legend.entries.map((e) => [e.no, e.name, e.count])).toEqual([
      [1, '中岛桌', 1],
      [2, '配件柜', 2],
    ])
    expect(legend.numbers).toEqual({ a: 1, b: 2, c: 2 })
  })

  it('exports at 4000 px wide with the plan’s aspect', () => {
    const { svg, text } = exported()
    expect(svg.getAttribute('viewBox')).toBe('-0.666 -0.666 7.332 5.5520000000000005')
    expect(text).toContain(' width="4000" height="3029"')
  })

  it('draws yellow numbered badges in layout order instead of names', () => {
    const plain = withoutStyles(exported().text)
    const badges = [...plain.matchAll(/<rect [^>]*fill="#ffd200"\/>/g)]
    expect(badges).toHaveLength(3)
    const numbers = [...plain.matchAll(/<text [^>]*fill="#1f2328"[^>]*>(\d+)<\/text>/g)].map(
      (m) => m[1],
    )
    expect(numbers).toEqual(['02', '01', '02'])
    expect(plain).not.toContain('H:900mm')

    const first = plain.slice(plain.indexOf('<g><rect x="0.9285"'))
    expect(first.slice(0, first.indexOf('</g>') + 4)).toMatchInlineSnapshot(
      `"<g><rect x="0.9285" y="1.9285" width="0.14300000000000002" height="0.14300000000000002" rx="0.028600000000000004" fill="#ffd200"/><text x="1" y="2" font-size="0.08294" font-weight="700" fill="#1f2328" text-anchor="middle" dominant-baseline="central">02</text></g>"`,
    )
  })

  it('keeps the flow arrow, entrance label, dimensions and area', () => {
    const plain = withoutStyles(exported().text)
    expect(plain.match(/<polygon [^>]*fill="#36495c"\/>/g)).toHaveLength(2)
    expect(plain).toMatch(/fill="#36495c"[^>]*>主客流方向<\/text>/)
    expect(plain).toContain('>主入口</text>')
    const dims = [...plain.matchAll(/transform="rotate\([^"]*\)">(\d+)<\/text>/g)].map((m) => m[1])
    expect(dims).toMatchInlineSnapshot(`
      [
        "6000",
        "4000",
        "2000",
        "2000",
        "2000",
        "4000",
      ]
    `)
    expect(plain).toContain('>面积 24.0 m² · 层高 3000 mm</text>')
  })
})
