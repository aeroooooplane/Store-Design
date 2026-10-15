import { useState } from 'react'
import { DISPLAY_PPT_VIEWS } from '@store/shared'
import type { DisplayPptViews } from '@store/shared'

const KEY = 'store-design.display.pptViews'

/** The last choice, for exports made away from the selector (the delivery). */
export function storedPptViews(): DisplayPptViews {
  try {
    const value = localStorage.getItem(KEY)
    return DISPLAY_PPT_VIEWS.find((v) => v === value) ?? 'both'
  } catch {
    return 'both'
  }
}

/** Which pages each table gets in the PPT; the last choice is kept for the next export. */
export function usePptViews() {
  const [views, setViews] = useState<DisplayPptViews>(storedPptViews)
  const choose = (value: DisplayPptViews) => {
    setViews(value)
    try {
      localStorage.setItem(KEY, value)
    } catch {
      // Private mode: the choice lasts for this page only.
    }
  }
  return [views, choose] as const
}
