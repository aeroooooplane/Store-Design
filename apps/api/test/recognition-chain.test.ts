import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { VectorContent } from '@store/shared'
import {
  chainLineTest,
  chainScale,
  findDimensionSegments,
  numberWindow,
} from '../src/modules/recognition/local/dimension-chain.ts'
import type { ChainReading } from '../src/modules/recognition/local/dimension-chain.ts'
import { findScale } from '../src/modules/recognition/local/scale.ts'
import {
  cachedReading,
  readDimensionChains,
  readPageTexts,
} from '../src/modules/recognition/ocr.ts'

type Line = VectorContent['lines'][number]

/** A dimension chain: the line, an extension line and a 45° tick at every stop. */
const chain = (horizontal: boolean, at: number, stops: number[]): Line[] => {
  const lines: Line[] = []
  const first = stops[0] ?? 0
  const last = stops.at(-1) ?? 0
  lines.push(
    horizontal
      ? { x1: first - 6, y1: at, x2: last + 6, y2: at }
      : { x1: at, y1: first - 6, x2: at, y2: last + 6 },
  )
  for (const s of stops) {
    const [x, y] = horizontal ? [s, at] : [at, s]
    lines.push({ x1: x - 4, y1: y + 4, x2: x + 4, y2: y - 4 })
    lines.push(
      horizontal
        ? { x1: x, y1: y - 12, x2: x, y2: y + 30 }
        : { x1: x - 12, y1: y, x2: x + 30, y2: y },
    )
  }
  return lines
}

const reading = (mm: number, a: number, b: number, at = 100): ChainReading => ({
  horizontal: true,
  at,
  a,
  b,
  tick: 11,
  mm,
  text: String(mm),
})

describe('dimension chains', () => {
  it('finds the spans between ticks on a drawn line, either way', () => {
    const segments = findDimensionSegments([
      ...chain(true, 200, [100, 280, 460]),
      ...chain(false, 600, [100, 250, 400]),
    ])
    const spans = segments.map((s) => [
      s.horizontal,
      Math.round(s.at),
      Math.round(s.a),
      Math.round(s.b),
    ])
    expect(spans).toEqual([
      [true, 200, 100, 280],
      [true, 200, 280, 460],
      [false, 600, 100, 250],
      [false, 600, 250, 400],
    ])
    // The number is looked for above a horizontal line, left of a vertical one.
    const [above] = segments
    const w = numberWindow(above!)
    expect(w.y + w.h).toBeLessThan(200)
    expect(w.x).toBeGreaterThan(100)
    expect(w.x + w.w).toBeLessThan(280)
    const left = numberWindow(segments[2]!)
    expect(left.x + left.w).toBeLessThan(600)
  })

  it('takes no span where ticks stand without a line between them', () => {
    const ticks = [100, 280].map((x) => ({ x1: x - 4, y1: 204, x2: x + 4, y2: 196 }))
    expect(findDimensionSegments(ticks)).toEqual([])
  })

  it('takes the scale most spans agree on, weighted by length', () => {
    const scale = chainScale([
      reading(1800, 100, 280),
      reading(900, 280, 370),
      reading(3600, 370, 730),
      // Misread: 1000 for 100.
      reading(1000, 730, 740),
    ])
    expect(scale?.used).toHaveLength(3)
    expect(scale?.mmPerPixel).toBeCloseTo(10, 6)
    expect(chainScale([])).toBeNull()
  })

  it('tells the lines of read chains from walls', () => {
    const onChain = chainLineTest([reading(1800, 100, 280, 200)])
    expect(onChain({ x1: 94, y1: 200, x2: 286, y2: 200 })).toBe(true)
    // A wall the chain runs along goes on well beyond it.
    expect(onChain({ x1: 0, y1: 200, x2: 1000, y2: 200 })).toBe(false)
    expect(onChain({ x1: 100, y1: 260, x2: 280, y2: 260 })).toBe(false)
    expect(onChain({ x1: 150, y1: 150, x2: 150, y2: 250 })).toBe(false)
  })

  it('settles the scale by the chains before prop names and areas', () => {
    const chains = [reading(1800, 100, 280), reading(3600, 280, 640)]
    const box = { x: 0, y: 0, w: 600, h: 400 }
    // A prop name that would make it 20 mm per pixel is outweighed.
    const labelled = [
      {
        text: { text: '1.8米中岛桌', x: 10, y: 10, w: 40, h: 10 },
        box: { x: 0, y: 0, w: 90, h: 40 },
        sizeM: 1.8,
        knownM: null,
      },
    ]
    const { scale, notes } = findScale([], [], box, undefined, labelled, undefined, chains)
    expect(scale).toMatchObject({ method: 'dimension', verified: true })
    expect(scale?.mmPerPixel).toBeCloseTo(10, 6)
    expect(scale?.reference).toContain('尺寸链 2 段')
    expect(notes[0]).toContain('尺寸链')
  })
})

