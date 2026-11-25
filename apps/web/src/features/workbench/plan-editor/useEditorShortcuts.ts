import { useEffect, useEffectEvent } from 'react'
import type { Dispatch } from 'react'
import type { EditorAction } from '../editor-state.ts'

interface FurnitureShortcuts {
  copy: (() => void) | undefined
  paste: (() => void) | undefined
  duplicate: (() => void) | undefined
}

/** Modified keys work throughout the editor, leaving native text editing to the browser. */
export function useEditorShortcuts(
  dispatch: Dispatch<EditorAction>,
  furniture: FurnitureShortcuts,
) {
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      !(event.ctrlKey || event.metaKey) ||
      event.altKey
    )
      return

    const target = event.target
    if (
      target instanceof Element &&
      (target.closest('input, textarea, select, [role="textbox"]') ||
        (target instanceof HTMLElement && target.isContentEditable))
    )
      return

    const key = event.key.toLowerCase()
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault()
      dispatch({ type: 'undo' })
      return
    }
    if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault()
      dispatch({ type: 'redo' })
      return
    }
    if (event.shiftKey) return

    const command =
      key === 'c' && !window.getSelection()?.toString()
        ? furniture.copy
        : key === 'v'
          ? furniture.paste
          : key === 'd'
            ? furniture.duplicate
            : undefined
    if (!command) return
    event.preventDefault()
    if (!event.repeat) command()
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => onShortcut(event)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
