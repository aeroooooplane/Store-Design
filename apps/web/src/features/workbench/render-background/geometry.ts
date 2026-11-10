import { isSimplePolygon } from '@store/shared'
import type { BackgroundPoint } from '@store/shared'

/** Match the server's photo-coordinate polygon validation. */
export function validMask(points: BackgroundPoint[]): boolean {
  return points.length >= 3 && points.length <= 100 && isSimplePolygon(points, 1e-9)
}
