import type { Dispatch, KeyboardEvent } from 'react'
import type { Asset, LayoutItem } from '@store/shared'
import type { EditorAction } from '../editor-state.ts'

/**
 * Editing the selected prop from the canvas keyboard (arrows nudge, R rotates, Delete removes,
 * Escape deselects) and the 90° rotate buttons.
 */
export function useEditorKeys(
  selected: LayoutItem | null,
  assetMap: Map<string, Asset>,
  dispatch: Dispatch<EditorAction>,
) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!selected) return
    const step = event.shiftKey ? 0.1 : 0.01
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      dispatch({ type: 'nudge', id: selected.id, dx: move[0], dz: move[1] })
    } else if (event.key === 'r' || event.key === 'R') {
      dispatch({
        type: 'rotate',
        id: selected.id,
        asset: selected.assetId ? assetMap.get(selected.assetId) : undefined,
      })
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      dispatch({ type: 'remove', id: selected.id })
    } else if (event.key === 'Escape') {
      dispatch({ type: 'select', id: null })
    }
  }

  const rotateSelected = (by: 90 | -90) => {
    if (!selected) return
    dispatch({
      type: 'rotate',
      id: selected.id,
      by,
      asset: selected.assetId ? assetMap.get(selected.assetId) : undefined,
    })
  }

  return { onKeyDown, rotateSelected }
}
