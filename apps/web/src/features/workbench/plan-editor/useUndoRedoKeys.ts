import { useEffect } from 'react'
import type { Dispatch } from 'react'
import type { EditorAction } from '../editor-state.ts'

/** Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) anywhere on the page, except while typing in a field. */
export function useUndoRedoKeys(dispatch: Dispatch<EditorAction>) {
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)
      ) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        dispatch({ type: 'undo' })
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault()
        dispatch({ type: 'redo' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // `dispatch` comes from useReducer and never changes, so the listener registers once.
  }, [dispatch])
}
