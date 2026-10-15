import { describe, expect, it } from 'vitest'
import type { DisplayTable } from '@store/shared'
import { tableShape } from './layout.ts'

const table = (
  kind: DisplayTable['kind'],
  orientation: DisplayTable['orientation'],
  slots: string[],
) =>
  ({
    label: 'A',
    kind,
    sourceId: 't',
    plan: { cx: 0, cz: 0, w: 0.8, d: 1.8 },
    orientation,
    ruleTables: 3,
    seat: '3-1',
    slots: slots.map((slot) => ({ slot, unit: null, hero: slot === 'E' || slot === 'B2' })),
    modules: ['C3'],
    endToward: null,
    custom: false,
    notes: [],
  }) as DisplayTable

const at = (shape: ReturnType<typeof tableShape>, slot: string) =>
  shape.slots.find((s) => s.slot === slot)

describe('3D table layout', () => {
  it('portrait: L on the left, R on the right, L1 farthest, the end nearest the viewer', () => {
    const shape = tableShape(
      table('island', 'portrait', ['L1', 'L2', 'L3', 'R1', 'R2', 'R3', 'E']),
      'left',
    )
    expect(shape.depth).toBeGreaterThan(shape.width)
    expect(at(shape, 'L1')?.x).toBeLessThan(0)
    expect(at(shape, 'R1')?.x).toBeGreaterThan(0)
    expect(at(shape, 'L1')?.z).toBeLessThan(at(shape, 'L3')?.z ?? 0)
    expect(at(shape, 'E')?.z).toBeGreaterThan(at(shape, 'L3')?.z ?? 0)
    expect(at(shape, 'E')?.hero).toBe(true)
    expect(shape.slots).toHaveLength(7)
  })

  it('landscape: B row in front, the end and T1/B1 on the chosen side', () => {
    const slots = ['E', 'T1', 'T2', 'T3', 'B1', 'B2', 'B3']
    const left = tableShape(table('island', 'landscape', slots), 'left')
    const right = tableShape(table('island', 'landscape', slots), 'right')
    expect(left.width).toBeGreaterThan(left.depth)
    expect(at(left, 'B1')?.z).toBeGreaterThan(at(left, 'T1')?.z ?? 0)
    expect(at(left, 'E')?.x).toBeLessThan(at(left, 'T1')?.x ?? 0)
    expect(at(right, 'E')?.x).toBeGreaterThan(at(right, 'T1')?.x ?? 0)
    expect(at(right, 'T1')?.x).toBe(-(at(left, 'T1')?.x ?? 0))
  })

  it('side: three slots left to right against the wall, no strip', () => {
    const shape = tableShape(table('side', 'portrait', ['S1', 'S2', 'S3']), 'left')
    expect(shape.wall).toBe(true)
    expect(shape.strip).toBeNull()
    expect(shape.slots.map((s) => s.slot)).toEqual(['S1', 'S2', 'S3'])
    expect(at(shape, 'S1')?.x).toBeLessThan(at(shape, 'S3')?.x ?? 0)
  })

  it('places only the slots the table has', () => {
    const shape = tableShape(table('island', 'portrait', ['L1', 'E']), 'left')
    expect(shape.slots.map((s) => s.slot)).toEqual(['L1', 'E'])
  })
})
