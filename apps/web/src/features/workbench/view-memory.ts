import { createContext, useContext } from 'react'
import type { Look, ViewPose } from '../viewer3d/white-scene.ts'
import type { Stage } from '@store/shared'

/**
 * What the user was looking at in one space: the 3D camera, plan or 3D per stage, and the look
 * of the 3D effect stage. Moving to another plan, a copy or the next stage of the same space
 * keeps it, so options can be compared from one angle.
 */
export interface ViewState {
  pose: ViewPose | null
  view: Partial<Record<Stage, 'plan' | '3d'>>
  look: Look | null
}

/** Per space node; lives as long as the workbench page. */
export const ViewMemoryContext = createContext<Map<string, ViewState> | null>(null)

const EMPTY: ViewState = { pose: null, view: {}, look: null }

export function useViewMemory(spaceId: string | null) {
  const store = useContext(ViewMemoryContext)
  return {
    get: (): ViewState => (store && spaceId ? (store.get(spaceId) ?? EMPTY) : EMPTY),
    update: (patch: Partial<ViewState>) => {
      if (!store || !spaceId) return
      const current = store.get(spaceId) ?? EMPTY
      store.set(spaceId, {
        ...current,
        ...patch,
        view: { ...current.view, ...patch.view },
      })
    },
  }
}
