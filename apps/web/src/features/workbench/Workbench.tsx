import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { nextHistoryName, nodeSiStyle, stageParentId, supportsFacade } from '@store/shared'
import type {
  Asset,
  DesignNode,
  Draft,
  NodeSummary,
  Project,
  ShopType,
  SiStyle,
  Space,
} from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { ProjectNavSlot } from '../../components/AppNav.tsx'
import { isFullWorkbench } from '../../api/deployment.ts'
import { ProjectDrawings } from '../projects/ProjectDrawings.tsx'
import {
  useCreateNode,
  useDrafts,
  useNode,
  useCatalog,
  useTree,
  useUpdateNodeSpace,
} from './api.ts'
import { CandidateGallery, usePlanGeneration } from './CandidateGallery.tsx'
import { HistoryTree, HistoryViewProvider } from './HistoryTree.tsx'
import { PlanEditor } from './PlanEditor.tsx'
import { PlanView } from './PlanView.tsx'
import { useNodeActions } from './plan-editor/useNodeActions.ts'
import { EMPTY_LAYOUT } from './plan-editor/empty-layout.ts'
import { RecognitionPanel } from '../recognition/RecognitionPanel.tsx'
import { CurrentSpaceCard, ProjectCard, ProjectDetails } from './ProjectCard.tsx'
import { RenderStage } from './RenderStage.tsx'
import { SpaceCaptureEditor } from './space-capture/SpaceCaptureEditor.tsx'
import { FacadeCard, FacadeEditor } from '../facade/FacadeEditor.tsx'
import { CeilingCard } from './CeilingCard.tsx'
import { CeilingPreviewContext } from './ceiling-preview.ts'
import { StagePanel } from './StagePanel.tsx'
import { flattenTree } from './tree.ts'
import { LeftTabContext, WorkbenchInfoContext, WorkbenchLayout } from './WorkbenchLayout.tsx'
import type { LeftTab } from './WorkbenchLayout.tsx'
import { useUpdateProject } from '../projects/queries.ts'
import { AgentDock, AgentSelectionProvider } from '../agent/AgentDock.tsx'
import { useViewMemory, ViewMemoryContext } from './view-memory.ts'
import type { ViewState } from './view-memory.ts'
import type { SiSwitch } from './si-switch.ts'

const Viewer3D = lazy(() =>
  import('../viewer3d/Viewer3D.tsx').then((module) => ({ default: module.Viewer3D })),
)
const NO_FLAGS: ReadonlySet<string> = new Set()

type Panel = 'view' | 'new-space' | 'edit-space' | 'edit-facade' | 'manual'

/** Where to land without an explicit choice: the draft's base, else the newest visible step. */
export function defaultNodeId(nodes: NodeSummary[], draft: Draft | null): string | null {
  if (draft && nodes.some((n) => n.id === draft.baseNodeId)) return draft.baseNodeId
  // Nodes arrive in creation order; skip anything folded away in the tree.
  const shown = new Set(
    flattenTree(nodes)
      .filter((e) => !e.hiddenBranch)
      .map((e) => e.node.id),
  )
  const visible = nodes.filter((n) => shown.has(n.id))
  return (visible[visible.length - 1] ?? nodes[nodes.length - 1])?.id ?? null
}

/**
 * The project workbench in three columns: project, history and model list on the left, the
 * selected step in the middle, its stage actions and details on the right. The selected node
 * lives in the URL (`?node=`) so a reload or a shared link opens the same step.
 */
