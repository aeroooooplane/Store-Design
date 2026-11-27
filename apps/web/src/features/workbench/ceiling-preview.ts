import { createContext, useContext, useEffect, useEffectEvent } from 'react'

type Open3d = () => void
export const CeilingPreviewContext = createContext<{
  visible: boolean
  register: (open: Open3d) => () => void
} | null>(null)

export function useCeilingPreview() {
  return useContext(CeilingPreviewContext)?.visible ?? false
}

export function useCeilingView(open: Open3d) {
  const register = useContext(CeilingPreviewContext)?.register
  const show = useEffectEvent(open)
  useEffect(() => register?.(() => show()), [register])
}