describe('reading dimension numbers (local OCR)', () => {
  it('reads the numbers of horizontal and vertical chains from the picture', async () => {
    const lines = [...chain(true, 200, [100, 280, 460]), ...chain(false, 600, [100, 250, 400])]
    const svgLines = lines
      .map(
        (l) =>
          `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="#000" stroke-width="1"/>`,
      )
      .join('')
    const number = (x: number, y: number, text: string, turned = false) =>
      `<text x="0" y="0" transform="translate(${x} ${y})${turned ? ' rotate(-90)' : ''}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="16">${text}</text>`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#fff"/>${svgLines}${number(190, 194, '1800')}${number(370, 194, '1800')}${number(594, 175, '1500', true)}${number(594, 325, '1500', true)}</svg>`
    const picture = await sharp(Buffer.from(svg)).png().toBuffer()
    const content: VectorContent = { width: 800, height: 500, texts: [], lines, rects: [] }
    const readings = await readDimensionChains(picture, content)
    expect(readings.map((r) => [r.horizontal, r.mm])).toEqual([
      [true, 1800],
      [true, 1800],
      [false, 1500],
      [false, 1500],
    ])
    expect(chainScale(readings)?.mmPerPixel).toBeCloseTo(10, 1)
  }, 60_000)

  it('reads the texts of a page whose text is outlines, either way round', async () => {
    const label = (x: number, y: number, text: string, turn = 0) =>
      `<text x="0" y="0" transform="translate(${x} ${y}) rotate(${turn})" font-family="DejaVu Sans, Arial, sans-serif" font-size="20">${text}</text>`
    // A picture of 1200 × 900; the vector content (no texts) is drawn at half that size.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#fff"/>${label(200, 200, 'LOGO WALL')}${label(1000, 700, 'CASHIER 1800', -90)}${label(500, 300, 'TABLE', 90)}</svg>`
    const picture = await sharp(Buffer.from(svg)).png().toBuffer()
    const content: VectorContent = { width: 600, height: 450, texts: [], lines: [], rects: [] }
    const texts = await readPageTexts(picture, content)
    const found = (word: string) => texts.find((t) => t.text.replace(/\s+/g, '').includes(word))
    const wall = found('LOGOWALL')
    expect(wall).toBeDefined()
    // In the vector content's pixels: half the picture's.
    expect(wall?.x).toBeGreaterThan(90)
    expect(wall?.x).toBeLessThan(110)
    expect(wall?.w).toBeGreaterThan(wall?.h ?? Infinity)
    // Bottom to top and top to bottom are both read upright; their boxes stand tall.
    const cashier = found('CASHIER1800')
    expect(cashier).toBeDefined()
    expect(cashier?.h).toBeGreaterThan(cashier?.w ?? Infinity)
    expect(found('TABLE')).toBeDefined()
  }, 60_000)

  it('keeps a reading per key and drops failed ones', async () => {
    let loads = 0
    const load = async () => ++loads
    expect(await cachedReading('test:a', load)).toBe(1)
    expect(await cachedReading('test:a', load)).toBe(1)
    await expect(
      cachedReading('test:b', async () => Promise.reject(new Error('x'))),
    ).rejects.toThrow()
    expect(await cachedReading('test:b', load)).toBe(2)
  })
})
