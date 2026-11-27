import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'

interface WorkbenchLayoutProps {
  /** The history tree. */
  left: ReactNode
  /** Model controls for this stage, or a link from render to its editable plan. */
  models?: ReactNode
  /** Saved views of the current node. */
  cameras?: ReactNode
  background?: ReactNode
  spaceFixtures?: ReactNode
  /** The plan / 3D canvas (or the page's main content). */
  center: ReactNode
  /** Stage actions, selected prop and checks. Without it the centre takes the room. */
  right?: ReactNode
  /** Which tab opens first: the model list in the plan stage, history elsewhere. */
  defaultTab?: LeftTab
  tabState?: LeftTabState
}

/** Project details shown in the "空间信息" tab; the workbench provides them to every layout. */
export const WorkbenchInfoContext = createContext<{
  currentSpace: ReactNode
  facade?: ReactNode
  details: ReactNode
  drawings: ReactNode
} | null>(null)
export const CameraPanelVisibility = createContext(true)

/** The open left tab lives in the workbench, so changing step (which remounts the layout) keeps it. */
interface LeftTabState {
  tab: LeftTab | null
  setTab: (tab: LeftTab) => void
}
export const LeftTabContext = createContext<LeftTabState | null>(null)

export type LeftTab = 'history' | 'models' | 'info' | 'cameras' | 'background'

const TAB_LABELS: Record<LeftTab, string> = {
  history: '历史',
  models: '添加模型',
  info: '空间信息',
  cameras: '视角',
  background: '背景编辑',
}

/**
 * The left column is one card with tabs, so only one block is on screen at a time and the page
 * does not have to scroll. Every panel stays mounted (hidden when inactive) to keep its state.
 */
function LeftTabs({
  history,
  models,
  cameras,
  background,
  spaceFixtures,
  tabState,
  defaultTab = 'history',
}: {
  history: ReactNode
  models?: ReactNode
  cameras?: ReactNode
  background?: ReactNode
  spaceFixtures?: ReactNode
  tabState?: LeftTabState
  defaultTab?: LeftTab
}) {
  const info = useContext(WorkbenchInfoContext)
  const tabs: LeftTab[] = [
    'history',
    'info',
    ...(models ? (['models'] as const) : []),
    ...(cameras ? (['cameras'] as const) : []),
  ]
  const sharedTab = useContext(LeftTabContext)
  const [localTab, setLocalTab] = useState<LeftTab | null>(null)
  const [drawingsOpened, setDrawingsOpened] = useState(false)
  const { tab, setTab } = tabState ?? sharedTab ?? { tab: localTab, setTab: setLocalTab }
  const fallback: LeftTab = models && defaultTab === 'models' ? 'models' : 'history'
  const backgroundActive = tab === 'background' && !!cameras && !!background
  const current = backgroundActive ? 'cameras' : tab && tabs.includes(tab) ? tab : fallback
  const cameraPanel = (
    <CameraPanelVisibility.Provider value={current === 'cameras' && !backgroundActive}>
      {cameras}
    </CameraPanelVisibility.Provider>
  )
  const panels: Partial<Record<LeftTab, ReactNode>> = {
    history,
    models,
    info: (
      <div className="space-info-cards">
        {info?.currentSpace}
        {spaceFixtures}
        {info?.facade}
        {info?.details && (
          <details className="space-info-card">
            <summary>项目资料</summary>
            {info.details}
          </details>
        )}
        {info?.drawings && (
          <details
            className="space-info-card"
            onToggle={(event) => {
              if (event.currentTarget.open) setDrawingsOpened(true)
            }}
          >
            <summary>项目图纸</summary>
            {drawingsOpened && info.drawings}
          </details>
        )}
      </div>
    ),
  }
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
          {tab === 'cameras' ? (
            background ? (
              <>
                <div className="wb-tabs" role="tablist" aria-label="视角工具">
                  <button
                    type="button"
                    role="tab"
                    id="wb-view-list-tab"
                    aria-selected={!backgroundActive}
                    aria-controls="wb-view-list"
                    onClick={() => setTab('cameras')}
                  >
                    视角列表
                  </button>
                  <button
                    type="button"
                    role="tab"
                    id="wb-background-tab"
                    aria-selected={backgroundActive}
                    aria-controls="wb-background"
                    onClick={() => setTab('background')}
                  >
                    {TAB_LABELS.background}
                  </button>
                </div>
                <div
                  id="wb-view-list"
                  className="wb-tab-panel"
                  role="tabpanel"
                  aria-labelledby="wb-view-list-tab"
                  hidden={backgroundActive}
                >
                  {cameraPanel}
                </div>
                <div
                  id="wb-background"
                  role="tabpanel"
                  aria-labelledby="wb-background-tab"
                  hidden={!backgroundActive}
                >
                  {background}
                </div>
              </>
            ) : (
              cameraPanel
            )
          ) : (
            panels[tab]
          )}
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
  background,
  spaceFixtures,
  center,
  right,
  defaultTab,
  tabState,
}: WorkbenchLayoutProps) {
  return (
    <div className={right ? 'wb-layout' : 'wb-layout no-right'}>
      <aside className="wb-left">
        <LeftTabs
          history={left}
          models={models}
          cameras={cameras}
          background={background}
          spaceFixtures={spaceFixtures}
          defaultTab={defaultTab}
          tabState={tabState}
        />
      </aside>
      <div className="wb-center">{center}</div>
      {right ? <aside className="wb-right">{right}</aside> : null}
    </div>
  )
}
