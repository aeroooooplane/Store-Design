import { useCallback, useEffect, useRef, useState } from 'react'
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
  draft: Draft | null
  state: EditorState
  dispatch: Dispatch<EditorAction>
}

/** Saves one node's working layout and serializes writes for that node. */
export function useDraftAutosave({
  projectId,
  baseNode,
  draft,
  state,
  dispatch,
}: DraftAutosaveOptions) {
  const client = useQueryClient()
  const nodeId = baseNode.id
  const revision = useRef<number | null>(draft?.revision ?? null)
  const latest = useRef(state)
  latest.current = state
  const savedLayout = useRef(state.layout)
  const saving = useRef<Promise<boolean> | null>(null)
  const failed = useRef<Layout | null>(null)
  const conflicted = useRef(false)
  const discarding = useRef(false)
  const [saveState, setSaveState] = useState<SaveState>(draft ? 'saved' : 'idle')
  const [saveError, setSaveError] = useState<unknown>(null)

  const hasUnsaved = useCallback(
    () =>
      saving.current !== null ||
      (latest.current.dirty && latest.current.layout !== savedLayout.current),
    [],
  )

  const flush = useCallback(async (): Promise<boolean> => {
    const key = workbenchKeys.drafts(projectId)
    while (hasUnsaved()) {
      if (conflicted.current || discarding.current) return false
      if (!saving.current) {
        const { layout } = latest.current
        setSaveState('saving')
        saving.current = putDraft(projectId, { baseNodeId: nodeId, layout }, revision.current)
          .then(async ({ draft: saved }) => {
            revision.current = saved.revision
            failed.current = null
            await client.cancelQueries({ queryKey: key })
            client.setQueryData<Draft[]>(key, (drafts = []) => [
              saved,
              ...drafts.filter((entry) => entry.baseNodeId !== nodeId),
            ])
            savedLayout.current = layout
            dispatch({ type: 'saved', layout })
            setSaveState('saved')
            setSaveError(null)
            return true
          })
          .catch((error: unknown) => {
            conflicted.current =
              error instanceof ApiRequestError && (error.status === 409 || error.status === 428)
            failed.current = layout
            setSaveState(conflicted.current ? 'conflict' : 'error')
            setSaveError(error)
            return false
          })
          .finally(() => {
            saving.current = null
          })
      }
      if (!(await saving.current)) return false
    }
    return true
  }, [client, dispatch, hasUnsaved, nodeId, projectId])

  useEffect(() => {
    if (
      !state.dirty ||
      state.layout === failed.current ||
      saveState === 'conflict' ||
      saveState === 'saving'
    )
      return
    const timer = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [state.dirty, state.layout, saveState, flush])

  useEffect(() => {
    function saveInBackground() {
      if (document.visibilityState === 'hidden' && hasUnsaved()) void flush()
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsaved()) return
      void flush()
      event.preventDefault()
      event.returnValue = ''
    }
    document.addEventListener('visibilitychange', saveInBackground)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', saveInBackground)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [flush, hasUnsaved])

  function load(layout: Layout, newRevision: number | null) {
    revision.current = newRevision
    savedLayout.current = layout
    failed.current = null
    conflicted.current = false
    dispatch({ type: 'load', layout })
    setSaveError(null)
    setSaveState(newRevision === null ? 'idle' : 'saved')
  }

  async function discard() {
    if (discarding.current || !window.confirm('丢弃后草稿中的修改无法恢复，确定丢弃吗？')) return
    discarding.current = true
    const key = workbenchKeys.drafts(projectId)
    try {
      await saving.current
      if (revision.current !== null) {
        await deleteDraft(projectId, nodeId, revision.current)
        await client.cancelQueries({ queryKey: key })
        client.setQueryData<Draft[]>(key, (drafts = []) =>
          drafts.filter((entry) => entry.baseNodeId !== nodeId),
        )
      }
      load(baseNode.layout ?? EMPTY_LAYOUT, null)
    } catch (error) {
      conflicted.current = error instanceof ApiRequestError && error.status === 409
      setSaveState(conflicted.current ? 'conflict' : 'error')
      setSaveError(error)
    } finally {
      discarding.current = false
    }
  }

  async function reloadDraft() {
    const key = workbenchKeys.drafts(projectId)
    try {
      await client.invalidateQueries({ queryKey: key }, { throwOnError: true })
      const current = client
        .getQueryData<Draft[]>(key)
        ?.find((entry) => entry.baseNodeId === nodeId)
      load(current?.layout ?? baseNode.layout ?? EMPTY_LAYOUT, current?.revision ?? null)
    } catch (error) {
      setSaveError(error)
    }
  }

  return { saveState, saveError, hasUnsaved, flush, discard, reloadDraft }
}
