import type { FrontAxis } from '../schemas/asset.ts'
import type { Rotation } from '../schemas/layout.ts'

/** A unit direction on the plan, as [x, z]. */
export type PlanDirection = readonly [number, number]

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270]

const FRONT_VECTORS: Record<Exclude<FrontAxis, 'any'>, PlanDirection> = {
  '+Z': [0, 1],
  '-Z': [0, -1],
  '+X': [1, 0],
  '-X': [-1, 0],
}

/**
 * Where a model's front points after a layout rotation. Same convention as the legacy viewer
 * (three.js rotation.y = −rotation): a quarter turn takes +Z to −X.
 */
export function facingAfter(front: Exclude<FrontAxis, 'any'>, rotation: Rotation): PlanDirection {
  const [x, z] = FRONT_VECTORS[front]
  const theta = (-rotation * Math.PI) / 180
  const cos = Math.round(Math.cos(theta))
  const sin = Math.round(Math.sin(theta))
  return [x * cos + z * sin + 0, -x * sin + z * cos + 0]
}

/** The rotation that turns a model's front towards `direction`, or null if it has no front. */
export function rotationFacing(front: FrontAxis | null, direction: PlanDirection): Rotation | null {
  if (front === null || front === 'any') return null
  return (
    ROTATIONS.find((r) => {
      const [x, z] = facingAfter(front, r)
      return x === direction[0] && z === direction[1]
    }) ?? null
  )
}
