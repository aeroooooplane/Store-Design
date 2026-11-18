import { nearestQuarter } from '../geometry/index.ts'

const SIZES = new Map([
  ['asset-3021147', 65],
  ['asset-11479197', 75],
  ['asset-11525433', 86],
  ['asset-2500908', 98],
])

/** Original catalogue ids remain readable in existing layouts. */
export const LEGACY_PORTRAIT_SCREENS = new Set(['asset-2597250', 'asset-2595839'])

export function advertisingScreenName(id: string | null | undefined): string | undefined {
  const inches = id ? SIZES.get(id) : undefined
  return inches ? `${inches}寸广告机` : undefined
}

export type ScreenOrientation = 'landscape' | 'portrait'

/** The catalogue footprint is landscape; portrait swaps only face width and height. */
export function portraitScreenFootprint(
  size: { w: number; d: number; h: number },
  rotation: number,
) {
  const quarter = nearestQuarter(rotation)
  return quarter === 90 || quarter === 270
    ? { w: size.w, d: size.h, h: size.d }
    : { w: size.h, d: size.d, h: size.w }
}
