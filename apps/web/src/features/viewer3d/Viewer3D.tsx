import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'
import { Raycaster, Vector2 } from 'three'
import type { Object3D } from 'three'
import {
  VIEW_ASPECT,
  effectiveCeiling,
  facadeGeometry,
  facadeKind,
  reviewFacadeConfig,
  supportsFacade,
} from '@store/shared'
import type {
  Asset,
  Camera,
  Layout,
  Market,
  RenderBackground,
  ShopType,
  SiStyle,
  Space,
} from '@store/shared'
import { WhiteScene } from './white-scene.ts'
import type { LoadStatus, Look, SceneHandlers, ViewPose } from './white-scene.ts'
import type { ModelPlacementClick } from '../workbench/editor-state.ts'
import { useCeilingPreview } from '../workbench/ceiling-preview.ts'

type View = Pick<Camera, 'position' | 'target' | 'fovDeg'>

function frontFacadeView(
  geometry: NonNullable<ReturnType<typeof facadeGeometry>>,
  height: number,
): View {
  const { width, origin, direction, outward } = geometry
  const fovDeg = 43
  const halfFov = Math.tan((fovDeg * Math.PI) / 360)
  const distance = (Math.max(height, width / VIEW_ASPECT) / (2 * halfFov)) * 1.22
  const x = origin[0] + (direction[0] * width) / 2
  const z = origin[1] + (direction[1] * width) / 2
  const y = height * 0.5
  return {
    target: [x, y, z],
    position: [x + outward[0] * distance, y + distance * 0.045, z + outward[1] * distance],
    fovDeg,
  }
}

function facadeViews(space: Space, shop: ShopType, si: SiStyle, market: Market) {
  const config = space.facade
  if (!config || !supportsFacade(shop, facadeKind(config))) return []
  const reviewed = reviewFacadeConfig(space, config, si, market)
  if (!reviewed?.sections.length) return []
  const height = (section: (typeof reviewed.sections)[number]) =>
    section.fasciaBottom + section.fasciaHeight
  const first = reviewed.sections[0]!
  if (!('kind' in config) || config.kind === 'island_hanging')
    return [{ label: '正看门头', view: frontFacadeView(first.frame, height(first)) }]
  if (config.kind === 'double') {
    const frame = facadeGeometry(space, { ...config, openingWidth: 0 })!
    return [{ label: '正看门头', view: frontFacadeView(frame, height(first)) }]
  }
  const second = reviewed.sections[1]!
  const a = frontFacadeView(first.frame, height(first))
  const b = frontFacadeView(second.frame, height(second))
  const target: View['target'] = [
    (a.target[0] + b.target[0]) / 2,
    (a.target[1] + b.target[1]) / 2,
    (a.target[2] + b.target[2]) / 2,
  ]
  const x = first.frame.outward[0] + second.frame.outward[0]
  const z = first.frame.outward[1] + second.frame.outward[1]
  const distance = Math.max(
    2.5,
    Math.hypot(a.position[0] - a.target[0], a.position[2] - a.target[2]),
    Math.hypot(b.position[0] - b.target[0], b.position[2] - b.target[2]),
    (first.frame.width + second.frame.width) * 0.9,
  )
  const length = Math.hypot(x, z) || 1
  const overview: View = {
    target,
    position: [
      target[0] + (x / length) * distance,
      target[1] + distance * 0.22,
      target[2] + (z / length) * distance,
    ],
    fovDeg: 43,
  }
  return [
    { label: '门头总览', view: overview },
    { label: '正看 A', view: a },
    { label: '正看 B', view: b },
  ]
}

function visibleWallAt(
  scene: WhiteScene,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): ModelPlacementClick | null {
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const ray = new Raycaster()
  const screen = new Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    1 - ((clientY - rect.top) / rect.height) * 2,
  )
  ray.setFromCamera(screen, scene.camera)
  const surfaces: Object3D[] = []
  scene.scene.traverseVisible((object) => {
    const surface: unknown = object.userData['surface']
    if (object.userData['boundaryWall'] || surface === 'partition' || surface === 'floor')
      surfaces.push(object)
  })
  const hit = ray.intersectObjects(surfaces, false)[0]
  if (!hit?.face || hit.object.userData['surface'] === 'floor') return null
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
  if (Math.hypot(normal.x, normal.z) < 0.5) normal.copy(ray.ray.direction).negate()
  normal.y = 0
  normal.normalize()
  return { point: [hit.point.x, hit.point.z], normal: [normal.x, normal.z] }
}

