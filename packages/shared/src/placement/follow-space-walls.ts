import { wallShift } from '../geometry/follow-walls.ts'
import { itemFootprint } from '../schemas/layout.ts'
import type { Layout } from '../schemas/layout.ts'
import type { Space } from '../schemas/space.ts'
import { roundM } from '../units.ts'

/** Moves unlocked props resting against changed walls, leaving all other placements for validation. */
export function followSpaceWalls(layout: Layout, before: Space, after: Space): Layout {
  return {
    ...layout,
    items: layout.items.map((item) => {
      if (item.locked) return item
      const [dx, dz] = wallShift(itemFootprint(item), before.boundary, after.boundary)
      return dx === 0 && dz === 0
        ? item
        : { ...item, cx: roundM(item.cx + dx), cz: roundM(item.cz + dz) }
    }),
  }
}
