import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import {
  checkAssetFit,
  fitBodyFootprints,
  snapRotation,
  spaceAncestor,
  stageOf,
  validateLayout,
} from '@store/shared'
import type {
  Asset,
  Camera,
  DesignNode,
  Draft,
  NodeSummary,
  ShopType,
  SiStyle,
  Space,
} from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import type { Viewer3DHandle } from '../viewer3d/Viewer3D.tsx'
import type { Look, ViewPose } from '../viewer3d/white-scene.ts'
import { useCreateNode } from './api.ts'
import { useAgentSelection } from '../agent/selection.ts'
import { CameraPanel } from './CameraPanel.tsx'
import { StagePanel } from './StagePanel.tsx'
import type { SiSwitch } from './si-switch.ts'
import { WorkbenchLayout } from './WorkbenchLayout.tsx'
import { useViewMemory } from './view-memory.ts'
import type { Market, Stage } from '@store/shared'
import { ModelPicker } from './ModelPicker.tsx'
import { editorReducer, initialEditorState, newItemPoint } from './editor-state.ts'
import { PlanView } from './PlanView.tsx'
import { SpaceEditor } from './SpaceEditor.tsx'
import { EditorToolbar } from './plan-editor/EditorToolbar.tsx'
import { EMPTY_LAYOUT } from './plan-editor/empty-layout.ts'
import { IssuesPanel } from './plan-editor/IssuesPanel.tsx'
import { PropertiesPanel } from './plan-editor/PropertiesPanel.tsx'
import { useDraftAutosave } from './plan-editor/useDraftAutosave.ts'
import { useEditWalls } from './plan-editor/useEditWalls.ts'
import { useEditorKeys } from './plan-editor/useEditorKeys.ts'
import { useNodeActions } from './plan-editor/useNodeActions.ts'
import { usePlanDrag } from './plan-editor/usePlanDrag.ts'
import { useUndoRedoKeys } from './plan-editor/useUndoRedoKeys.ts'

// Three.js is only downloaded when a 3D view is first opened.
const Viewer3D = lazy(() =>
  import('../viewer3d/Viewer3D.tsx').then((module) => ({ default: module.Viewer3D })),
)

const STAGE_TITLES: Record<Stage, string> = {
  space: '空间阶段 · 手动排布',
  plan: '方案阶段',
  white: '三维效果阶段',
  render: '渲染阶段',
}

interface PlanEditorProps {
  projectId: string
  baseNode: DesignNode
  space: Space
  shopType: ShopType
  /** Project card and history tree for the left column. */
  left: ReactNode
  /** The project's history, to place copies next to their original. */
  nodes: NodeSummary[]
  /** Furniture of this SI style is offered in the model picker. */
  siStyle: SiStyle
  /** The project's market (LOGO versions in 3D). */
  market?: Market | undefined
  /** The shared draft, if it continues this node. */
  draft: Draft | null
  assets: Asset[]
  onNodeCreated: (nodeId: string) => void
  /** Lets the SI switch on the project card swap the props of this step. */
  onRegisterSiSwitch?: (swap: SiSwitch | null) => void
}

/**
 * Edits a layout on the plan or in the 3D white model (one layout, two views). Changes autosave to the shared draft (with optimistic locking);
 * saving a version or confirming the white model creates a new history node.
 */
