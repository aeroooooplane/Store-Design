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
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { checkAssetFit, mToMm, mmToM, validateLayout } from '@store/shared'
import type {
  Asset,
  Camera,
  DesignNode,
  Draft,
  Layout,
  LayoutItem,
  NodeSummary,
  ShopType,
  SiStyle,
  Space,
} from '@store/shared'
import { ApiRequestError } from '../../api/client.ts'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import type { Viewer3DHandle } from '../viewer3d/Viewer3D.tsx'
import { deleteDraft, putDraft, useCreateNode, workbenchKeys } from './api.ts'
import { CameraPanel } from './CameraPanel.tsx'
import { StagePanel } from './StagePanel.tsx'
import { TrashIcon } from '../../components/icons.tsx'
import { WorkbenchLayout } from './WorkbenchLayout.tsx'
import { copyName, freshName, stageOf, stageParentId } from './tree.ts'
import type { Stage } from './tree.ts'
import { ModelPicker } from './ModelPicker.tsx'
import { editorReducer, initialEditorState } from './editor-state.ts'
import { PlanView } from './PlanView.tsx'

// Three.js is only downloaded when a 3D view is first opened.
const Viewer3D = lazy(() =>
  import('../viewer3d/Viewer3D.tsx').then((module) => ({ default: module.Viewer3D })),
)

const AUTOSAVE_DELAY_MS = 800
const STAGE_TITLES: Record<Stage, string> = {
  space: '空间阶段 · 手动排布',
  plan: '方案阶段',
  white: '白模阶段',
  render: '渲染阶段',
}
const EMPTY_LAYOUT: Layout = { schemaVersion: 3, items: [], planning: null }

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
  /** The shared draft, if it continues this node. */
  draft: Draft | null
  assets: Asset[]
  onNodeCreated: (nodeId: string) => void
}

