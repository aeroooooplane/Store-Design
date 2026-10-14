// Hand-made irregular shop shapes for tests (docs/irregular-shop-plan.md). Test-only: not exported
// from the package index. Plan coordinates in metres, x right, z down; the front is at the bottom.
import { SpaceSchema } from '../schemas/space.ts'
import type { Space, SpaceInput } from '../schemas/space.ts'

const space = (input: Omit<SpaceInput, 'schemaVersion' | 'height'>): Space =>
  SpaceSchema.parse({ schemaVersion: 1, height: 3.2, ...input })

/** L shape, 65 ㎡: 10 m across the back, the front-right 5 × 5 m cut away; entrance on the left leg. */
export const lShape = space({
  boundary: [
    [0, 0],
    [10, 0],
    [10, 4],
    [5, 4],
    [5, 9],
    [0, 9],
  ],
  entrances: [{ a: [1, 9], b: [4, 9], kind: 'main' }],
})

/** Trapezoid, 72 ㎡: back 8 m, front 10 m, the right wall slants; a side door in the slanted wall. */
export const trapezoid = space({
  boundary: [
    [0, 0],
    [8, 0],
    [10, 8],
    [0, 8],
  ],
  entrances: [
    { a: [3, 8], b: [7, 8], kind: 'main' },
    { a: [8.5, 2], b: [9.5, 6], kind: 'side' },
  ],
})

/**
 * Concave back, 62 ㎡: a 6 × 3 m block (stock room) stands into the shop from the middle of the
 * back wall, leaving two 2 m wide arms behind it — too narrow for an island table.
 */
export const concave = space({
  boundary: [
    [0, 0],
    [2, 0],
    [2, 3],
    [8, 3],
    [8, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ],
  entrances: [{ a: [3, 8], b: [7, 8], kind: 'main' }],
})

/** Chamfered corner, 78 ㎡: 10 × 8 m with the front-right corner cut at 45°, the entrance on the cut. */
export const chamfer = space({
  boundary: [
    [0, 0],
    [10, 0],
    [10, 6],
    [8, 8],
    [0, 8],
  ],
  entrances: [{ a: [8, 8], b: [10, 6], kind: 'main' }],
})

/** Arc storefront bulging 1 m, as 8 straight pieces from (10, 7) round to (0, 7) (radius 13 m). */
export const ARC = [
  [10, 7],
  [8.793, 7.434],
  [7.55, 7.748],
  [6.281, 7.937],
  [5, 8],
  [3.719, 7.937],
  [2.45, 7.748],
  [1.207, 7.434],
  [0, 7],
] as const satisfies readonly (readonly [number, number])[]

const arcPoint = (i: number): [number, number] => {
  const [x, z] = ARC[i] ?? ARC[0]
  return [x, z]
}

/**
 * Arc front, 76.6 ㎡: 10 m wide, 7 m deep at the sides, the storefront an arc of 8 pieces (edges
 * 2–9). The middle four pieces are one main entrance; the outer two on each side are open.
 */
export const arcFront = space({
  boundary: [[0, 0], [10, 0], ...ARC.map((_, i) => arcPoint(i))],
  entrances: [{ a: arcPoint(2), b: arcPoint(6), kind: 'main' }],
  openEdges: [
    { a: arcPoint(0), b: arcPoint(2) },
    { a: arcPoint(6), b: arcPoint(8) },
  ],
})

export const IRREGULAR_SHAPES = { lShape, trapezoid, concave, chamfer, arcFront } as const
