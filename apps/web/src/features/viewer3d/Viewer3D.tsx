import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Ref } from 'react'
import { VIEW_ASPECT } from '@store/shared'
import type { Asset, Camera, Layout, ShopType, Space } from '@store/shared'
import { WhiteScene } from './white-scene.ts'
import type { LoadStatus, ViewPose } from './white-scene.ts'

type View = Pick<Camera, 'position' | 'target' | 'fovDeg'>

export interface Viewer3DHandle {
  currentView: () => ViewPose
  showView: (view: View) => void
  /** Waits for models still loading, then renders each view to a PNG data URL. */
  renderViews: (views: readonly View[], width: number, height: number) => Promise<string[]>
}

interface Viewer3DProps {
  space: Space
  shopType: ShopType
  layout: Layout
  assets: ReadonlyMap<string, Asset>
  selectedId: string | null
  flaggedIds: ReadonlySet<string>
  onSelect: (itemId: string | null) => void
  onMove: (itemId: string, cx: number, cz: number) => void
  /** Called once the scene exists, so callers can start using the handle. */
  onReady?: (() => void) | undefined
  ref?: Ref<Viewer3DHandle> | undefined
  title: string
}

/**
 * The white model in 3D: orbit to look around, drag props on the floor. Edits go through the
 * same callbacks as the plan, so both views always show one layout.
 */
export function Viewer3D({
  space,
  shopType,
  layout,
  assets,
  selectedId,
  flaggedIds,
  onSelect,
  onMove,
  onReady,
  ref,
  title,
}: Viewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<WhiteScene | null>(null)
  const viewedSpace = useRef<Space | null>(null)
  const readyCallback = useRef(onReady)
  readyCallback.current = onReady
  const [status, setStatus] = useState<LoadStatus>({ loading: 0, failed: [] })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let scene: WhiteScene
    try {
      scene = new WhiteScene(canvas)
    } catch {
      setError('浏览器无法启动三维显示（WebGL 不可用）')
      return
    }
    sceneRef.current = scene
    scene.onStatus(setStatus)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) scene.resize(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(canvas)
    readyCallback.current?.()
    return () => {
      observer.disconnect()
      scene.dispose()
      sceneRef.current = null
      viewedSpace.current = null
    }
  }, [])

  // Latest callbacks without re-creating the scene.
  useEffect(() => {
    sceneRef.current?.setHandlers({ onSelect, onMove })
  }, [onSelect, onMove])

  useEffect(() => {
    // The view resets only when a different space is shown, not after every edit.
    sceneRef.current?.setRoom(space, shopType, viewedSpace.current !== space)
    viewedSpace.current = space
  }, [space, shopType])

  useEffect(() => {
    sceneRef.current?.setItems(layout.items, assets)
  }, [layout, assets])

  useEffect(() => {
    sceneRef.current?.setMarks(selectedId, flaggedIds)
  }, [selectedId, flaggedIds, layout])

  useImperativeHandle(
    ref,
    () => ({
      currentView: () =>
        sceneRef.current?.currentView() ?? { position: [0, 1, 0], target: [0, 0, 0], fovDeg: 48 },
      showView: (view) => sceneRef.current?.showView(view),
      renderViews: async (views, width, height) => {
        const scene = sceneRef.current
        if (!scene) return []
        await scene.whenLoaded()
        return sceneRef.current === scene ? await scene.renderViews(views, width, height) : []
      },
    }),
    [],
  )

  if (error) return <p className="error">{error}</p>
  return (
    <div className="viewer3d">
      <canvas ref={canvasRef} style={{ aspectRatio: String(VIEW_ASPECT) }} aria-label={title} />
      {(status.loading > 0 || status.failed.length > 0) && (
        <p className="viewer3d-status hint" role="status">
          {status.loading > 0 ? `正在加载 ${status.loading} 个模型…` : null}
          {status.failed.length > 0
            ? ` ${status.failed.length} 个模型未能加载，以方框代替：${status.failed.join('、')}`
            : null}
        </p>
      )}
    </div>
  )
}
