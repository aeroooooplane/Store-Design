import { useEffect, useRef, useState } from 'react'
import type { Dispatch } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { DesignNode, Draft, Layout } from '@store/shared'
import { ApiRequestError } from '../../../api/client.ts'
import { deleteDraft, putDraft, workbenchKeys } from '../api.ts'
import type { EditorAction, EditorState } from '../editor-state.ts'
import { EMPTY_LAYOUT } from './empty-layout.ts'

const AUTOSAVE_DELAY_MS = 800

export type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error'

interface DraftAutosaveOptions {
  projectId: string
  baseNode: DesignNode
  /** The shared draft, if it continues this node. */
  draft: Draft | null
  state: EditorState
  dispatch: Dispatch<EditorAction>
}

/**
 * Autosaves the layout to the shared draft (with optimistic locking) and removes, discards or
 * reloads that draft.
 */
export function useDraftAutosave({
  projectId,
  baseNode,
  draft,
  state,
  dispatch,
}: DraftAutosaveOptions) {
  const client = useQueryClient()
  const revision = useRef<number | null>(draft?.revision ?? null)
  const [saveState, setSaveState] = useState<SaveState>(draft ? 'saved' : 'idle')
  const [saveError, setSaveError] = useState<unknown>(null)
  /** The save in flight, so the draft is never removed underneath it. */
  const saving = useRef<Promise<void> | null>(null)
  /** Layout whose save failed; autosave resumes with the next edit. */
  const failed = useRef<Layout | null>(null)
  /** Autosave stops while a version is being created or the draft discarded. */
  const [paused, setPaused] = useState(false)

  // Autosave the draft shortly after the last change, one request at a time. Edits made while a
  // save is in flight stay dirty and are saved next; a conflict stops autosaving.
  useEffect(() => {
    if (!state.dirty || paused || saveState === 'conflict' || saveState === 'saving') return
    if (state.layout === failed.current) return
    const layout = state.layout
    const timer = window.setTimeout(() => {
      setSaveState('saving')
      saving.current = putDraft(projectId, { baseNodeId: baseNode.id, layout }, revision.current)
        .then((saved) => {
          revision.current = saved.draft.revision
          failed.current = null
          dispatch({ type: 'saved', layout })
          setSaveState('saved')
          setSaveError(null)
          client.setQueryData(workbenchKeys.draft(projectId), saved.draft)
        })
        .catch((error: unknown) => {
          const conflict =
            error instanceof ApiRequestError && (error.status === 409 || error.status === 428)
          failed.current = layout
          setSaveState(conflict ? 'conflict' : 'error')
          setSaveError(error)
        })
        .finally(() => {
          saving.current = null
        })
    }, AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
    // Dependencies kept as before: `dispatch` comes from useReducer, is stable and is not listed.
  }, [state.dirty, state.layout, paused, saveState, projectId, baseNode.id, client])

  /** Removes the draft once its content is kept elsewhere (a new node) or thrown away. */
  async function finishDraft() {
    await saving.current
    if (revision.current === null) return
    const key = workbenchKeys.draft(projectId)
    await deleteDraft(projectId, revision.current).then(
      () => client.setQueryData(key, null),
      // Someone else changed it meanwhile: show the page what is really there.
      () => client.invalidateQueries({ queryKey: key }),
    )
    revision.current = null
  }

  async function discard() {
    if (!window.confirm('丢弃后草稿中的修改无法恢复，确定丢弃吗？')) return
    setPaused(true)
    await finishDraft()
    dispatch({ type: 'load', layout: baseNode.layout ?? EMPTY_LAYOUT })
    setSaveState('idle')
    setPaused(false)
  }

  async function reloadDraft() {
    await client.invalidateQueries({ queryKey: workbenchKeys.draft(projectId) })
    const latest = client.getQueryData<Draft | null>(workbenchKeys.draft(projectId))
    revision.current = latest?.revision ?? null
    dispatch({
      type: 'load',
      layout:
        latest?.baseNodeId === baseNode.id ? latest.layout : (baseNode.layout ?? EMPTY_LAYOUT),
    })
    setSaveState(latest ? 'saved' : 'idle')
  }

  return { saveState, saveError, setPaused, finishDraft, discard, reloadDraft }
}
