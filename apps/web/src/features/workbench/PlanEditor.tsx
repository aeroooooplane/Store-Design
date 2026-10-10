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
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { checkAssetFit, mToMm, mmToM, validateLayout } from '@store/shared'
import type {
  Asset,
  Camera,
  DesignNode,
  Draft,
  Layout,
  LayoutItem,
  ShopType,
  Space,
} from '@store/shared'
import { ApiRequestError } from '../../api/client.ts'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import type { Viewer3DHandle } from '../viewer3d/Viewer3D.tsx'
import { deleteDraft, putDraft, useCreateNode, workbenchKeys } from './api.ts'
import { CameraPanel } from './CameraPanel.tsx'
import { editorReducer } from './editor-state.ts'
import { PlanView } from './PlanView.tsx'

// Three.js is only downloaded when a 3D view is first opened.
const Viewer3D = lazy(() =>
  import('../viewer3d/Viewer3D.tsx').then((module) => ({ default: module.Viewer3D })),
)

const AUTOSAVE_DELAY_MS = 800
const EMPTY_LAYOUT: Layout = { schemaVersion: 3, items: [], planning: null }

interface PlanEditorProps {
  projectId: string
  baseNode: DesignNode
  space: Space
  shopType: ShopType
  /** The shared draft, if it continues this node. */
  draft: Draft | null
  assets: Asset[]
  onNodeCreated: (nodeId: string) => void
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
  draft,
  assets,
  onNodeCreated,
}: PlanEditorProps) {
  const client = useQueryClient()
  const create = useCreateNode(projectId)
  const startLayout = draft?.layout ?? baseNode.layout ?? EMPTY_LAYOUT
  const [state, dispatch] = useReducer(editorReducer, {
    layout: startLayout,
    selectedId: null,
    dirty: false,
  })
  const revision = useRef<number | null>(draft?.revision ?? null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>(
    draft ? 'saved' : 'idle',
  )
  const [saveError, setSaveError] = useState<unknown>(null)
  const [addAssetId, setAddAssetId] = useState('')
  const svgRef = useRef<SVGSVGElement>(null)
  const viewerRef = useRef<Viewer3DHandle>(null)
  const isWhite = baseNode.kind === 'white'
  const [view, setView] = useState<'plan' | '3d'>(isWhite ? '3d' : 'plan')
  /** The 3D scene stays mounted once opened (white models always), so switching is instant. */
  const [show3d, setShow3d] = useState(isWhite)
  const [viewerReady, setViewerReady] = useState(false)
  const onViewerReady = useCallback(() => setViewerReady(true), [])
  const drag = useRef<{ id: string; dx: number; dz: number } | null>(null)
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
  const move = useCallback(
    (id: string, cx: number, cz: number) => dispatch({ type: 'move', id, cx, cz }),
    [],
  )
  const selected = state.layout.items.find((i) => i.id === state.selectedId) ?? null

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

  function saveAs(kind: 'edit' | 'white') {
    setPaused(true)
    create.mutate(
      {
        parentId: baseNode.id,
        kind,
        name: kind === 'white' ? '白模确认' : '编辑版本',
        layout: state.layout,
      },
      {
        onSuccess: (created) => void finishDraft().then(() => onNodeCreated(created.node.id)),
        onError: () => setPaused(false),
      },
    )
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
    drag.current = { id: item.id, dx: world[0] - item.cx, dz: world[1] - item.cz }
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

  function addAsset() {
    const asset = assetMap.get(addAssetId)
    if (!asset) return
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
    if (next === '3d') setShow3d(true)
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

  return (
    <section className="plan-editor" aria-label="平面编辑">
      <div className="toolbar">
        <div className="tabs" role="group" aria-label="视图">
          <button type="button" aria-pressed={view === 'plan'} onClick={() => switchView('plan')}>
            平面
          </button>
          <button type="button" aria-pressed={view === '3d'} onClick={() => switchView('3d')}>
            三维
          </button>
        </div>
        <button
          type="button"
          disabled={!selected}
          onClick={() =>
            selected &&
            dispatch({
              type: 'rotate',
              id: selected.id,
              asset: selected.assetId ? assetMap.get(selected.assetId) : undefined,
            })
          }
        >
          旋转 90°
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={() => selected && dispatch({ type: 'remove', id: selected.id })}
        >
          删除
        </button>
        <label className="field inline">
          添加模型
          <select
            aria-label="选择要添加的模型"
            value={addAssetId}
            onChange={(e) => setAddAssetId(e.target.value)}
          >
            <option value="">选择模型…</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.siFamily} · {asset.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!addAssetId} onClick={addAsset}>
          放到中央
        </button>
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

      <div className="plan-editor-body">
        <div
          className="plan-canvas"
          tabIndex={0}
          aria-label={
            view === 'plan'
              ? '平面画布：拖动移动，方向键微调，R 旋转，Delete 删除'
              : '三维白模：拖动道具在地面移动，拖动空白处旋转视角，滚轮缩放'
          }
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={onKeyDown}
        >
          {show3d && (
            <div hidden={view !== '3d'}>
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
            </div>
          )}
          <div hidden={view !== 'plan'}>
            <PlanView
              svgRef={svgRef}
              space={space}
              layout={state.layout}
              issues={issues}
              assets={assetMap}
              selectedId={state.selectedId}
              onItemPointerDown={onItemPointerDown}
              onBackgroundPointerDown={() => dispatch({ type: 'select', id: null })}
              title={`${baseNode.name} 平面`}
            />
          </div>
        </div>
        <aside className="plan-side">
          {selected ? (
            <div className="properties" aria-label="选中道具">
              <h3>{selected.name}</h3>
              <p className="hint">
                {mToMm(selected.w)} × {mToMm(selected.d)} × {mToMm(selected.h)} mm · 旋转{' '}
                {selected.rotation}°{selected.placeholder ? ' · 参数化占位' : ''}
              </p>
              <label className="field">
                中心 x（mm）
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
              <label className="field">
                中心 z（mm）
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
            </div>
          ) : (
            <p className="hint">
              点击道具选中；拖动移动，方向键微调 10 mm（Shift 100 mm），R 旋转，Delete 删除。
            </p>
          )}
          <h3>检查（{errors.length} 个问题）</h3>
          <ul className="issues">
            {issues.length === 0 && <li className="hint">没有越界、重叠或模型尺寸问题</li>}
            {issues.map((issue, i) => (
              <li key={i} className={issue.severity}>
                {issue.message}
              </li>
            ))}
          </ul>
          <div className="toolbar vertical">
            <button type="button" disabled={create.isPending} onClick={() => saveAs('edit')}>
              保存为新版本
            </button>
            <button
              type="button"
              className="primary"
              disabled={create.isPending || errors.length > 0}
              onClick={() => saveAs('white')}
            >
              确认白模
            </button>
            {errors.length > 0 && <p className="hint">解决以上问题后才能确认白模。</p>}
            <button
              type="button"
              disabled={saveState === 'idle' && !state.dirty}
              onClick={() => void discard()}
            >
              丢弃草稿
            </button>
          </div>
          <ErrorMessage error={create.error} />
        </aside>
      </div>
      {isWhite && (
        <CameraPanel
          nodeId={baseNode.id}
          viewer={viewerRef}
          viewerReady={viewerReady}
          layout={state.layout}
          onShow={showCamera}
        />
      )}
    </section>
  )
}
