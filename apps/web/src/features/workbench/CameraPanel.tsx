import { useContext, useEffect, useRef, useState } from 'react'
import { Crosshair, Pencil, Trash2 } from 'lucide-react'
import type { RefObject } from 'react'
import type { Camera, Layout, NodeCamera, RenderImage } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import type { Viewer3DHandle } from '../viewer3d/Viewer3D.tsx'
import { useCameraAction, useCameras, useInitializeCameras } from './api.ts'
import { CameraPanelVisibility } from './WorkbenchLayout.tsx'

const THUMB = { width: 240, height: 160 }
const THUMB_DELAY_MS = 400

interface CameraPanelProps {
  nodeId: string
  viewer: RefObject<Viewer3DHandle | null>
  /** The 3D view loads lazily; thumbnails wait for it. */
  viewerReady: boolean
  /** Thumbnails are redrawn when the layout on screen changes. */
  layout: Layout
  onShow: (camera: NodeCamera) => void
  /** The main view must be in 3D to capture the user's orbit. */
  canCapture?: boolean
  onOpenViewer?: () => void
  selectedId?: string | null
  renderImages?: ReadonlyMap<string, RenderImage>
  disabled?: boolean
  actionsDisabled?: boolean
}

/**
 * Saved views belong to the current node. Opening the tab initializes older nodes lazily.
 */
