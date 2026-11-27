import { createContext, useContext } from 'react'

export const CeilingPreviewContext = createContext(false)

export function useCeilingPreview() {
  return useContext(CeilingPreviewContext)
}
