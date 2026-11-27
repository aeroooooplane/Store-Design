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
import { useBlocker } from 'react-router'
import {
  checkAssetFit,
  WALL_ART_ID,
  fitBodyFootprints,
  itemMount,
  mToMm,
  snapRotation,
  spaceAncestor,
  stageOf,
  validateLayout,
} from '@store/shared'
import type {
  Asset,
  Camera,
  NodeCamera,
  DesignNode,
  Draft,
  LayoutItem,
  NodeSummary,
  ShopType,
  SiStyle,
  Space,
} from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import type { Viewer3DHandle } from '../viewer3d/Viewer3D.tsx'
import type { ViewPose } from '../viewer3d/white-scene.ts'
import { useCreateNode } from './api.ts'
import { useAgentSelection } from '../agent/selection.ts'
import { CameraPanel } from './CameraPanel.tsx'
import { StagePanel } from './StagePanel.tsx'
import type { SiSwitch } from './si-switch.ts'
import { WorkbenchLayout } from './WorkbenchLayout.tsx'
import { useViewMemory } from './view-memory.ts'
import type { Market, Stage } from '@store/shared'
import { ModelPicker } from './ModelPicker.tsx'
import {
  catalogItem,
  editorReducer,
  initialEditorState,
  needsWallPlacement,
  placeCatalogItem,
} from './editor-state.ts'
import type { ModelPlacementClick } from './editor-state.ts'
import { PlanView } from './PlanView.tsx'
import { EditorToolbar } from './plan-editor/EditorToolbar.tsx'
import { EMPTY_LAYOUT } from './plan-editor/empty-layout.ts'
import { floorPlacementProblem, nearbyFurniture } from './plan-editor/floor-placement.ts'
import { IssuesPanel } from './plan-editor/IssuesPanel.tsx'
import { PropertiesPanel } from './plan-editor/PropertiesPanel.tsx'
import { useDraftAutosave } from './plan-editor/useDraftAutosave.ts'
import { useSpacingPreference } from './plan-editor/useSpacingPreference.ts'
import { useEditorKeys } from './plan-editor/useEditorKeys.ts'
import { useNodeActions } from './plan-editor/useNodeActions.ts'
import { toWorld, usePlanDrag } from './plan-editor/usePlanDrag.ts'
import { useEditorShortcuts } from './plan-editor/useEditorShortcuts.ts'

// Three.js is only downloaded when a 3D view is first opened.
const Viewer3D = lazy(() =>
  import('../viewer3d/Viewer3D.tsx').then((module) => ({ default: module.Viewer3D })),
)

const STAGE_TITLES: Record<Stage, string> = {
  space: '空间阶段 · 隔板编辑',
  plan: '方案阶段',
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
  /** The step's own SI style: its furniture is offered in the model picker. */
  siStyle: SiStyle
  /** The project's, for steps saved before nodes kept their style. */
  projectSi: SiStyle
  /** The project's market (LOGO versions in 3D). */
  market?: Market | undefined
  /** The node's autosaved working layout. */
  draft: Draft | null
  assets: Asset[]
  onNodeCreated: (nodeId: string) => void
  onSpaceCopied?: ((nodeId: string) => void) | undefined
  onSpaceSiSwitched?: ((nodeId: string) => void) | undefined
  onRegisterSave: (save: (() => Promise<boolean>) | null) => void
  /** Lets the SI switch on the project card swap the props of this step. */
  onRegisterSiSwitch?: (swap: SiSwitch | null) => void
}

/**
 * Edits one layout in plan or 3D. Changes are automatically saved on the current node.
 */