export function Workbench({ project }: { project: Project }) {
  const tree = useTree(project.id)
  const drafts = useDrafts(project.id)
  const latestDraft = drafts.data?.[0] ?? null
  const saveCurrentNode = useRef<(() => Promise<boolean>) | null>(null)
  const registerSave = useCallback((save: (() => Promise<boolean>) | null) => {
    saveCurrentNode.current = save
  }, [])
  const assets = useCatalog()
  const [params, setParams] = useSearchParams()
  const [panel, setPanel] = useState<{ nodeId: string | null; kind: Panel }>({
    nodeId: null,
    kind: 'view',
  })
  // The plan editor registers how it swaps its props when the SI style changes.
  const siSwitch = useRef<SiSwitch | null>(null)
  // The 3D view and plan/3D choice of each space, kept while moving between its steps.
  const viewMemory = useRef(new Map<string, ViewState>())
  const [siNotice, setSiNotice] = useState<string | null>(null)
  const [shownCeilings, setShownCeilings] = useState<ReadonlySet<string>>(() => new Set())
  // The left tab, kept while moving between steps; null means the stage decides.
  const [leftTab, setLeftTab] = useState<LeftTab | null>(null)
  const registerSiSwitch = useCallback((swap: SiSwitch | null) => {
    siSwitch.current = swap
  }, [])

  const nodes = useMemo(() => tree.data?.nodes ?? [], [tree.data])
  const requested = params.get('node')
  const startedWithHistory = useRef<boolean | null>(null)
  if (tree.data && startedWithHistory.current === null) {
    startedWithHistory.current = nodes.length > 0
  }
  // The automatic choice is made once, from the first loaded history, so nodes created later
  // (e.g. three generated plans) never move the selection away from what is on screen.
  const firstChoice = useRef<string | null>(null)
  if (firstChoice.current === null && nodes.length > 0 && drafts.data !== undefined) {
    firstChoice.current = defaultNodeId(nodes, latestDraft)
  }
  const fallback =
    firstChoice.current && nodes.some((n) => n.id === firstChoice.current)
      ? firstChoice.current
      : defaultNodeId(nodes, latestDraft)
  const selectedId = requested && nodes.some((n) => n.id === requested) ? requested : fallback
  // Also pin it in the URL, so a reload or a shared link opens the same step.
  useEffect(() => {
    if (startedWithHistory.current && !requested && selectedId && drafts.data !== undefined) {
      setParams({ node: selectedId }, { replace: true })
    }
  }, [requested, selectedId, setParams, drafts.data])

  // Close the old panel only after navigation succeeds, so its editor can finish saving.
  if (panel.nodeId !== selectedId) setPanel({ nodeId: selectedId, kind: 'view' })
  const currentPanel = panel.nodeId === selectedId ? panel.kind : 'view'
  const activePanel =
    currentPanel === 'view' && requested === selectedId && params.get('mode') === 'placement'
      ? 'manual'
      : currentPanel
  const [openingSpace, setOpeningSpace] = useState(false)
  const [spaceOpenError, setSpaceOpenError] = useState(false)

  function select(nodeId: string) {
    setParams({ node: nodeId })
  }

  function openPlacement(nodeId: string) {
    setParams({ node: nodeId, mode: 'placement' })
  }

  async function openNewSpace() {
    if (saveCurrentNode.current && !(await saveCurrentNode.current())) return
    setPanel({ nodeId: selectedId, kind: 'new-space' })
  }

  async function openEditSpace(kind: 'edit-space' | 'edit-facade' = 'edit-space') {
    setOpeningSpace(true)
    setSpaceOpenError(false)
    try {
      if (saveCurrentNode.current && !(await saveCurrentNode.current())) {
        setSpaceOpenError(true)
        return
      }
      setPanel({ nodeId: selectedId, kind })
    } catch {
      setSpaceOpenError(true)
    } finally {
      setOpeningSpace(false)
    }
  }

  // Read the tree's saved style as well, so a legacy space's first switch updates its cached header.
  const selected = useNode(selectedId).data
  const savedSi = nodes.find((node) => node.id === selectedId)?.siStyle
  const shownSi = savedSi ?? (selected ? nodeSiStyle(selected, project.siStyle) : project.siStyle)
  const siLocked =
    selected?.kind === 'render'
      ? `渲染节点的 SI（${shownSi}）在出图时已定；请回到方案节点切换。`
      : selectedId && !selected
        ? '节点读取完成后可切换 SI。'
        : activePanel === 'edit-space' || activePanel === 'edit-facade'
          ? '请完成当前空间的设置后再切换 SI。'
          : null
  const updateProject = useUpdateProject()
  const [siBusy, setSiBusy] = useState(false)

  async function switchSi(style: SiStyle) {
    setSiBusy(true)
    try {
      const result = (await siSwitch.current?.(style)) ?? { ok: true, message: null }
      // Nothing was created: say why, and leave the project's default style as it was.
      if (!result.ok) {
        setSiNotice(result.message)
        return
      }
      // New generations and models added later follow the latest choice.
      if (project.siStyle !== style) {
        await updateProject.mutateAsync({ project, patch: { siStyle: style } })
      }
      setSiNotice(
        result.message ?? `已切换为 ${style}：之后自动排布与添加模型使用 ${style} 的软装道具。`,
      )
    } catch {
      setSiNotice(null)
    } finally {
      setSiBusy(false)
    }
  }

  const loadError = tree.error ?? (drafts.data === undefined ? drafts.error : null) ?? assets.error
  if (loadError) return <ErrorMessage error={loadError} />
  if (!tree.data || drafts.data === undefined || !assets.data) {
    return <p className="notice">正在加载工作台…</p>
  }

  function toggleCeiling(visible: boolean) {
    if (!selectedId) return
    setShownCeilings((old) => {
      const updated = new Set(old)
      if (visible) updated.add(selectedId)
      else updated.delete(selectedId)
      return updated
    })
  }

  const creatingSpace = nodes.length === 0 || activePanel === 'new-space'
  const ceilingVisible = selectedId !== null && shownCeilings.has(selectedId)
  const cardSpaceData = selected?.space ?? null
  const changingSpace =
    openingSpace || activePanel === 'edit-space' || activePanel === 'edit-facade'
  const left = (
    <HistoryTree
      projectId={project.id}
      projectName={project.name}
      nodes={nodes}
      selectedId={selectedId}
      draftBaseIds={new Set(drafts.data.map((draft) => draft.baseNodeId))}
      onSelect={select}
      onNewSpace={() => void openNewSpace()}
      newSpaceDisabled={creatingSpace}
    />
  )

  const content = creatingSpace ? (
    <WorkbenchLayout
      left={left}
      center={
        <div className="wb-card">
          <NewSpace
            projectId={project.id}
            assets={assets.data}
            shop={project.shopType}
            onConfirmed={openPlacement}
            first={nodes.length === 0}
            spaceName={nextHistoryName(
              'space',
              nodes.filter((node) => node.kind === 'space').map((node) => node.name),
            )}
            onCreated={select}
            onOpenDrawings={() => setLeftTab('info')}
            onCancel={nodes.length ? () => setPanel({ nodeId: null, kind: 'view' }) : undefined}
          />
        </div>
      }
    />
  ) : selectedId ? (
    <NodePanel
      key={selectedId}
      left={left}
      project={project}
      nodeId={selectedId}
      nodes={nodes}
      draft={drafts.data.find((draft) => draft.baseNodeId === selectedId) ?? null}
      registerSave={registerSave}
      assets={assets.data}
      panel={activePanel}
      setPanel={(kind) => setPanel({ nodeId: selectedId, kind })}
      onSelect={select}
      onSpaceCopied={openPlacement}
      onSpaceSiSwitched={(id, manual) => {
        const remembered = selectedId ? viewMemory.current.get(selectedId) : undefined
        if (remembered && !viewMemory.current.has(id)) viewMemory.current.set(id, remembered)
        if (manual) openPlacement(id)
        else select(id)
      }}
      registerSiSwitch={registerSiSwitch}
    />
  ) : null
  return (
    <AgentSelectionProvider>
      <ProjectNavSlot slot="info">
        <ProjectCard
          project={project}
          space={creatingSpace ? null : cardSpaceData}
          siStyle={shownSi}
          siLocked={siLocked}
          siBusy={siBusy}
          onSiSwitch={(style) => void switchSi(style)}
          notice={siNotice}
          error={updateProject.error}
        />
      </ProjectNavSlot>
      <WorkbenchInfoContext.Provider
        value={{
          currentSpace: cardSpaceData && (
            <CurrentSpaceCard
              space={cardSpaceData}
              shopType={cardSpaceData.shopType ?? project.shopType}
              error={spaceOpenError}
              action={
                !creatingSpace && (
                  <button
                    type="button"
                    disabled={changingSpace}
                    onClick={() => void openEditSpace()}
                  >
                    修改空间
                  </button>
                )
              }
            />
          ),
          facade: !creatingSpace &&
            cardSpaceData &&
            supportsFacade(cardSpaceData.shopType ?? project.shopType) && (
              <FacadeCard
                space={cardSpaceData}
                shop={cardSpaceData.shopType ?? project.shopType}
                siStyle={shownSi}
                market={project.market}
                onEdit={() => void openEditSpace('edit-facade')}
                disabled={changingSpace}
              />
            ),
          ceiling: !creatingSpace && selectedId && cardSpaceData && (
            <CeilingCard
              key={selectedId}
              projectId={project.id}
              nodeId={selectedId}
              space={cardSpaceData}
              shop={cardSpaceData.shopType ?? project.shopType}
              si={shownSi}
              visible={ceilingVisible}
              disabled={changingSpace || siBusy}
              flush={async () => (await saveCurrentNode.current?.()) ?? true}
              onToggle={toggleCeiling}
            />
          ),
          details: <ProjectDetails project={project} siStyle={shownSi} />,
          drawings: <ProjectDrawings projectId={project.id} />,
        }}
      >
        <LeftTabContext.Provider value={{ tab: leftTab, setTab: setLeftTab }}>
          <ViewMemoryContext.Provider value={viewMemory.current}>
            <CeilingPreviewContext.Provider value={ceilingVisible}>
              <HistoryViewProvider key={project.id}>{content}</HistoryViewProvider>
            </CeilingPreviewContext.Provider>
          </ViewMemoryContext.Provider>
        </LeftTabContext.Provider>
      </WorkbenchInfoContext.Provider>
      <AgentDock
        projectId={project.id}
        nodeId={creatingSpace ? null : selectedId}
        onSelect={select}
        assets={assets.data}
      />
    </AgentSelectionProvider>
  )
}

