import { createContext, useContext } from 'react'
import type { ViewPose } from '../viewer3d/white-scene.ts'
import type { Stage } from '@store/shared'

/**
 * Remembers the camera and the plan or 3D choice for each stage of a space.
 */
export interface ViewState {
  pose: ViewPose | null
  view: Partial<Record<Stage, 'plan' | '3d'>>
}

/** Per space node; lives as long as the workbench page. */
export const ViewMemoryContext = createContext<Map<string, ViewState> | null>(null)

const EMPTY: ViewState = { pose: null, view: {} }

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
