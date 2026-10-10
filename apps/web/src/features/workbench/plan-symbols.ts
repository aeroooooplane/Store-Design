import { createElement, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { SYMBOL_MARGIN_M } from './plan-drawing.ts'
import type { SymbolSize } from './plan-drawing.ts'

/**
 * Plan symbols are drawn inline (not as <image>) so their lines keep a constant on-screen
 * width at any zoom; 1.2 mm strokes scaled to a whole shop would all but vanish. The SVG is
 * reduced to plain shapes and drawing attributes: no scripts, links, styles or handlers.
 */
const SHAPES = new Set(['g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path'])
const ATTRIBUTES: Record<string, string> = {
  x: 'x',
  y: 'y',
  width: 'width',
  height: 'height',
  rx: 'rx',
  ry: 'ry',
  cx: 'cx',
  cy: 'cy',
  r: 'r',
  x1: 'x1',
  y1: 'y1',
  x2: 'x2',
  y2: 'y2',
  points: 'points',
  d: 'd',
  transform: 'transform',
  fill: 'fill',
  stroke: 'stroke',
  // Read as screen pixels (non-scaling strokes), so outlines stay heavier than details.
  'stroke-width': 'strokeWidth',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'fill-rule': 'fillRule',
  opacity: 'opacity',
}
/** Scale of the symbol files' stroke widths (read as screen pixels). */
const LINE_WEIGHT = 0.5

/** Only colours, numbers, path data and simple transforms; nothing that can reference a URL. */
const SAFE_VALUE = /^[\w\s.,#%()+-]*$/

export interface SymbolShape {
  tag: string
  attrs: Record<string, string>
  children: SymbolShape[]
}

export interface PlanSymbol {
  /** Drawn size in metres, without the transparent margin. */
  size: SymbolSize
  /** Centre of the drawing in its own units (millimetres). */
  center: [number, number]
  shapes: SymbolShape[]
}

function readShape(element: Element): SymbolShape | null {
  const tag = element.tagName.toLowerCase()
  if (!SHAPES.has(tag)) return null
  const attrs: Record<string, string> = {}
  for (const { name, value } of Array.from(element.attributes)) {
    const prop = ATTRIBUTES[name]
    if (!prop || !SAFE_VALUE.test(value) || /url\s*\(/i.test(value)) continue
    // Drawn at half the file's weight: symbols read lighter than walls and furniture blocks.
    attrs[prop] = prop === 'strokeWidth' ? String(Number(value) * LINE_WEIGHT) : value
  }
  const children = Array.from(element.children)
    .map(readShape)
    .filter((s): s is SymbolShape => s !== null)
  return { tag, attrs, children }
}

export function parsePlanSymbol(text: string): PlanSymbol | null {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc.documentElement
  if (root.tagName.toLowerCase() !== 'svg') return null
  const box = (root.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const [minX = 0, minY = 0, width = 0, height = 0] = box
  if (box.length !== 4 || box.some((v) => !Number.isFinite(v)) || width <= 0 || height <= 0) {
    return null
  }
  const size = { w: width / 1000 - SYMBOL_MARGIN_M * 2, d: height / 1000 - SYMBOL_MARGIN_M * 2 }
  if (size.w <= 0 || size.d <= 0) return null
  const shapes = Array.from(root.children)
    .map(readShape)
    .filter((s): s is SymbolShape => s !== null)
  return { size, center: [minX + width / 2, minY + height / 2], shapes }
}

export function renderShapes(shapes: readonly SymbolShape[], prefix = 's'): ReactNode[] {
  return shapes.map((shape, i) =>
    createElement(
      shape.tag,
      { key: `${prefix}${i}`, ...shape.attrs },
      ...renderShapes(shape.children, `${prefix}${i}-`),
    ),
  )
}

const cache = new Map<string, Promise<PlanSymbol | null>>()

function loadSymbol(url: string): Promise<PlanSymbol | null> {
  let symbol = cache.get(url)
  if (!symbol) {
    symbol = fetch(url)
      .then((response) => (response.ok ? response.text() : ''))
      .then((text) => (text ? parsePlanSymbol(text) : null))
      .catch(() => null)
    cache.set(url, symbol)
  }
  return symbol
}

/** Loads (once per page) and returns the plan symbols for these URLs as they arrive. */
export function usePlanSymbols(urls: readonly string[]): ReadonlyMap<string, PlanSymbol> {
  const [symbols, setSymbols] = useState<ReadonlyMap<string, PlanSymbol>>(new Map())
  const key = [...new Set(urls)].sort().join('\n')
  useEffect(() => {
    if (!key) return
    let alive = true
    const list = key.split('\n')
    void Promise.all(list.map(async (url) => [url, await loadSymbol(url)] as const)).then(
      (entries) => {
        if (!alive) return
        const next = new Map<string, PlanSymbol>()
        for (const [url, symbol] of entries) if (symbol) next.set(url, symbol)
        setSymbols(next)
      },
    )
    return () => {
      alive = false
    }
  }, [key])
  return symbols
}