function NewSpace({
  projectId,
  assets,
  shop,
  first,
  spaceName,
  onCreated,
  onOpenDrawings,
  onConfirmed,
  onCancel,
}: {
  projectId: string
  assets: Asset[]
  shop: ShopType
  first: boolean
  spaceName: string
  onCreated: (nodeId: string) => void
  onOpenDrawings: () => void
  onConfirmed: (nodeId: string) => void
  onCancel?: (() => void) | undefined
}) {
  const create = useCreateNode(projectId)
  const [way, setWay] = useState<'manual' | 'upload'>('manual')
  return (
    <>
      <h2>{first ? '第一步：录入空间' : '新建空间'}</h2>
      <div className="tabs" role="group" aria-label="录入方式">
        <button type="button" aria-pressed={way === 'manual'} onClick={() => setWay('manual')}>
          手动录入
        </button>
        {isFullWorkbench ? (
          <button type="button" onClick={onOpenDrawings}>
            项目图纸
          </button>
        ) : (
          <button type="button" aria-pressed={way === 'upload'} onClick={() => setWay('upload')}>
            上传简图识别
          </button>
        )}
      </div>
      {!isFullWorkbench && way === 'upload' ? (
        <RecognitionPanel
          projectId={projectId}
          assets={assets}
          initialShopType={shop}
          spaceName={spaceName}
          onCreated={onCreated}
          onCancel={onCancel}
        />
      ) : (
        <>
          <ErrorMessage error={create.error} />
          <SpaceCaptureEditor
            shop={shop}
            initialName={spaceName}
            onCancel={onCancel}
            onSubmit={async (space, name) => {
              const created = await create.mutateAsync({
                parentId: null,
                kind: 'space',
                name,
                space,
              })
              onConfirmed(created.node.id)
            }}
          />
        </>
      )}
    </>
  )
}

