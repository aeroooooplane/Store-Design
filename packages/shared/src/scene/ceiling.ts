import type { ShopType, SiStyle } from '../enums.ts'
import type { CeilingKind, Space } from '../schemas/space.ts'
import { mToMm } from '../units.ts'

const SIDE: readonly CeilingKind[] = ['film', 'linear']
const ISLAND: readonly CeilingKind[] = ['frame', 'none']

export function ceilingChoices(shop: ShopType): readonly CeilingKind[] {
  return shop === 'side_hall' ? SIDE : shop === 'island' ? ISLAND : []
}

function si2Grade(space: Space) {
  const facade = space.facade
  if (!facade) return undefined
  if ('kind' in facade && facade.kind === 'corner') {
    const [a, b] = facade.faces.map((face) => face.si2?.grade)
    return a && b && a !== b ? undefined : (a ?? b)
  }
  return 'si2' in facade ? facade.si2?.grade : undefined
}

export function recommendedCeiling(space: Space, shop: ShopType, si: SiStyle): CeilingKind {
  if (shop === 'zone') return 'none'
  if (shop === 'island') return 'frame'
  if (si === 'SI1.0') return mToMm(space.height) > 2800 ? 'film' : 'linear'
  const grade = si2Grade(space)
  return grade === 'B' || grade === 'C' ? 'linear' : 'film'
}

export function effectiveCeiling(space: Space, shop: ShopType, si: SiStyle): CeilingKind {
  return space.ceiling && ceilingChoices(shop).includes(space.ceiling)
    ? space.ceiling
    : recommendedCeiling(space, shop, si)
}

export function ceilingLabel(kind: CeilingKind, si: SiStyle) {
  switch (kind) {
    case 'film':
      return '软膜透光天花'
    case 'linear':
      return si === 'SI1.0' ? '石膏板磁吸轨道灯天花' : '石膏板线性灯条天花'
    case 'frame':
      return '框架天花'
    case 'none':
      return '无天花'
  }
}
