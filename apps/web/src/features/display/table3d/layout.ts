import type { DisplayTable } from '@store/shared'

/**
 * Where things stand on one display table, in metres, table-local: x to the right and z towards
 * the viewer, who stands on the entrance side (the bottom of the slot diagrams). The top is at
 * y = height. Only the layout lives here; the scene builder decides what stands on each slot.
 */
export interface SlotPlace {
  slot: string
  /** Centre of the tray on the table top. */
  x: number
  z: number
  /** Tray footprint. */
  w: number
  d: number
  hero: boolean
}

export interface TableShape {
  kind: DisplayTable['kind']
  /** Table top extent along x and z, and its height. */
  width: number
  depth: number
  height: number
  slots: SlotPlace[]
  /** The accessory-module strip down the middle of an island table. */
  strip: { x: number; z: number; w: number; d: number } | null
  /** Side tables stand against a wall behind them (−z). */
  wall: boolean
}

const ISLAND = { long: 1.8, short: 0.8, height: 0.9 }
const SIDE = { long: 1.8, short: 0.5, height: 0.9 }

/**
 * Portrait: L1–L3 down the left, R1–R3 down the right (L1 farthest), E at the near end.
 * Landscape: T1–T3 behind, B1–B3 in front, E at the chosen end (T1/B1 next to it).
 * Side: S1–S3 along the wall, left to right.
 */
export function tableShape(table: DisplayTable, end: 'left' | 'right'): TableShape {
  const wanted = new Map(table.slots.map((s) => [s.slot, s.hero]))
  const places: SlotPlace[] = []
  const put = (slot: string, x: number, z: number, w: number, d: number) => {
    if (wanted.has(slot)) places.push({ slot, x, z, w, d, hero: wanted.get(slot) ?? false })
  }
  if (table.kind === 'side') {
    ;['S1', 'S2', 'S3'].forEach((slot, i) => put(slot, (i - 1) * 0.58, 0.02, 0.46, 0.34))
    return {
      kind: 'side',
      width: SIDE.long,
      depth: SIDE.short,
      height: SIDE.height,
      slots: places,
      strip: null,
      wall: true,
    }
  }
  if (table.orientation === 'portrait') {
    ;[-0.62, -0.2, 0.22].forEach((z, row) => {
      put(`L${row + 1}`, -0.21, z, 0.3, 0.36)
      put(`R${row + 1}`, 0.21, z, 0.3, 0.36)
    })
    put('E', 0, 0.66, 0.5, 0.3)
    return {
      kind: 'island',
      width: ISLAND.short,
      depth: ISLAND.long,
      height: ISLAND.height,
      slots: places,
      strip: { x: 0, z: -0.2, w: 0.1, d: 1.2 },
      wall: false,
    }
  }
  // Landscape, drawn with the end on the left and mirrored for the right.
  const side = end === 'left' ? 1 : -1
  ;[-0.24, 0.16, 0.56].forEach((x, col) => {
    put(`T${col + 1}`, x * side, -0.21, 0.36, 0.3)
    put(`B${col + 1}`, x * side, 0.21, 0.36, 0.3)
  })
  put('E', -0.66 * side, 0, 0.3, 0.5)
  return {
    kind: 'island',
    width: ISLAND.long,
    depth: ISLAND.short,
    height: ISLAND.height,
    slots: places,
    strip: { x: 0.16 * side, z: 0, w: 1.2, d: 0.1 },
    wall: false,
  }
}
