import { describe, expect, it } from 'vitest'
import { parsePlanSymbol } from './plan-symbols.ts'

const svg = (body: string, viewBox = '-18 -18 1836 1036') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`

describe('parsePlanSymbol', () => {
  it('keeps shapes, geometry and line weights, and finds the size and centre', () => {
    const symbol = parsePlanSymbol(
      svg(
        '<g fill="none" stroke="#000000" stroke-linecap="round"><rect x="0" y="0" width="1800" height="1000" rx="50" stroke-width="2"/><circle cx="275" cy="230" r="12" stroke-width="1.2"/></g>',
      ),
    )
    expect(symbol?.size).toEqual({ w: 1.8, d: 1 })
    expect(symbol?.center).toEqual([900, 500])
    const group = symbol?.shapes[0]
    expect(group).toMatchObject({
      tag: 'g',
      attrs: { fill: 'none', stroke: '#000000', strokeLinecap: 'round' },
    })
    expect(group?.children.map((c) => [c.tag, c.attrs])).toEqual([
      ['rect', { x: '0', y: '0', width: '1800', height: '1000', rx: '50', strokeWidth: '2' }],
      ['circle', { cx: '275', cy: '230', r: '12', strokeWidth: '1.2' }],
    ])
  })

  it('drops scripts, foreign content, styles, links, handlers and url() references', () => {
    const symbol = parsePlanSymbol(
      svg(
        '<script>alert(1)</script><foreignObject><div>x</div></foreignObject><style>*{}</style>' +
          '<a href="https://example.com"><rect width="1" height="1"/></a>' +
          '<rect width="10" height="10" onclick="alert(1)" style="fill:red" fill="url(#x)" href="#y" stroke="#000"/>',
      ),
    )
    expect(symbol?.shapes).toEqual([
      { tag: 'rect', attrs: { width: '10', height: '10', stroke: '#000' }, children: [] },
    ])
  })

  it('rejects files that are not usable symbols', () => {
    expect(parsePlanSymbol('<html></html>')).toBeNull()
    expect(parsePlanSymbol(svg('<rect/>', '0 0 20 20'))).toBeNull()
    expect(parsePlanSymbol(svg('<rect/>', 'bad'))).toBeNull()
  })
})
