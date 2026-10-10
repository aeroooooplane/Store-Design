import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { Camera, Layout } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import type { Viewer3DHandle } from '../viewer3d/Viewer3D.tsx'
import { useCameraAction, useCameras } from './api.ts'

const THUMB = { width: 240, height: 160 }
const THUMB_DELAY_MS = 400

interface CameraPanelProps {
  nodeId: string
  viewer: RefObject<Viewer3DHandle | null>
  /** The 3D view loads lazily; thumbnails wait for it. */
  viewerReady: boolean
  /** Thumbnails are redrawn when the layout on screen changes. */
  layout: Layout
  onShow: (camera: Camera) => void
}

/**
 * The views of a confirmed white model: eight defaults, plus any the user adds from the
 * current 3D view. Removed views stay listed below and can be restored.
 */
export function CameraPanel({ nodeId, viewer, viewerReady, layout, onShow }: CameraPanelProps) {
  const cameras = useCameras(nodeId)
  const action = useCameraAction(nodeId)
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map())

  const all = cameras.data ?? []
  const active = all.filter((c) => c.deletedAt === null)
  const removed = all.filter((c) => c.deletedAt !== null)
  // Redraw only when what the thumbnails show actually changes.
  const poses = JSON.stringify(active.map((c) => [c.id, c.camera]))

  useEffect(() => {
    const list = JSON.parse(poses) as [string, Camera][]
    if (!list.length || !viewerReady) return
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
    }, THUMB_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [poses, layout, viewer, viewerReady])

  function addCurrent() {
    const view = viewer.current?.currentView()
    if (!view) return
    action.mutate({ type: 'add', camera: { name: `自定义视角 ${active.length + 1}`, ...view } })
  }

  return (
    <section className="camera-panel" aria-label="视角">
      <div className="toolbar">
        <h3>视角（{active.length}）</h3>
        <button type="button" disabled={action.isPending} onClick={addCurrent}>
          添加当前视角
        </button>
        <span className="hint">点击缩略图在三维中查看；旋转到合适角度后可添加或替换视角。</span>
      </div>
      <ErrorMessage error={cameras.error ?? action.error} />
      <ol className="camera-grid">
        {active.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="camera-thumb"
              aria-label={`查看视角 ${c.camera.name}`}
              onClick={() => onShow(c.camera)}
            >
              {thumbs.get(c.id) ? (
                <img src={thumbs.get(c.id)} alt="" width={THUMB.width} height={THUMB.height} />
              ) : (
                <span className="camera-thumb-empty">生成预览…</span>
              )}
            </button>
            <div className="camera-meta">
              <span>
                {c.camera.name}
                {c.camera.source === 'user' ? <span className="hint"> · 自定义</span> : null}
              </span>
              <span className="camera-actions">
                <button
                  type="button"
                  disabled={action.isPending}
                  title="把这个视角改为三维中当前看到的角度"
                  onClick={() => {
                    const view = viewer.current?.currentView()
                    if (view) action.mutate({ type: 'update', cameraId: c.id, patch: view })
                  }}
                >
                  设为当前
                </button>
                <button
                  type="button"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ type: 'remove', cameraId: c.id })}
                >
                  删除
                </button>
              </span>
            </div>
          </li>
        ))}
      </ol>
      {removed.length > 0 && (
        <p className="hint">
          已删除：
          {removed.map((c) => (
            <button
              key={c.id}
              type="button"
              className="link-button"
              disabled={action.isPending}
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