export function PlanEditor({
  projectId,
  baseNode,
  space,
  shopType,
  left,
  nodes,
  siStyle,
  market,
  draft,
  assets,
  onNodeCreated,
  onRegisterSiSwitch,
}: PlanEditorProps) {
  const create = useCreateNode(projectId)
  const startLayout = draft?.layout ?? baseNode.layout ?? EMPTY_LAYOUT
  // Props placed before their model's body was corrected (开箱桌 sized with their stools) open at
  // the body's size; the change is saved with the next edit.
  const [state, dispatch] = useReducer(editorReducer, startLayout, (layout) =>
    initialEditorState(fitBodyFootprints(layout, new Map(assets.map((a) => [a.id, a])))),
  )
  // The design assistant sees what is selected on the plan.
  const setAgentSelection = useAgentSelection().set
  useEffect(() => {
    setAgentSelection(state.selectedId ? [state.selectedId] : [])
  }, [state.selectedId, setAgentSelection])
  const viewerRef = useRef<Viewer3DHandle>(null)
  const isWhite = baseNode.kind === 'white'
  const stage = stageOf(baseNode.kind)
  // The same space keeps its 3D view and plan/3D choice from step to step.
  const memory = useViewMemory(spaceAncestor(nodes, baseNode.id))
  const remembered = useRef(memory.get())
  const [view, setView] = useState<'plan' | '3d'>(
    () => remembered.current.view[stage] ?? (isWhite ? '3d' : 'plan'),
  )
  // The 3D effect stage shows materials by default; the white model stays one click away.
  // 显示间距 starts off each time: it is a check, not part of the drawing being edited.
  const [showSpacing, setShowSpacing] = useState(false)
  // 画空心隔板: the next drag on the plan draws a partition.
  const [drawingFixture, setDrawingFixture] = useState(false)
  const [look, setLook] = useState<Look>(() => remembered.current.look ?? 'material')
  // The 3D view is always mounted: it is the mini view while the plan is the main one.
  const [viewerReady, setViewerReady] = useState(false)
  const onViewerReady = useCallback(() => setViewerReady(true), [])
  const memoryRef = useRef(memory)
  memoryRef.current = memory
  const rememberPose = useCallback((pose: ViewPose) => memoryRef.current.update({ pose }), [])

  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])
  const issues = useMemo(
    () => [
      ...checkAssetFit(state.layout, assetMap),
      ...validateLayout(space, state.layout, assetMap),
    ],
    [state.layout, space, assetMap],
  )
  const errors = issues.filter((i) => i.severity === 'error')
  const flaggedIds = useMemo(
    () => new Set(issues.filter((i) => i.severity === 'error').flatMap((i) => i.itemIds ?? [])),
    [issues],
  )
  const select = useCallback((id: string | null) => dispatch({ type: 'select', id }), [])
  const itemsRef = useRef(state.layout.items)
  itemsRef.current = state.layout.items
  /** The model's front for an item id (a wall piece turns it into the shop). */
  const frontOf = useCallback(
    (id: string) => {
      const assetId = itemsRef.current.find((i) => i.id === id)?.assetId
      return (assetId ? assetMap.get(assetId)?.front : null) ?? null
    },
    [assetMap],
  )
  // 3D drags: one undo step per drag, magnetic snapping unless Alt is held.
  const move = useCallback(
    (id: string, cx: number, cz: number, gesture: { group: string; snap: boolean }) =>
      dispatch({
        type: 'move',
        id,
        cx,
        cz,
        group: gesture.group,
        snapTo: gesture.snap ? space : null,
        front: frontOf(id),
      }),
    [space, frontOf],
  )
  // 3D corner drags of a LOGO: one undo step per drag, the scale and place worked out there.
  const resize = useCallback(
    (
      id: string,
      placement: { scale: number; cx: number; cz: number; elevation: number },
      gesture: { group: string },
    ) => {
      const assetId = itemsRef.current.find((i) => i.id === id)?.assetId
      const asset = assetId ? assetMap.get(assetId) : undefined
      if (!asset) return
      dispatch({
        type: 'scale',
        id,
        asset,
        scale: placement.scale,
        at: placement,
        space,
        front: asset.front,
        group: gesture.group,
      })
    },
    [assetMap, space],
  )
  // 3D ring turns: the same snapping as the plan handle (walls, then 15° steps; Alt frees it).
  const rotate = useCallback(
    (id: string, rotation: number, gesture: { group: string; snap: boolean }) => {
      const item = itemsRef.current.find((i) => i.id === id)
      if (!item) return
      const snapped = snapRotation(rotation, item, space, !gesture.snap)
      dispatch({ type: 'turn', id, rotation: snapped.rotation, group: gesture.group })
    },
    [space],
  )
  const selected = state.layout.items.find((i) => i.id === state.selectedId) ?? null

  // Effects are registered in the same order as before: agent selection, undo / redo keys,
  // 3D prefetch, autosave, SI switch registration.
  useUndoRedoKeys(dispatch)

  // Fetch the 3D code while the user is still on the plan, so switching to 3D is quick.
  useEffect(() => {
    if (!('requestIdleCallback' in window)) return
    const id = window.requestIdleCallback(() => void import('../viewer3d/Viewer3D.tsx'))
    return () => window.cancelIdleCallback(id)
  }, [])

  const { saveState, saveError, setPaused, finishDraft, discard, reloadDraft } = useDraftAutosave({
    projectId,
    baseNode,
    draft,
    state,
    dispatch,
  })
  const { copyNode, advance } = useNodeActions({
    baseNode,
    nodes,
    stage,
    layout: state.layout,
    assetMap,
    siStyle,
    create,
    setPaused,
    finishDraft,
    onNodeCreated,
    onRegisterSiSwitch,
  })
  const editWalls = useEditWalls({
    baseNode,
    nodes,
    space,
    layout: state.layout,
    create,
    setPaused,
    finishDraft,
    onNodeCreated,
  })
  const {
    svgRef,
    onItemPointerDown,
    onFixturePointerDown,
    onResizeHandlePointerDown,
    onRotateHandlePointerDown,
    onDrawPointerDown,
    onPointerMove,
    endDrag,
    draft: drawnRect,
    guide: rotationGuide,
  } = usePlanDrag(
    space,
    dispatch,
    (item) => frontOf(item.id),
    drawingFixture,
    () => setDrawingFixture(false),
    (item) => (item.assetId ? assetMap.get(item.assetId) : undefined),
  )
  const selectedFixture = state.layout.fixtures?.find((f) => f.id === state.selectedId) ?? null
  const { onKeyDown, rotateSelected } = useEditorKeys(selected, assetMap, dispatch)

  function addAsset(asset: Asset) {
    const [cx, cz] = newItemPoint(space)
    dispatch({ type: 'add', asset, cx, cz, space })
  }

  function switchView(next: 'plan' | '3d') {
    setView(next)
    memory.update({ view: { [stage]: next } })
  }

  function switchLook(next: Look) {
    setLook(next)
    memory.update({ look: next })
  }

  function showCamera(camera: Camera) {
    switchView('3d')
    viewerRef.current?.showView(camera)
  }

  const planMain = view === 'plan'
  return (
    <WorkbenchLayout
      left={
        <>
          {left}
          {/* No props are added while the walls are being edited. */}
          {!editWalls.editing && (
            <ModelPicker assets={assets} siStyle={siStyle} onPick={addAsset} />
          )}
        </>
      }
      center={
        editWalls.editing ? (
          <div className="wb-card">
            <h2>修改墙体</h2>
            <p className="hint">
              保存为新的空间和方案，原来的方案及之后的三维效果、渲染都保留。靠墙的道具跟着墙移动，其余道具不动；改墙后越界或压住柱子、入口的道具会在检查中标出。
            </p>
            <ErrorMessage error={editWalls.error} />
            <SpaceEditor
              initial={space}
              initialName={editWalls.initialName}
              submitting={editWalls.submitting}
              onCancel={editWalls.cancel}
              onSubmit={editWalls.submit}
            />
          </div>
        ) : (
          <section className="plan-editor wb-card" aria-label="平面编辑">
            <h2 className="node-heading">{baseNode.name}</h2>
            <EditorToolbar
              view={view}
              onSwitchView={switchView}
              isWhite={isWhite}
              look={look}
              onSwitchLook={switchLook}
              canUndo={state.past.length > 0}
              canRedo={state.future.length > 0}
              dispatch={dispatch}
              saveState={saveState}
              spacing={showSpacing}
              onToggleSpacing={() => setShowSpacing((on) => !on)}
              drawingFixture={drawingFixture}
              onToggleDrawFixture={() => setDrawingFixture((on) => !on)}
            />

            {saveState === 'conflict' && (
              <div className="error" role="alert">
                草稿已在其他窗口被修改，本窗口已停止自动保存。
                <button type="button" onClick={() => void reloadDraft()}>
                  载入最新草稿（放弃本窗口未保存的修改）
                </button>
              </div>
            )}
            {saveState === 'error' && <ErrorMessage error={saveError} />}

            <div
              className="plan-canvas"
              tabIndex={0}
              aria-label={
                planMain
                  ? '平面画布：拖动移动，方向键微调，R 旋转，Delete 删除'
                  : '三维视图：拖动道具在地面移动，拖动空白处旋转视角，滚轮缩放'
              }
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && drawingFixture) setDrawingFixture(false)
                else if (selectedFixture && (event.key === 'Delete' || event.key === 'Backspace'))
                  dispatch({ type: 'remove', id: selectedFixture.id })
                else onKeyDown(event)
              }}
            >
              <div className={planMain ? 'view-mini' : 'view-main'}>
                <Suspense fallback={<p className="notice">正在载入三维…</p>}>
                  <Viewer3D
                    ref={viewerRef}
                    space={space}
                    shopType={shopType}
                    layout={state.layout}
                    assets={assetMap}
                    selectedId={state.selectedId}
                    flaggedIds={flaggedIds}
                    onSelect={select}
                    onMove={move}
                    onResize={resize}
                    onRotate={rotate}
                    onReady={onViewerReady}
                    look={isWhite ? look : 'white'}
                    siStyle={siStyle}
                    market={market}
                    initialView={remembered.current.pose}
                    onViewChange={rememberPose}
                    title={`${baseNode.name} 三维${isWhite && look === 'material' ? '效果' : '白模'}`}
                  />
                </Suspense>
                {planMain && (
                  <button
                    type="button"
                    className="view-switch"
                    aria-label="切换到三维"
                    title="点击切换到三维"
                    onClick={() => switchView('3d')}
                  />
                )}
              </div>
              <div
                className={planMain ? 'view-main' : 'view-mini'}
                onPointerDownCapture={planMain ? onDrawPointerDown : undefined}
              >
                <PlanView
                  svgRef={svgRef}
                  space={space}
                  shopType={shopType}
                  layout={state.layout}
                  issues={issues}
                  assets={assetMap}
                  selectedId={state.selectedId}
                  onItemPointerDown={onItemPointerDown}
                  onFixturePointerDown={onFixturePointerDown}
                  onResizeHandlePointerDown={onResizeHandlePointerDown}
                  onRotateHandlePointerDown={onRotateHandlePointerDown}
                  guide={rotationGuide}
                  drawingRect={drawnRect}
                  onBackgroundPointerDown={() => dispatch({ type: 'select', id: null })}
                  compact={!planMain}
                  spacing={showSpacing}
                  title={`${baseNode.name} 平面`}
                />
                {!planMain && (
                  <button
                    type="button"
                    className="view-switch"
                    aria-label="切换到平面"
                    title="点击切换到平面"
                    onClick={() => switchView('plan')}
                  />
                )}
              </div>
            </div>
          </section>
        )
      }
      right={
        <>
          <div className="wb-card">
            <StagePanel
              title={STAGE_TITLES[stage]}
              status={
                saveState !== 'idle' || state.dirty ? (
                  <span className="tag">有未保存修改</span>
                ) : null
              }
              first={[
                stage === 'space'
                  ? {
                      label: '保存为方案',
                      onClick: advance,
                      disabled: create.isPending,
                      primary: true,
                    }
                  : {
                      label: '新建副本',
                      title: '在同一层另存一份，原来的保留，之后在副本上修改',
                      onClick: copyNode,
                      disabled: create.isPending,
                    },
                {
                  label: '丢弃草稿',
                  onClick: () => void discard(),
                  disabled: saveState === 'idle' && !state.dirty,
                },
              ]}
              extra={
                stage === 'plan'
                  ? {
                      label: '修改墙体',
                      title: '改边界、入口、柱子或层高，另存为新的空间和方案',
                      onClick: editWalls.start,
                      disabled: create.isPending || editWalls.editing,
                    }
                  : undefined
              }
              second={
                stage === 'plan' || stage === 'white'
                  ? {
                      label: stage === 'plan' ? '进入三维效果' : '开始渲染',
                      onClick: advance,
                      primary: true,
                      disabled: create.isPending || errors.length > 0,
                    }
                  : undefined
              }
              hint={
                errors.length > 0 && stage !== 'space'
                  ? `解决检查中的问题后才能${stage === 'plan' ? '进入三维效果' : '开始渲染'}。`
                  : undefined
              }
            />
            <ErrorMessage error={create.error} />
          </div>

          <PropertiesPanel
            selected={selected}
            fixture={selectedFixture}
            assetMap={assetMap}
            space={space}
            dispatch={dispatch}
            onRotate={rotateSelected}
          />

          <IssuesPanel issues={issues} errorCount={errors.length} />

          {isWhite && (
            <div className="wb-card">
              <CameraPanel
                nodeId={baseNode.id}
                viewer={viewerRef}
                viewerReady={viewerReady}
                layout={state.layout}
                onShow={showCamera}
              />
            </div>
          )}
        </>
      }
    />
  )
}
