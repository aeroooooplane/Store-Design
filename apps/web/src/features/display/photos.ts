import type { DisplayRulesView, SiStyle } from '@store/shared'

/** The tray picture of a unit: the store's SI first, the guide's render before a real photo. */
export function photoOf(photos: DisplayRulesView['photos'], unit: string | null, si: SiStyle) {
  if (!unit) return null
  const rank = (p: DisplayRulesView['photos'][number]) =>
    (p.si === si ? 0 : 2) + (p.kind === 'render' ? 0 : 1)
  return photos.filter((p) => p.unit === unit).sort((a, b) => rank(a) - rank(b))[0] ?? null
}