export interface Viewer3DHandle {
  currentView: () => ViewPose
  showView: (view: View) => void
  /**
   * Waits for models still loading, then renders each view to a PNG data URL, in the given look
   * (default: the one on screen). Pass each view's saved background snapshot for a composite.
   */
  renderViews: (
    views: readonly View[],
    width: number,
    height: number,
    look?: Look,
    backgrounds?: readonly (RenderBackground | null | undefined)[],
  ) => Promise<string[]>
}

interface Viewer3DProps {
  space: Space
  shopType: ShopType
  layout: Layout
  assets: ReadonlyMap<string, Asset>
  selectedId: string | null
  flaggedIds: ReadonlySet<string>
  /** White model (default) or the material look of the renders. */
  look?: Look | undefined
  background?: RenderBackground | null | undefined
  /** Hide the gray boundary walls during background editing before the first photo is added. */
  hideBoundaryWalls?: boolean | undefined
  facadeControls?: boolean | undefined
  preferFacadeView?: boolean | undefined
  siStyle?: SiStyle | undefined
  /** The project's market: LOGO models with a version per market show that one. */
  market?: Market | undefined
  onSelect: (itemId: string | null) => void
  /** Leave out for a read-only view: props can be selected but not dragged. */
  onMove?:
    | ((itemId: string, cx: number, cz: number, gesture: { group: string; snap: boolean }) => void)
    | undefined
  /** A LOGO dragged by a corner of its front; leave out where LOGOs cannot be resized. */
  onResize?: SceneHandlers['onResize'] | undefined
  /** Turns the selected prop by its ring; leave out for no ring. */
  onRotate?: SceneHandlers['onRotate'] | undefined
  onFloorPlace?: SceneHandlers['onFloorPlace'] | undefined
  onWallPlace?: ((click: ModelPlacementClick | null) => void) | undefined
  /** Called once the scene exists, so callers can start using the handle. */
  onReady?: (() => void) | undefined
  /** Where the camera starts instead of the default front view (e.g. the view last used). */
  initialView?: ViewPose | null | undefined
  /** The view after the user orbits, pans or zooms, and the last one when the view closes. */
  onViewChange?: ((pose: ViewPose) => void) | undefined
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
  look = 'white',
  background,
  hideBoundaryWalls = false,
  facadeControls = false,
  preferFacadeView = false,
  siStyle = 'SI1.0',
  market = 'domestic',
  onSelect,
  onMove,
  onResize,
  onRotate,
  onFloorPlace,
  onWallPlace,
  onReady,
  initialView,
  onViewChange,
  ref,
  title,
}: Viewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const compositionRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<WhiteScene | null>(null)
  const viewedSpace = useRef<Space | null>(null)
  const readyCallback = useRef(onReady)
  readyCallback.current = onReady
  const viewCallback = useRef(onViewChange)
  viewCallback.current = onViewChange
  const startView = useRef(initialView)
  const [status, setStatus] = useState<LoadStatus>({ loading: 0, failed: [] })
  const [error, setError] = useState<string | null>(null)
  const [backgroundError, setBackgroundError] = useState<string | null>(null)
  const [facadeVisible, setFacadeVisible] = useState(true)
  const wantsCeiling = useCeilingPreview()
  const ceilingVisible = wantsCeiling && effectiveCeiling(space, shopType, siStyle) !== 'none'
  const views = useMemo(
    () => facadeViews(space, shopType, siStyle, market),
    [space, shopType, siStyle, market],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let scene: WhiteScene
    try {
      scene = new WhiteScene(canvas, compositionRef.current ?? undefined)
    } catch {
      setError('浏览器无法启动三维显示（WebGL 不可用）')
      return
    }
    sceneRef.current = scene
    scene.onStatus(setStatus)
    scene.onView((pose) => viewCallback.current?.(pose))
    const observer = new ResizeObserver(([entry]) => {
      if (entry) scene.resize(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(canvas)
    readyCallback.current?.()
    return () => {
      observer.disconnect()
      // A view set from outside (a camera shown) is the last one too.
      viewCallback.current?.(scene.currentView())
      scene.dispose()
      sceneRef.current = null
      viewedSpace.current = null
    }
  }, [])

  // Latest callbacks without re-creating the scene.
  useEffect(() => {
    sceneRef.current?.setHandlers({ onSelect, onMove, onResize, onRotate, onFloorPlace })
  }, [onSelect, onMove, onResize, onRotate, onFloorPlace])

  // Set the correct SI before building the room so the default SI's floor is never painted first.
  useEffect(() => {
    sceneRef.current?.setLook(look, siStyle)
  }, [look, siStyle])

  useEffect(() => {
    // The view resets only when a different space is shown, not after every edit; the first
    // space opens at the view handed in, if any.
    const start =
      viewedSpace.current === null
        ? (startView.current ?? (preferFacadeView ? views[0]?.view : null))
        : null
    sceneRef.current?.setRoom(space, shopType, viewedSpace.current !== space && !start)
    if (start) sceneRef.current?.showView(start)
    viewedSpace.current = space
  }, [space, shopType, preferFacadeView, views])

  useEffect(() => {
    sceneRef.current?.setItems(layout.items, assets, market)
  }, [layout, assets, market, space])

  useEffect(() => {
    sceneRef.current?.setFixtures(layout.fixtures ?? [], layout.items)
  }, [layout.fixtures, layout.items])

  useEffect(() => {
    sceneRef.current?.setFacade(space, shopType, siStyle, market)
  }, [space, shopType, siStyle, market])

  useEffect(() => {
    sceneRef.current?.setFacadeVisible(facadeVisible)
  }, [facadeVisible])

  useEffect(() => {
    sceneRef.current?.setCeiling(space, shopType, siStyle, ceilingVisible)
  }, [space, shopType, siStyle, ceilingVisible])

  useEffect(() => {
    let active = true
    setBackgroundError(null)
    void sceneRef.current?.setBackground(background ?? null).catch((caught: unknown) => {
      if (active) setBackgroundError(caught instanceof Error ? caught.message : '背景图片无法加载')
    })
    return () => {
      active = false
    }
  }, [background])

  useEffect(() => {
    sceneRef.current?.setHideBoundaryWalls(hideBoundaryWalls)
  }, [hideBoundaryWalls])

  useEffect(() => {
    sceneRef.current?.setMarks(selectedId, flaggedIds)
  }, [selectedId, flaggedIds, layout])

  useImperativeHandle(
    ref,
    () => ({
      currentView: () =>
        sceneRef.current?.currentView() ?? { position: [0, 1, 0], target: [0, 0, 0], fovDeg: 48 },
      showView: (view) => sceneRef.current?.showView(view),
      renderViews: async (views, width, height, look, backgrounds) =>
        (await sceneRef.current?.renderViews(views, width, height, look, backgrounds)) ?? [],
    }),
    [],
  )

  if (error) return <p className="error">{error}</p>
  return (
    <div className="viewer3d">
      <canvas
        ref={canvasRef}
        style={{
          aspectRatio: String(VIEW_ASPECT),
          ...(onWallPlace ? { cursor: 'crosshair' } : {}),
        }}
        aria-label={title}
        onPointerDownCapture={(event) => {
          if (!onWallPlace || event.button !== 0 || !sceneRef.current) return
          event.stopPropagation()
          onWallPlace(
            visibleWallAt(sceneRef.current, event.currentTarget, event.clientX, event.clientY),
          )
        }}
      />
      <canvas
        ref={compositionRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          visibility: 'hidden',
        }}
      />
      {facadeControls && views.length > 0 && (
        <div className="facade-view-controls">
          {siStyle === 'SI1.0' && space.facade && facadeKind(space.facade) === 'island_hanging' && (
            <span className="facade-view-review">手填预览 · 待复核</span>
          )}
          {views.map(({ label, view }) => (
            <button
              type="button"
              key={label}
              onClick={() => {
                setFacadeVisible(true)
                sceneRef.current?.showView(view)
              }}
            >
              {label}
            </button>
          ))}
          <button type="button" onClick={() => setFacadeVisible((visible) => !visible)}>
            {facadeVisible ? '隐藏门头' : '显示门头'}
          </button>
        </div>
      )}
      {(backgroundError || status.loading > 0 || status.failed.length > 0) && (
        <p className="viewer3d-status hint" role={backgroundError ? 'alert' : 'status'}>
          {backgroundError ? `${backgroundError}。` : null}
          {status.loading > 0 ? `正在加载 ${status.loading} 个模型…` : null}
          {status.failed.length > 0
            ? ` ${status.failed.length} 个模型未能加载，以方框代替：${status.failed.join('、')}`
            : null}
        </p>
      )}
    </div>
  )
}