function CurrentNodeSpaceEditor({
  project,
  nodeId,
  space,
  onClose,
}: {
  project: Project
  nodeId: string
  space: Space
  onClose: () => void
}) {
  const [initialSpace] = useState(space)
  const updateSpace = useUpdateNodeSpace(project.id, nodeId)
  return (
    <div className="wb-card">
      <h2>修改空间</h2>
      <p className="hint">保存后直接更新当前节点的空间。</p>
      <ErrorMessage error={updateSpace.error} />
      <SpaceCaptureEditor
        shop={project.shopType}
        initial={initialSpace}
        hideName
        submitLabel="保存到当前节点"
        onCancel={onClose}
        onSubmit={async (edited) => {
          await updateSpace.mutateAsync({ space: edited, previousSpace: initialSpace })
          onClose()
        }}
      />
    </div>
  )
}

interface NodePanelProps {
  left: ReactNode
  project: Project
  nodeId: string
  nodes: NodeSummary[]
  draft: Draft | null
  assets: Asset[]
  panel: Panel
  setPanel: (panel: Panel) => void
  onSelect: (nodeId: string) => void
  onSpaceCopied: (nodeId: string) => void
  onSpaceSiSwitched: (nodeId: string, manual: boolean) => void
  registerSiSwitch: (swap: SiSwitch | null) => void
  registerSave: (save: (() => Promise<boolean>) | null) => void
}