/** Curved arrow for undo (left) and redo (right). */
function ArcArrow({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <g transform={direction === 'right' ? 'translate(20 0) scale(-1 1)' : undefined}>
        <path
          d="M5 8h7a4 4 0 0 1 0 8H9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M8 4.5 4.5 8 8 11.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}

function toWorld(
  svg: SVGSVGElement | null,
  event: { clientX: number; clientY: number },
): [number, number] | null {
  const matrix = svg?.getScreenCTM()
  if (!svg || !matrix) return null
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  return [point.x, point.y]
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
  draft,
  assets,
  onNodeCreated,
}: PlanEditorProps) {
  const client = useQueryClient()
  const create = useCreateNode(projectId)
  const startLayout = draft?.layout ?? baseNode.layout ?? EMPTY_LAYOUT
  const [state, dispatch] = useReducer(editorReducer, startLayout, initialEditorState)
  const revision = useRef<number | null>(draft?.revision ?? null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>(
    draft ? 'saved' : 'idle',
  )
  const [saveError, setSaveError] = useState<unknown>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const viewerRef = useRef<Viewer3DHandle>(null)
  const isWhite = baseNode.kind === 'white'
  const [view, setView] = useState<'plan' | '3d'>(isWhite ? '3d' : 'plan')
  /** The 3D scene stays mounted once opened (white models always), so switching is instant. */
  // The 3D view is always mounted: it is the mini view while the plan is the main one.
  const show3d = true
  const [viewerReady, setViewerReady] = useState(false)
  const onViewerReady = useCallback(() => setViewerReady(true), [])
  const drag = useRef<{ id: string; dx: number; dz: number; group: string } | null>(null)
  /** The save in flight, so the draft is never removed underneath it. */
  const saving = useRef<Promise<void> | null>(null)
  /** Layout whose save failed; autosave resumes with the next edit. */
  const failed = useRef<Layout | null>(null)
  /** Autosave stops while a version is being created or the draft discarded. */
  const [paused, setPaused] = useState(false)

  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])
  const issues = useMemo(
    () => [...checkAssetFit(state.layout, assetMap), ...validateLayout(space, state.layout)],
    [state.layout, space, assetMap],
  )
  const errors = issues.filter((i) => i.severity === 'error')
  const flaggedIds = useMemo(
    () => new Set(issues.filter((i) => i.severity === 'error').flatMap((i) => i.itemIds ?? [])),
    [issues],
  )
  const select = useCallback((id: string | null) => dispatch({ type: 'select', id }), [])
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
      }),
    [],
  )
  const selected = state.layout.items.find((i) => i.id === state.selectedId) ?? null

  // Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) anywhere on the page, except while typing in a field.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)
      ) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        dispatch({ type: 'undo' })
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault()
        dispatch({ type: 'redo' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Fetch the 3D code while the user is still on the plan, so switching to 3D is quick.
  useEffect(() => {
    if (!('requestIdleCallback' in window)) return
    const id = window.requestIdleCallback(() => void import('../viewer3d/Viewer3D.tsx'))
    return () => window.cancelIdleCallback(id)
  }, [])

  // Autosave the draft shortly after the last change, one request at a time. Edits made while a
  // save is in flight stay dirty and are saved next; a conflict stops autosaving.
  useEffect(() => {
    if (!state.dirty || paused || saveState === 'conflict' || saveState === 'saving') return
    if (state.layout === failed.current) return
    const layout = state.layout
    const timer = window.setTimeout(() => {
      setSaveState('saving')
      saving.current = putDraft(projectId, { baseNodeId: baseNode.id, layout }, revision.current)
        .then((saved) => {
          revision.current = saved.draft.revision
          failed.current = null
          dispatch({ type: 'saved', layout })
          setSaveState('saved')
          setSaveError(null)
          client.setQueryData(workbenchKeys.draft(projectId), saved.draft)
        })
        .catch((error: unknown) => {
          const conflict =
            error instanceof ApiRequestError && (error.status === 409 || error.status === 428)
          failed.current = layout
          setSaveState(conflict ? 'conflict' : 'error')
          setSaveError(error)
        })
        .finally(() => {
          saving.current = null
        })
    }, AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [state.dirty, state.layout, paused, saveState, projectId, baseNode.id, client])

  /** Removes the draft once its content is kept elsewhere (a new node) or thrown away. */
  async function finishDraft() {
    await saving.current
    if (revision.current === null) return
    const key = workbenchKeys.draft(projectId)
    await deleteDraft(projectId, revision.current).then(
      () => client.setQueryData(key, null),
      // Someone else changed it meanwhile: show the page what is really there.
      () => client.invalidateQueries({ queryKey: key }),
    )
    revision.current = null
  }

  /** Creates a history node from the layout on screen (draft included), then drops the draft. */
  function createFromLayout(input: {
    kind: 'plan' | 'white' | 'render'
    parentId: string
    name: string
    sourceNodeId?: string
  }) {
    setPaused(true)
    create.mutate(
      { ...input, layout: state.layout, ...(input.kind === 'render' ? { siStyle } : {}) },
      {
        onSuccess: (created) => void finishDraft().then(() => onNodeCreated(created.node.id)),
        onError: () => setPaused(false),
      },
    )
  }

  const stage = stageOf(baseNode.kind)
  const namesUnder = (parentId: string | null) =>
    nodes.filter((n) => n.parentId === parentId).map((n) => n.name)

  /** 新建副本: a sibling in the same stage with the current layout; editing goes on there. */
  function copyNode() {
    const parentId = stageParentId(nodes, baseNode)
    if (!parentId || (stage !== 'plan' && stage !== 'white')) return
    createFromLayout({
      kind: stage,
      parentId,
      name: copyName(baseNode.name, namesUnder(parentId)),
      sourceNodeId: baseNode.id,
    })
  }

  /** The next stage, one level down: plan → white model → render. */
  function advance() {
    if (stage === 'plan') {
      createFromLayout({
        kind: 'white',
        parentId: baseNode.id,
        name: freshName('白模确认', namesUnder(baseNode.id)),
      })
    } else if (stage === 'white') {
      createFromLayout({
        kind: 'render',
        parentId: baseNode.id,
        name: freshName('渲染', namesUnder(baseNode.id)),
      })
    } else if (stage === 'space') {
      createFromLayout({
        kind: 'plan',
        parentId: baseNode.id,
        name: freshName('方案 · 手动排布', namesUnder(baseNode.id)),
      })
    }
  }

  async function discard() {
    if (!window.confirm('丢弃后草稿中的修改无法恢复，确定丢弃吗？')) return
    setPaused(true)
    await finishDraft()
    dispatch({ type: 'load', layout: baseNode.layout ?? EMPTY_LAYOUT })
    setSaveState('idle')
    setPaused(false)
  }

  async function reloadDraft() {
    await client.invalidateQueries({ queryKey: workbenchKeys.draft(projectId) })
    const latest = client.getQueryData<Draft | null>(workbenchKeys.draft(projectId))
    revision.current = latest?.revision ?? null
    dispatch({
      type: 'load',
      layout:
        latest?.baseNodeId === baseNode.id ? latest.layout : (baseNode.layout ?? EMPTY_LAYOUT),
    })
    setSaveState(latest ? 'saved' : 'idle')
  }

  function onItemPointerDown(item: LayoutItem, event: ReactPointerEvent<SVGGElement>) {
    event.stopPropagation()
    dispatch({ type: 'select', id: item.id })
    const world = toWorld(svgRef.current, event)
    if (!world || item.locked) return
    drag.current = {
      id: item.id,
      dx: world[0] - item.cx,
      dz: world[1] - item.cz,
      group: `drag:${item.id}:${event.timeStamp}`,
    }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    const world = toWorld(svgRef.current, event)
    if (world)
      dispatch({
        type: 'move',
        id: drag.current.id,
        cx: world[0] - drag.current.dx,
        cz: world[1] - drag.current.dz,
        group: drag.current.group,
        // Hold Alt to place freely without sticking to walls and neighbours.
        snapTo: event.altKey ? null : space,
      })
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!selected) return
    const step = event.shiftKey ? 0.1 : 0.01
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      dispatch({ type: 'nudge', id: selected.id, dx: move[0], dz: move[1] })
    } else if (event.key === 'r' || event.key === 'R') {
      dispatch({
        type: 'rotate',
        id: selected.id,
        asset: selected.assetId ? assetMap.get(selected.assetId) : undefined,
      })
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      dispatch({ type: 'remove', id: selected.id })
    } else if (event.key === 'Escape') {
      dispatch({ type: 'select', id: null })
    }
  }

  function addAsset(asset: Asset) {
    const xs = space.boundary.map((p) => p[0])
    const zs = space.boundary.map((p) => p[1])
    dispatch({
      type: 'add',
      asset,
      cx: (Math.min(...xs) + Math.max(...xs)) / 2,
      cz: (Math.min(...zs) + Math.max(...zs)) / 2,
    })
  }

  function switchView(next: 'plan' | '3d') {
    setView(next)
  }

  function showCamera(camera: Camera) {
    switchView('3d')
    viewerRef.current?.showView(camera)
  }

  const SAVE_LABELS = {
    idle: '未修改',
    saving: '正在保存草稿…',
    saved: '草稿已保存',
    conflict: '草稿已被其他窗口修改',
    error: '草稿保存失败',
  }

  const rotateSelected = (by: 90 | -90) => {
    if (!selected) return
    dispatch({
      type: 'rotate',
      id: selected.id,
      by,
      asset: selected.assetId ? assetMap.get(selected.assetId) : undefined,
    })
  }

  const planMain = view === 'plan'
  return (
    <WorkbenchLayout
      left={
        <>
          {left}
          <ModelPicker assets={assets} siStyle={siStyle} onPick={addAsset} />
        </>
      }
      center={
        <section className="plan-editor wb-card" aria-label="平面编辑">
          <h2 className="node-heading">{baseNode.name}</h2>
          <div className="toolbar">
            <div className="tabs" role="group" aria-label="视图">
              <button
                type="button"
                aria-pressed={view === 'plan'}
                onClick={() => switchView('plan')}
              >
                平面
              </button>
              <button type="button" aria-pressed={view === '3d'} onClick={() => switchView('3d')}>
                三维
              </button>
            </div>
            <span className="history-buttons">
              <button
                type="button"
                className="icon-button"
                aria-label="撤回"
                title="撤回（Ctrl+Z）"
                disabled={state.past.length === 0}
                onClick={() => dispatch({ type: 'undo' })}
              >
                <ArcArrow direction="left" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="重做"
                title="重做（Ctrl+Y）"
                disabled={state.future.length === 0}
                onClick={() => dispatch({ type: 'redo' })}
              >
                <ArcArrow direction="right" />
              </button>
            </span>
            <span className={`save-state ${saveState}`} role="status">
              {SAVE_LABELS[saveState]}
            </span>
          </div>

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
                : '三维白模：拖动道具在地面移动，拖动空白处旋转视角，滚轮缩放'
            }
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={onKeyDown}
          >
            {show3d && (
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
                    onReady={onViewerReady}
                    title={`${baseNode.name} 三维白模`}
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
            )}
            <div className={planMain ? 'view-main' : 'view-mini'}>
              <PlanView
                svgRef={svgRef}
                space={space}
                shopType={shopType}
                layout={state.layout}
                issues={issues}
                assets={assetMap}
                selectedId={state.selectedId}
                onItemPointerDown={onItemPointerDown}
                onBackgroundPointerDown={() => dispatch({ type: 'select', id: null })}
                compact={!planMain}
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
              second={
                stage === 'plan' || stage === 'white'
                  ? {
                      label: stage === 'plan' ? '确认白模' : '开始渲染',
                      onClick: advance,
                      primary: true,
                      disabled: create.isPending || errors.length > 0,
                    }
                  : undefined
              }
              hint={
                errors.length > 0 && stage !== 'space'
                  ? `解决检查中的问题后才能${stage === 'plan' ? '确认白模' : '开始渲染'}。`
                  : undefined
              }
            />
            <ErrorMessage error={create.error} />
          </div>

          <div className="wb-card properties" aria-label="选中道具">
            {selected ? (
              <>
                <div className="properties-head">
                  <h3>{assetMap.get(selected.assetId ?? '')?.name ?? selected.name}</h3>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="删除道具"
                    title="删除（Delete）"
                    onClick={() => dispatch({ type: 'remove', id: selected.id })}
                  >
                    <TrashIcon />
                  </button>
                </div>
                <div className="field-row">
                  道具尺寸
                  <output>
                    {mToMm(selected.w)} × {mToMm(selected.d)} × {mToMm(selected.h)} mm
                    {selected.placeholder ? '（占位）' : ''}
                  </output>
                </div>
                <label className="field-row">
                  水平位置
                  <input
                    type="number"
                    step={10}
                    value={mToMm(selected.cx)}
                    onChange={(e) =>
                      dispatch({
                        type: 'move',
                        id: selected.id,
                        cx: mmToM(Number(e.target.value)),
                        cz: selected.cz,
                      })
                    }
                  />
                </label>
                <label className="field-row">
                  垂直位置
                  <input
                    type="number"
                    step={10}
                    value={mToMm(selected.cz)}
                    onChange={(e) =>
                      dispatch({
                        type: 'move',
                        id: selected.id,
                        cx: selected.cx,
                        cz: mmToM(Number(e.target.value)),
                      })
                    }
                  />
                </label>
                <div className="field-row">
                  旋转角度
                  <output>{selected.rotation}°</output>
                  <span className="history-buttons">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="逆时针旋转 90°"
                      onClick={() => rotateSelected(-90)}
                    >
                      <ArcArrow direction="left" />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="顺时针旋转 90°"
                      onClick={() => rotateSelected(90)}
                    >
                      <ArcArrow direction="right" />
                    </button>
                  </span>
                </div>
              </>
            ) : (
              <>
                <h3>选中道具</h3>
                <p className="hint">
                  点击道具选中；拖动移动（靠近墙或道具会吸附，按住 Alt 关闭），方向键微调 10
                  mm（Shift 100 mm），R 旋转，Delete 删除。
                </p>
              </>
            )}
          </div>

          <div className="wb-card">
            <h3>检查（{errors.length} 个问题）</h3>
            <ul className="issues">
              {issues.length === 0 && <li className="hint">没有越界、重叠或模型尺寸问题</li>}
              {issues.map((issue, i) => (
                <li key={i} className={issue.severity}>
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>

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
