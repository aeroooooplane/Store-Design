import { useCallback, useState } from 'react'

/** Where 显示间距 is remembered: one choice for every step and project in this browser. */
const KEY = 'workbench.showSpacing'

function stored(): boolean {
  try {
    // On unless the user turned it off (10-16: on by default).
    return window.localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

/**
 * 显示间距 on the editor's plan: on by default, and the choice carries over to the next step
 * the user opens (and to the next visit), since each step mounts its own editor.
 */
export function useSpacingPreference(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(stored)
  const set = useCallback((next: boolean) => {
    setOn(next)
    try {
      window.localStorage.setItem(KEY, next ? 'on' : 'off')
    } catch {
      // Private browsing: the choice lasts for this editor only.
    }
  }, [])
  return [on, set]
}