function NodePanel({
  left,
  project,
  nodeId,
  nodes,
  draft,
  assets,
  panel,
  setPanel,
  onSelect,
  onSpaceCopied,
  onSpaceSiSwitched,
  registerSiSwitch,
  registerSave,
}: NodePanelProps) {
  const node = useNode(nodeId)
  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])

  const error = node.error
  const space = node.data?.space
  if (error || !node.data || !space) {
    return (
      <WorkbenchLayout
        left={left}
        center={
          error ? (
            <ErrorMessage error={error} />
          ) : (
            <p className="notice">{node.data ? '节点缺少所属空间' : '正在加载节点…'}</p>
          )
        }
      />
    )
  }
  const current = {
    ...node.data,
    siStyle: nodes.find((summary) => summary.id === nodeId)?.siStyle ?? node.data.siStyle,
  }

  if (panel === 'edit-space') {
    return (
      <WorkbenchLayout
        left={left}
        center={
          <CurrentNodeSpaceEditor
            project={project}
            nodeId={nodeId}
            space={space}
            onClose={() => setPanel('view')}
          />
        }
      />
    )
  }

  if (panel === 'edit-facade' && supportsFacade(space.shopType ?? project.shopType)) {
    return (
      <WorkbenchLayout
        left={left}
        center={
          <FacadeEditor
            key={nodeId}
            shop={space.shopType ?? project.shopType}
            space={space}
            projectId={project.id}
            nodeId={nodeId}
            siStyle={nodeSiStyle(current, project.siStyle)}
            market={project.market}
            onClose={() => setPanel('view')}
          />
        }
      />
    )
  }

  if (current.kind === 'render') {
    const planId = stageParentId(nodes, current)
    return (
      <RenderStage
        left={left}
        project={project}
        node={current}
        space={space}
        assets={assetMap}
        onRegisterSave={registerSave}
        onOpenPlan={planId ? () => onSelect(planId) : undefined}
      />
    )
  }

  const editor = (
    <PlanEditor
      left={left}
      projectId={project.id}
      baseNode={current}
      space={space}
      shopType={space.shopType ?? project.shopType}
      nodes={nodes}
      siStyle={nodeSiStyle(current, project.siStyle)}
      projectSi={project.siStyle}
      market={project.market}
      draft={draft}
      assets={assets}
      onNodeCreated={onSelect}
      onSpaceCopied={onSpaceCopied}
      onSpaceSiSwitched={(id) => onSpaceSiSwitched(id, true)}
      onRegisterSiSwitch={registerSiSwitch}
      onRegisterSave={registerSave}
    />
  )

  if (current.kind !== 'space') return editor
  const existingSpaceNames = nodes.filter((node) => node.kind === 'space').map((node) => node.name)

  if (panel === 'manual' || draft) return editor

  return (
    <SpaceStage
      left={left}
      project={project}
      spaceNode={{ ...current, space }}
      assets={assetMap}
      nodes={nodes}
      onSpaceCopied={onSpaceCopied}
      onSpaceSiSwitched={(id) => onSpaceSiSwitched(id, false)}
      registerSiSwitch={registerSiSwitch}
      existingSpaceNames={existingSpaceNames}
      existingNames={nodes.filter((n) => n.parentId === current.id).map((n) => n.name)}
      setPanel={setPanel}
      onSelect={onSelect}
    />
  )
}