export function PlanEditor({
  projectId,
  baseNode,
  space,
  shopType,
  left,
  nodes,
  siStyle,
  projectSi,
  market,
  draft,
  assets,
  onNodeCreated,
  onSpaceCopied,
  onSpaceSiSwitched,
  onRegisterSave,
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
  const stage = stageOf(baseNode.kind)
  const canEditModels = stage === 'plan'
  // The same space keeps its 3D view and plan/3D choice from step to step.
  const memory = useViewMemory(spaceAncestor(nodes, baseNode.id))
  const remembered = useRef(memory.get())
  const [view, setView] = useState<'plan' | '3d'>(
    () => remembered.current.view[stage] ?? (stage === 'plan' ? '3d' : 'plan'),
  )
  // 显示间距: on by default; the choice carries over from step to step (10-16).
  const [showSpacing, setShowSpacing] = useSpacingPreference()
  // 画空心隔板: the next drag on the plan draws a partition.
  const [drawingFixture, setDrawingFixture] = useState(false)
  const [placement, setPlacement] = useState<{ item: LayoutItem; error?: string } | null>(null)
  const [copiedFurniture, setCopiedFurniture] = useState<LayoutItem | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  // The 3D view is always mounted: it is the mini view while the plan is the main one.
  const [viewerReady, setViewerReady] = useState(false)
  const pendingCamera = useRef<Camera | null>(null)
  const onViewerReady = useCallback(() => {
    setViewerReady(true)
    // The viewer applies its initial room and camera in the remaining mount effects.
    queueMicrotask(() => {
      if (!viewerRef.current || !pendingCamera.current) return
      viewerRef.current.showView(pendingCamera.current)
      pendingCamera.current = null
    })
  }, [])
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
  /** The model's native front for an item id. */
  const frontOf = useCallback(
    (id: string) => {
      const assetId = itemsRef.current.find((i) => i.id === id)?.assetId
      return (assetId ? assetMap.get(assetId)?.front : null) ?? null
    },
    [assetMap],
  )
  // 3D drags: one undo step per drag, magnetic snapping unless Alt is held.
  const move = useCallback(
    (id: string, cx: number, cz: number, gesture: { group: string; snap: boolean }) => {
      const assetId = itemsRef.current.find((item) => item.id === id)?.assetId
      dispatch({
        type: 'move',
        id,
        cx,
        cz,
        group: gesture.group,
        snapTo: gesture.snap ? space : null,
        dragBoundary: space.boundary,
        front: frontOf(id),
        asset: assetId ? assetMap.get(assetId) : undefined,
      })
    },
    [space, frontOf, assetMap],
  )
  // 3D corner drags of a LOGO: one undo step per drag, the scale and place worked out there.
  const resize = useCallback(
    (
      id: string,
      placement: {
        scale: number
        cx: number
        cz: number
        elevation: number
        size?: { w: number; h: number }
      },
      gesture: { group: string },
    ) => {
      const assetId = itemsRef.current.find((i) => i.id === id)?.assetId
      const asset = assetId ? assetMap.get(assetId) : undefined
      if (!asset) return
      if (asset.id === WALL_ART_ID && placement.size) {
        dispatch({
          type: 'resizeWallArt',
          id,
          width: placement.size.w,
          height: placement.size.h,
          at: placement,
          space,
          group: gesture.group,
        })
        return
      }
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
  const selected = canEditModels
    ? (state.layout.items.find((i) => i.id === state.selectedId) ?? null)
    : null

  // Fetch the 3D code while the user is still on the plan, so switching to 3D is quick.
  useEffect(() => {
    if (!('requestIdleCallback' in window)) return
    const id = window.requestIdleCallback(() => void import('../viewer3d/Viewer3D.tsx'))
    return () => window.cancelIdleCallback(id)
  }, [])

  const { saveState, saveError, hasUnsaved, flush, discard, reloadDraft } = useDraftAutosave({
    projectId,
    baseNode,
    draft,
    state,
    dispatch,
  })
  const blocker = useBlocker(hasUnsaved)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    let active = true
    void flush().then((saved) => {
      if (!active) return
      if (saved) blocker.proceed()
      else blocker.reset()
    })
    return () => {
      active = false
    }
  }, [blocker, flush])
  useEffect(() => {
    onRegisterSave(flush)
    return () => onRegisterSave(null)
  }, [flush, onRegisterSave])
  const {
    copyNode,
    advance,
    busy,
    error: actionError,
  } = useNodeActions({
    space,
    baseNode,
    nodes,
    stage,
    layout: state.layout,
    assetMap,
    siStyle,
    projectSi,
    create,
    flush,
    onNodeCreated,
    onSpaceCopied,
    onSpaceSiSwitched,
    onRegisterSiSwitch,
  })
  const {
    svgRef,
    onItemPointerDown,
    onFixturePointerDown,
    onFixtureResize,
    onFixtureRotate,
    onResizeHandlePointerDown,
    onRotateHandlePointerDown,
    onDrawPointerDown,
    onPointerMove,
    endDrag,
    fixturePreview,
    guide: rotationGuide,
  } = usePlanDrag(
    space,
    shopType,
    state.layout,
    dispatch,
    (item) => frontOf(item.id),
    drawingFixture,
    () => setDrawingFixture(false),
    (item) => (item.assetId ? assetMap.get(item.assetId) : undefined),
  )
  const selectedFixture = state.layout.fixtures?.find((f) => f.id === state.selectedId) ?? null
  const { onKeyDown, rotateSelected } = useEditorKeys(selected, assetMap, dispatch)

  function cancelFixtureDrawing() {
    endDrag()
    setDrawingFixture(false)
  }

  function preparePlacement(item: LayoutItem) {
    cancelFixtureDrawing()
    setPlacement({ item })
    canvasRef.current?.focus({ preventScroll: true })
  }

  function addAsset(asset: Asset) {
    preparePlacement(catalogItem(state.layout, asset, 0, 0))
  }

  const placementAsset = placement?.item.assetId ? assetMap.get(placement.item.assetId) : undefined
  const placementOnWall = placement && needsWallPlacement(placement.item, placementAsset)

  function placeModel(click: ModelPlacementClick | null) {
    if (!placement) return
    const error = placementOnWall
      ? '请选择能放下该模型的墙面或空心隔板。'
      : '请在门店地面上选择位置。'
    const item =
      click && placeCatalogItem(placement.item, state.layout, space, click, placementAsset)
    if (!item) {
      setPlacement({ item: placement.item, error })
      return
    }
    const problem = floorPlacementProblem(state.layout, space, item, 'point', placementAsset)
    if (problem) {
      setPlacement({ item: placement.item, error: problem })
      return
    }
    dispatch({ type: 'placeFurniture', item, space, asset: placementAsset })
    setPlacement(null)
  }

  function pasteFurniture(item: LayoutItem) {
    const copy = { ...item, locked: false }
    const asset = item.assetId ? assetMap.get(item.assetId) : undefined
    const nearby = nearbyFurniture(state.layout, space, copy, asset)
    if (nearby) {
      dispatch({ type: 'placeFurniture', item: nearby, space, asset })
      canvasRef.current?.focus({ preventScroll: true })
    } else preparePlacement(copy)
  }

  const furnitureKeysActive = canEditModels && !placement && !drawingFixture
  const selection =
    furnitureKeysActive && selected && itemMount(selected) === 'floor' ? selected : null
  const duplicateFurniture = selection ? () => pasteFurniture(selection) : undefined
  useEditorShortcuts(dispatch, {
    copy: selection ? () => setCopiedFurniture({ ...selection }) : undefined,
    paste:
      furnitureKeysActive && copiedFurniture ? () => pasteFurniture(copiedFurniture) : undefined,
    duplicate: duplicateFurniture,
  })

  function switchView(next: 'plan' | '3d') {
    if (next === '3d') cancelFixtureDrawing()
    setView(next)
    memory.update({ view: { [stage]: next } })
  }

  function toggleFixtureDrawing() {
    if (drawingFixture) return cancelFixtureDrawing()
    switchView('plan')
    setPlacement(null)
    setDrawingFixture(true)
    canvasRef.current?.focus({ preventScroll: true })
  }

  function showCamera(camera: NodeCamera) {
    switchView('3d')
    if (viewerRef.current) viewerRef.current.showView(camera.camera)
    else pendingCamera.current = camera.camera
  }

  const planMain = view === 'plan'
  return (
    <WorkbenchLayout
      left={left}
      spaceFixtures={
        <section className="space-info-card">
          <header className="space-info-heading">
            <h3>
              空心隔板 <small>{state.layout.fixtures?.length ?? 0} 件</small>
            </h3>
            <button
              type="button"
              aria-pressed={drawingFixture}
              className="fixture-draw-button"
              onClick={toggleFixtureDrawing}
            >
              画隔板
            </button>
          </header>
          {state.layout.fixtures?.length ? (
            <div className="space-fixture-list" aria-label="隔板列表">
              {state.layout.fixtures.map((fixture, index) => (
                <button
                  type="button"
                  key={fixture.id}
                  aria-pressed={fixture.id === selectedFixture?.id}
                  onClick={() => {
                    select(fixture.id)
                    canvasRef.current?.focus({ preventScroll: true })
                  }}
                >
                  隔板 {String(index + 1).padStart(2, '0')}
                  <small>
                    {mToMm(fixture.w)} × {mToMm(fixture.d)} mm
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <p className="hint">暂无隔板</p>
          )}
        </section>
      }
      models={
        canEditModels && (
          <ModelPicker
            assets={assets}
            siStyle={siStyle}
            market={market}
            onPick={addAsset}
            isPointPlaced={() => true}
            pendingAssetId={placement?.item.assetId}
          />
        )
      }
      defaultTab={canEditModels ? 'models' : 'history'}
      cameras={
        canEditModels && (
          <CameraPanel
            nodeId={baseNode.id}
            viewer={viewerRef}
            viewerReady={viewerReady}
            layout={state.layout}
            onShow={showCamera}
            canCapture={!planMain}
            onOpenViewer={() => switchView('3d')}
          />
        )
      }
      center={
        <section className="plan-editor wb-card" aria-label="平面编辑">
          <h2 className="node-heading">{baseNode.name}</h2>
          <EditorToolbar
            view={view}
            onSwitchView={switchView}
            canUndo={state.past.length > 0}
            canRedo={state.future.length > 0}
            dispatch={dispatch}
            saveState={saveState}
            spacing={showSpacing}
            onToggleSpacing={() => setShowSpacing(!showSpacing)}
            drawingFixture={drawingFixture}
            onToggleDrawFixture={toggleFixtureDrawing}
          />

          {saveState === 'conflict' && (
            <div className="error" role="alert">
              草稿已在其他窗口被修改，本窗口已停止自动保存。
              <button type="button" onClick={() => void reloadDraft()}>
                载入最新草稿（放弃本窗口未保存的修改）
              </button>
            </div>
          )}
          {saveError !== null && <ErrorMessage error={saveError} />}
          {saveState === 'error' && hasUnsaved() && (
            <button type="button" onClick={() => void flush()}>
              重试保存
            </button>
          )}

          <div
            className="plan-canvas"
            ref={canvasRef}
            tabIndex={0}
            aria-label={
              planMain
                ? canEditModels
                  ? '平面画布：拖动移动，方向键微调，R 旋转，Delete 删除'
                  : '平面画布：绘制和调整隔板，R 旋转，Delete 删除选中的隔板'
                : canEditModels
                  ? '三维视图：拖动道具在地面移动，拖动空白处旋转视角，滚轮缩放'
                  : '三维视图：拖动旋转视角，滚轮缩放'
            }
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => {
              if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing)
                return
              if (placement) {
                if (event.key === 'Escape') setPlacement(null)
                return
              }
              if (event.key === 'Escape' && (drawingFixture || fixturePreview))
                cancelFixtureDrawing()
              else if (selectedFixture && (event.key === 'Delete' || event.key === 'Backspace'))
                dispatch({ type: 'remove', id: selectedFixture.id })
              else if (
                planMain &&
                selectedFixture &&
                !drawingFixture &&
                !fixturePreview &&
                event.key.toLowerCase() === 'r'
              ) {
                event.preventDefault()
                dispatch({
                  type: 'turnFixture',
                  id: selectedFixture.id,
                  rotation: (selectedFixture.rotation ?? 0) + (event.shiftKey ? -90 : 90),
                })
              } else onKeyDown(event)
            }}
          >
            {drawingFixture && (
              <div className="toolbar notice placement-controls">
                <p className="hint" role="status">
                  从一个角拖到对角。按住 Alt 可关闭吸附。
                </p>
                <button type="button" onClick={cancelFixtureDrawing}>
                  取消（Esc）
                </button>
              </div>
            )}
            {placement && (
              <div className="toolbar notice placement-controls">
                <p className="hint" role="status">
                  {placement.error ??
                    (placementOnWall
                      ? `点击墙面或空心隔板放置「${placement.item.name}」。`
                      : `在画布上点击放置「${placement.item.name}」。`)}
                </p>
                <button type="button" onClick={() => setPlacement(null)}>
                  取消放置
                </button>
              </div>
            )}
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
                  onSelect={(id) => select(canEditModels ? id : null)}
                  onMove={canEditModels ? move : undefined}
                  onResize={canEditModels ? resize : undefined}
                  onRotate={canEditModels ? rotate : undefined}
                  onWallPlace={!planMain && placementOnWall ? placeModel : undefined}
                  onFloorPlace={
                    !planMain && placement && !placementOnWall
                      ? (point) => placeModel(point && { point })
                      : undefined
                  }
                  onReady={onViewerReady}
                  look="material"
                  siStyle={siStyle}
                  market={market}
                  initialView={remembered.current.pose}
                  onViewChange={rememberPose}
                  title={`${baseNode.name} 三维效果`}
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
              style={
                planMain && (placement || drawingFixture) ? { cursor: 'crosshair' } : undefined
              }
              onPointerDownCapture={
                planMain
                  ? (event) => {
                      if (!placement) return onDrawPointerDown(event)
                      if (event.button !== 0) return
                      event.stopPropagation()
                      const point = toWorld(svgRef.current, event)
                      placeModel(point && { point })
                    }
                  : undefined
              }
            >
              <PlanView
                svgRef={svgRef}
                space={space}
                shopType={shopType}
                layout={state.layout}
                issues={issues}
                assets={assetMap}
                selectedId={state.selectedId}
                onItemPointerDown={canEditModels ? onItemPointerDown : undefined}
                onFixturePointerDown={onFixturePointerDown}
                onResizeHandlePointerDown={canEditModels ? onResizeHandlePointerDown : undefined}
                onRotateHandlePointerDown={canEditModels ? onRotateHandlePointerDown : undefined}
                guide={rotationGuide}
                onFixtureResize={
                  planMain && !drawingFixture && !placement ? onFixtureResize : undefined
                }
                onFixtureRotate={
                  planMain && !drawingFixture && !placement ? onFixtureRotate : undefined
                }
                fixturePreview={fixturePreview}
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
      }
      right={
        <>
          <div className="wb-card">
            <StagePanel
              title={STAGE_TITLES[stage]}
              first={[
                {
                  label: '新建副本',
                  title: '在同一层另存一份，原来的保留，之后在副本上修改',
                  onClick: copyNode,
                  disabled: busy || create.isPending,
                },
                {
                  label: '丢弃草稿',
                  onClick: () => void discard(),
                  disabled: saveState === 'idle' && !state.dirty,
                },
              ]}
              second={
                stage === 'plan' || stage === 'space'
                  ? {
                      label: stage === 'space' ? '保存为方案' : '开始渲染',
                      onClick: advance,
                      primary: true,
                      disabled:
                        busy || create.isPending || (stage !== 'space' && errors.length > 0),
                    }
                  : undefined
              }
              hint={
                errors.length > 0 && stage !== 'space'
                  ? '解决检查中的问题后才能开始渲染。'
                  : undefined
              }
            />
            <ErrorMessage error={actionError} />
          </div>

          {(canEditModels || selectedFixture) && (
            <PropertiesPanel
              selected={selected}
              fixture={selectedFixture}
              fixtureRotationPreview={fixturePreview?.turning ? fixturePreview.rotation : undefined}
              assetMap={assetMap}
              space={space}
              dispatch={dispatch}
              onRotate={rotateSelected}
              onDuplicate={duplicateFurniture}
              copiedFurnitureName={copiedFurniture?.name}
            />
          )}

          <IssuesPanel issues={issues} errorCount={errors.length} />
        </>
      }
    />
  )
}
