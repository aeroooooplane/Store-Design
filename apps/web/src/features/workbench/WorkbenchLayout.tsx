import type { ReactNode } from 'react'

interface WorkbenchLayoutProps {
  /** Project card, history tree, model list. */
  left: ReactNode
  /** The plan / 3D canvas (or the page's main content). */
  center: ReactNode
  /** Stage actions, selected prop, checks, views. Without it the centre takes the room. */
  right?: ReactNode
}

/** The workbench in three columns, as in the user's layout sketch (2026-10-10). */
export function WorkbenchLayout({ left, center, right }: WorkbenchLayoutProps) {
  return (
    <div className={right ? 'wb-layout' : 'wb-layout no-right'}>
      <aside className="wb-left">{left}</aside>
      <div className="wb-center">{center}</div>
      {right ? <aside className="wb-right">{right}</aside> : null}
    </div>
  )
}