/** A space: its plan in the middle; edit it, lay out by hand or generate three plans. */
function SpaceStage({
  left,
  project,
  spaceNode,
  assets,
  existingNames,
  existingSpaceNames,
  nodes,
  onSpaceCopied,
  onSpaceSiSwitched,
  registerSiSwitch,
  setPanel,
  onSelect,
}: {
  left: ReactNode
  project: Project
  spaceNode: DesignNode & { space: Space }
  assets: ReadonlyMap<string, Asset>
  existingNames: readonly string[]
  existingSpaceNames: readonly string[]
  nodes: NodeSummary[]
  onSpaceCopied: (nodeId: string) => void
  onSpaceSiSwitched: (nodeId: string) => void
  registerSiSwitch: (swap: SiSwitch | null) => void
  setPanel: (panel: Panel) => void
  onSelect: (nodeId: string) => void
}) {
  const create = useCreateNode(project.id)
  const siStyle = nodeSiStyle(spaceNode, project.siStyle)
  const copy = useNodeActions({
    baseNode: spaceNode,
    space: spaceNode.space,
    nodes,
    stage: 'space',
    layout: spaceNode.layout ?? EMPTY_LAYOUT,
    assetMap: new Map(assets),
    siStyle,
    projectSi: project.siStyle,
    create,
    flush: async () => true,
    onNodeCreated: onSelect,
    onSpaceCopied,
    onSpaceSiSwitched,
    onRegisterSiSwitch: registerSiSwitch,
  })
  const generation = usePlanGeneration({
    projectId: project.id,
    spaceNode,
    shopType: spaceNode.space.shopType ?? project.shopType,
    siStyle,
    existingNames,
    existingSpaceNames,
  })
  return (
    <StagePreview
      left={left}
      project={project}
      node={spaceNode}
      space={spaceNode.space}
      assets={assets}
      right={
        <div className="wb-card">
          <StagePanel
            title="空间阶段"
            first={[
              { label: '新建副本', onClick: copy.copyNode, disabled: copy.busy || generation.busy },
              {
                label: '编辑空心隔板',
                onClick: () => setPanel('manual'),
                disabled: copy.busy || generation.busy,
              },
            ]}
            second={{
              label: generation.busy ? '正在生成…' : generation.label,
              onClick: generation.run,
              disabled: generation.busy || copy.busy,
              primary: true,
            }}
            hint="三个方案（尽量多放、按面积推荐、尽量少放）都会保存到方案层。"
          />
          <ErrorMessage error={copy.error} />
        </div>
      }
    >
      <CandidateGallery
        generation={generation}
        shopType={spaceNode.space.shopType ?? project.shopType}
        siStyle={siStyle}
        assets={assets}
        onChosen={onSelect}
      />
    </StagePreview>
  )
}

function NodeHeading({ node }: { node: DesignNode }) {
  return <h2 className="node-heading">{node.name}</h2>
}

/** The space preview can show saved geometry in plan or in three dimensions. */
function StagePreview({
  left,
  right,
  children,
  node,
  project,
  space,
  assets,
}: {
  left: ReactNode
  right: ReactNode
  children?: ReactNode
  node: DesignNode
  project: Project
  space: Space
  assets: ReadonlyMap<string, Asset>
}) {
  const memory = useViewMemory(node.id)
  const remembered = useRef(memory.get())
  const [mode, setMode] = useState<'plan' | '3d'>(() => remembered.current.view.space ?? 'plan')
  const [opened, setOpened] = useState(mode === '3d')
  const layout = node.layout ?? EMPTY_LAYOUT

  useEffect(() => {
    if (opened || !('requestIdleCallback' in window)) return
    const id = window.requestIdleCallback(
      () => void import('../viewer3d/Viewer3D.tsx').catch(() => {}),
    )
    return () => window.cancelIdleCallback(id)
  }, [opened])

  function show(next: 'plan' | '3d') {
    if (next === '3d') setOpened(true)
    memory.update({ view: { space: next } })
    setMode(next)
  }

  return (
    <WorkbenchLayout
      left={left}
      right={right}
      center={
        <section className="wb-card">
          <NodeHeading node={node} />
          <div className="toolbar">
            <div className="tabs" role="group" aria-label="显示">
              <button type="button" aria-pressed={mode === 'plan'} onClick={() => show('plan')}>
                平面
              </button>
              <button type="button" aria-pressed={mode === '3d'} onClick={() => show('3d')}>
                三维
              </button>
            </div>
          </div>
          <div className="space-summary" hidden={mode !== 'plan'}>
            <PlanView
              space={space}
              shopType={space.shopType ?? project.shopType}
              layout={node.layout}
              assets={assets}
              title={`${node.name} 平面`}
            />
          </div>
          {opened && (
            <div className="space-summary" hidden={mode !== '3d'}>
              <Suspense fallback={<p className="notice">正在载入三维…</p>}>
                <Viewer3D
                  space={space}
                  shopType={space.shopType ?? project.shopType}
                  layout={layout}
                  assets={assets}
                  selectedId={null}
                  flaggedIds={NO_FLAGS}
                  look="material"
                  facadeControls
                  preferFacadeView
                  siStyle={nodeSiStyle(node, project.siStyle)}
                  initialView={remembered.current.pose}
                  onViewChange={(pose) => memory.update({ pose })}
                  market={project.market}
                  onSelect={() => undefined}
                  title={`${node.name} 三维预览`}
                />
              </Suspense>
            </div>
          )}
          {children}
        </section>
      }
    />
  )
}
