import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

interface WorkbenchLayoutProps {
  /** The history tree. */
  left: ReactNode
  /** The model list: only where props can be added (plan stage); it becomes the default tab. */
  models?: ReactNode
  /** Saved views, available in the white-model stage. */
  cameras?: ReactNode
  /** The plan / 3D canvas (or the page's main content). */
  center: ReactNode
  /** Stage actions, selected prop and checks. Without it the centre takes the room. */
  right?: ReactNode
  /** Which tab opens first: the model list in the plan stage, history elsewhere. */
  defaultTab?: LeftTab
}

/** Project details shown in the "空间信息" tab; the workbench provides them to every layout. */
export const WorkbenchInfoContext = createContext<ReactNode>(null)

/** The open left tab lives in the workbench, so changing step (which remounts the layout) keeps it. */
export const LeftTabContext = createContext<{
  tab: LeftTab | null
  setTab: (tab: LeftTab) => void
}>({ tab: null, setTab: () => {} })

export type LeftTab = 'history' | 'models' | 'info' | 'cameras'

const TAB_LABELS: Record<LeftTab, string> = {
  history: '历史',
  models: '添加模型',
  info: '空间信息',
  cameras: '视角',
}

/**
 * The left column is one card with tabs, so only one block is on screen at a time and the page
 * does not have to scroll. Every panel stays mounted (hidden when inactive) to keep its state.
 */
function LeftTabs({
  history,
  models,
  cameras,
  defaultTab = 'history',
}: {
  history: ReactNode
  models?: ReactNode
  cameras?: ReactNode
  defaultTab?: LeftTab
}) {
  const info = useContext(WorkbenchInfoContext)
  const tabs: LeftTab[] = [
    'history',
    ...(models ? (['models'] as const) : []),
    'info',
    ...(cameras ? (['cameras'] as const) : []),
  ]
  const { tab, setTab } = useContext(LeftTabContext)
  const fallback: LeftTab = models && defaultTab === 'models' ? 'models' : 'history'
  const current = tab && tabs.includes(tab) ? tab : fallback
  const panels: Record<LeftTab, ReactNode> = { history, models, info, cameras }
  return (
    <section className="wb-tabs-card">
      <div
        className={cameras ? 'wb-tabs wb-tabs-with-cameras' : 'wb-tabs'}
        role="tablist"
        aria-label="左栏"
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`wb-tab-${tab}`}
            aria-selected={current === tab}
            aria-controls={`wb-panel-${tab}`}
            onClick={() => setTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab}
          role="tabpanel"
          id={`wb-panel-${tab}`}
          aria-labelledby={`wb-tab-${tab}`}
          className="wb-tab-panel"
          hidden={current !== tab}
        >
          {panels[tab]}
        </div>
      ))}
    </section>
  )
}

/** The workbench in three columns, as in the user's layout sketch (2026-10-10). */
export function WorkbenchLayout({
  left,
  models,
  cameras,
  center,
  right,
  defaultTab,
}: WorkbenchLayoutProps) {
  return (
    <div className={right ? 'wb-layout' : 'wb-layout no-right'}>
      <aside className="wb-left">
        <LeftTabs history={left} models={models} cameras={cameras} defaultTab={defaultTab} />
      </aside>
      <div className="wb-center">{center}</div>
      {right ? <aside className="wb-right">{right}</aside> : null}
    </div>
  )
}