export function CameraPanel({
  nodeId,
  viewer,
  viewerReady,
  layout,
  onShow,
  canCapture = true,
  onOpenViewer,
  selectedId,
  renderImages,
  disabled = false,
  actionsDisabled = false,
}: CameraPanelProps) {
  const visible = useContext(CameraPanelVisibility)
  const cameras = useCameras(nodeId, visible)
  const action = useCameraAction(nodeId)
  const init = useInitializeCameras(nodeId)
  const initialize = init.mutate
  const initializedNode = useRef<string | null>(null)
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null)
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map())

  const all = cameras.data ?? []
  const active = all.filter((c) => c.deletedAt === null)
  const removed = all.filter((c) => c.deletedAt !== null)
  // Redraw only when what the thumbnails show actually changes.
  const poses = JSON.stringify(
    active.map(({ id, camera: { position, target, fovDeg } }) => [
      id,
      { position, target, fovDeg },
    ]),
  )
  const needsInitialization = cameras.data?.length === 0 && !init.isSuccess
  const locked =
    disabled || actionsDisabled || action.isPending || needsInitialization || !cameras.data
  const captureDisabled = locked || !viewerReady || !canCapture

  useEffect(() => {
    if (!visible || !needsInitialization || initializedNode.current === nodeId) return
    initializedNode.current = nodeId
    initialize()
  }, [visible, needsInitialization, nodeId, initialize])

  useEffect(() => {
    const list = JSON.parse(poses) as [string, Pick<Camera, 'position' | 'target' | 'fovDeg'>][]
    if (!list.length || !viewerReady || !visible || renderImages) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void viewer.current
        ?.renderViews(
          list.map(([, camera]) => camera),
          THUMB.width,
          THUMB.height,
        )
        .then((images) => {
          if (!cancelled && images.length === list.length) {
            setThumbs(new Map(list.map(([id], i) => [id, images[i] ?? ''])))
          }
        })
        .catch(() => undefined)
    }, THUMB_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [poses, layout, viewer, viewerReady, visible, renderImages])

  function addCurrent() {
    const view = captureDisabled ? null : viewer.current?.currentView()
    if (!view) return
    const names = new Set(all.map((c) => c.camera.name))
    let number = active.length + 1
    while (names.has(`自定义视角 ${number}`)) number++
    action.mutate({ type: 'add', camera: { name: `自定义视角 ${number}`, ...view } })
  }

  return (
    <section className="camera-panel" aria-label="视角">
      <div className="toolbar">
        <h3>视角（{active.length}）</h3>
        <button type="button" disabled={captureDisabled} onClick={addCurrent}>
          添加当前视角
        </button>
        {!canCapture && onOpenViewer && (
          <button type="button" disabled={disabled} onClick={onOpenViewer}>
            打开三维
          </button>
        )}
        <span className="hint">旋转三维到合适角度后，可添加视角或用当前角度调整已有视角。</span>
      </div>
      <ErrorMessage error={cameras.error ?? init.error ?? action.error} />
      {init.isError && (
        <button type="button" onClick={() => initialize()}>
          重试初始化视角
        </button>
      )}
      {(cameras.isLoading || init.isPending) && (
        <p className="hint" role="status">
          正在准备视角…
        </p>
      )}
      {!!cameras.data && !needsInitialization && active.length === 0 && (
        <p className="hint">暂无视角，可在三维中添加当前视角。</p>
      )}
      <ol className="camera-grid">
        {active.map((c) => {
          const image = renderImages?.get(c.id)
          const preview = image?.url ?? thumbs.get(c.id)
          return (
            <li key={c.id} className="camera-tile">
              <button
                type="button"
                className="camera-thumb"
                aria-label={`查看视角 ${c.camera.name}`}
                aria-pressed={selectedId === undefined ? undefined : c.id === selectedId}
                disabled={disabled}
                onClick={() => onShow(c)}
              >
                {preview ? (
                  <img src={preview} alt="" width={THUMB.width} height={THUMB.height} />
                ) : (
                  <span className="camera-thumb-empty">
                    {renderImages ? '未渲染' : viewerReady ? '生成预览…' : '打开三维后显示预览'}
                  </span>
                )}
              </button>
              <span className="camera-name">
                {c.camera.name}
                {c.camera.source === 'user' ? <span className="hint"> · 自定义</span> : null}
                {image?.stale && <span className="tag render-status warning">过期</span>}
              </span>
              <span className="camera-actions">
                <button
                  type="button"
                  aria-label="设为当前"
                  disabled={captureDisabled}
                  title="设为当前：用三维中正在看的角度替换这个视角"
                  onClick={() => {
                    const view = captureDisabled ? null : viewer.current?.currentView()
                    if (view) action.mutate({ type: 'update', cameraId: c.id, patch: view })
                  }}
                >
                  <Crosshair size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`重命名视角 ${c.camera.name}`}
                  title="重命名视角"
                  disabled={locked}
                  onClick={() => setRename({ id: c.id, name: c.camera.name })}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="删除"
                  disabled={locked}
                  title="删除这个视角（可在下方恢复）"
                  onClick={() => action.mutate({ type: 'remove', cameraId: c.id })}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </span>
              {rename?.id === c.id && (
                <form
                  className="camera-rename"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const name = rename.name.trim()
                    if (!name || locked) return
                    if (name === c.camera.name) setRename(null)
                    else
                      action.mutate(
                        { type: 'update', cameraId: c.id, patch: { name } },
                        { onSuccess: () => setRename(null) },
                      )
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setRename(null)
                  }}
                >
                  <input
                    aria-label="视角名称"
                    autoFocus
                    maxLength={40}
                    value={rename.name}
                    onChange={(event) => setRename({ id: c.id, name: event.target.value })}
                  />
                  <button type="submit" disabled={locked || !rename.name.trim()}>
                    保存
                  </button>
                  <button type="button" onClick={() => setRename(null)}>
                    取消
                  </button>
                </form>
              )}
            </li>
          )
        })}
      </ol>
      {removed.length > 0 && (
        <p className="hint">
          已删除：
          {removed.map((c) => (
            <button
              key={c.id}
              type="button"
              className="link-button"
              disabled={locked}
              onClick={() => action.mutate({ type: 'restore', cameraId: c.id })}
            >
              恢复「{c.camera.name}」
            </button>
          ))}
        </p>
      )}
    </section>
  )
}
