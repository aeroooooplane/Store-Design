import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { NodeCamera } from '@store/shared'
import { saveCameraBackground, uploadBackgroundImage, workbenchKeys } from '../api.ts'
import { BackgroundDrafts, newBackground } from './state.ts'
import { emptyEditing, validateBackgroundFile } from './BackgroundEditor.tsx'
import type { BackgroundEditing } from './BackgroundEditor.tsx'

export function useBackgroundEditor(nodeId: string, cameras: NodeCamera[]) {
  const client = useQueryClient()
  const [drafts] = useState(
    () =>
      new BackgroundDrafts(async (id, background, revision) => {
        const result = await saveCameraBackground(id, background, revision)
        client.setQueryData<NodeCamera[]>(workbenchKeys.cameras(nodeId), (old) =>
          old?.map((c) => (c.id === id ? result : c)),
        )
        await client.invalidateQueries({ queryKey: workbenchKeys.renders(nodeId) })
        return {
          background: result.camera.background ?? null,
          revision: result.camera.backgroundRevision ?? 0,
        }
      }),
  )
  useSyncExternalStore(drafts.subscribe, drafts.snapshot)
  const [editing, setEditing] = useState<Record<string, BackgroundEditing>>({})
  const [uploading, setUploading] = useState<ReadonlySet<string>>(new Set())
  const uploadingNow = useRef(new Set<string>())
  const [errors, setErrors] = useState<Record<string, unknown>>({})
  useEffect(() => {
    cameras.forEach((c) =>
      drafts.receive(c.id, c.camera.background ?? null, c.camera.backgroundRevision ?? 0),
    )
  }, [cameras, drafts])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (uploading.size || cameras.some((c) => drafts.dirty(c.id) || drafts.get(c.id)?.saving))
        event.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [cameras, drafts, uploading])
  async function upload(id: string, file: File) {
    if (uploadingNow.current.has(id)) return
    uploadingNow.current.add(id)
    setErrors((current) => ({ ...current, [id]: null }))
    try {
      validateBackgroundFile(file)
      setUploading((current) => new Set([...current, id]))
      const image = await uploadBackgroundImage(id, file)
      drafts.commit(id, newBackground(image))
      setEditing((current) => ({ ...current, [id]: emptyEditing() }))
    } catch (error) {
      setErrors((current) => ({ ...current, [id]: error }))
    } finally {
      uploadingNow.current.delete(id)
      setUploading((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }
  return {
    drafts,
    uploading,
    errors,
    editing,
    updateEditing: (id: string, value: BackgroundEditing) =>
      setEditing((current) => ({ ...current, [id]: value })),
    upload: (id: string, file: File) => {
      void upload(id, file)
    },
    pending:
      uploading.size > 0 ||
      cameras.some(
        (c) => drafts.dirty(c.id) || drafts.get(c.id)?.saving || drafts.get(c.id)?.error,
      ),
  }
}
