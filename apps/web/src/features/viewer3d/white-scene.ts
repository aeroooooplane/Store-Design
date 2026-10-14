import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { defaultCameras } from '@store/shared'
import type { Asset, Camera, LayoutItem, ShopType, SiStyle, Space } from '@store/shared'
import { finishModel } from './finish-model.ts'
import { loadModel, loadSource } from './model-cache.ts'
import { disposeRoomMaterials, roomMaterials } from './render-look.ts'
import type { RoomSurface } from './render-look.ts'
import { aimSun, buildRoom } from './room-builder.ts'
import { disposeGeometry, disposeTree, placeholderBox, surface, toVec3 } from './scene-geometry.ts'

// The GLB cache lives in model-cache.ts (one instance per page); re-exported for the callers.
export { loadSource }

/** Legacy white-mode look (demo/src/scene.js in tag archive/pre-cleanup-20261013). */
const BACKGROUND = '#e8eaed'

export interface ViewPose {
  position: [number, number, number]
  target: [number, number, number]
  fovDeg: number
}

/** White model, or the material look of the renders (same scene, other materials). */
export type Look = 'white' | 'material'

export interface SceneHandlers {
  onSelect: (itemId: string | null) => void
  /**
   * `group` is the same for every move of one drag; `snap` is off while Alt is held. Without
   * it the props cannot be dragged (read-only views).
   */
  onMove?: (
    itemId: string,
    cx: number,
    cz: number,
    gesture: { group: string; snap: boolean },
  ) => void
}

export interface LoadStatus {
  loading: number
  /** Models that could not be loaded and are shown as boxes. */
  failed: string[]
}

interface PlacedItem {
  group: THREE.Group
  item: LayoutItem
  /** Rebuild when the model or the box size changes. */
  signature: string
  /** The white model (or box). */
  white: THREE.Group
  /** The textured model for the material look, loaded the first time that look is used. */
  finishUrl: string | null
  /** The light material copy (finish.glb), whose two-sided faces are marked already. */
  finishPrepared: boolean
  finish: THREE.Object3D | null
  finishState: 'none' | 'loading' | 'ready' | 'failed'
  /** Invisible box over the footprint: what a click hits (cheap whatever the model). */
  hit: THREE.Mesh
}

/** One unit box and one never-drawn material shared by every hit box. */
const HIT_BOX = new THREE.BoxGeometry(1, 1, 1)
const HIT_MATERIAL = new THREE.MeshBasicMaterial({ visible: false })

/**
 * The white model of one layout: floor, walls, obstacles and props, an orbit view, and 3D
 * dragging of props on the floor. Renders on demand only.
 */
export class WhiteScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(48, 1.5, 0.05, 300)
  readonly controls: OrbitControls

  private readonly canvas: HTMLCanvasElement
  private readonly room = new THREE.Group()
  private readonly props = new THREE.Group()
  private readonly marks = new THREE.Group()
  /** Hit boxes of the props; picking tests these, not the models. */
  private readonly hits = new THREE.Group()
  private viewListener: ((pose: ViewPose) => void) | null = null
  private readonly sun = new THREE.DirectionalLight('#fff4e8', 1.6)
  private readonly items = new Map<string, PlacedItem>()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly failed = new Set<string>()
  private readonly raycaster = new THREE.Raycaster()
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private handlers: SceneHandlers | null = null
  private statusListener: ((status: LoadStatus) => void) | null = null
  private drag: { id: string; dx: number; dz: number; group: string } | null = null
  private frame = 0
  private disposed = false
  private look: Look = 'white'
  private siStyle: SiStyle = 'SI1.0'
  private shopType: ShopType = 'side_hall'
  private space: Space | null = null
  private readonly roomWhite = surface()
  /** Material-look room materials of the current room, per SI style (the floor follows the room). */
  private readonly roomLooks = new Map<SiStyle, Record<RoomSurface, THREE.MeshStandardMaterial>>()
  /** Textured models with adjusted finishes; per scene because metals use its environment. */
  private readonly finishes = new Map<string, Promise<THREE.Object3D>>()
  private readonly finishedMaterials = new Map<THREE.Material, THREE.Material>()
  /** Front-side-only copies of finished materials, for the two sides of SketchUp faces. */
  private readonly frontMaterials = new Map<THREE.Material, THREE.Material>()

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    // PCFSoftShadowMap was removed from three.js; it already fell back to PCFShadowMap.
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    // Shadows depend on the scene, not the camera: recompute them only when something moves.
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.82

    this.scene.background = new THREE.Color(BACKGROUND)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    this.scene.environmentIntensity = 0.25
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#7b7770', 1.1))
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.00015
    this.sun.shadow.normalBias = 0.025
    this.scene.add(this.sun, this.sun.target, this.room, this.props, this.marks, this.hits)

    // Registered before OrbitControls so a press on a prop can switch orbiting off first.
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.endDrag)
    canvas.addEventListener('pointercancel', this.endDrag)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.addEventListener('change', this.requestRender)
    this.controls.addEventListener('end', () => this.viewListener?.(this.currentView()))
  }

  setHandlers(handlers: SceneHandlers | null) {
    this.handlers = handlers
  }

  /** Told the view whenever the user finishes orbiting, panning or zooming. */
  onView(listener: ((pose: ViewPose) => void) | null) {
    this.viewListener = listener
  }

  onStatus(listener: ((status: LoadStatus) => void) | null) {
    this.statusListener = listener
    this.emitStatus()
  }

  /** Floor, walls and obstacles; also re-aims the sun and, on first use, the view. */
  setRoom(space: Space, shopType: ShopType, resetView: boolean) {
    this.room.children.forEach(disposeGeometry)
    this.room.clear()
    this.roomLooks.forEach(disposeRoomMaterials)
    this.roomLooks.clear()
    this.shopType = shopType
    this.space = space

    buildRoom(this.room, space, shopType, this.roomWhite)
    aimSun(this.sun, space)

    if (resetView) {
      const [front] = defaultCameras(space, shopType)
      if (front) this.showView(front)
    }
    this.paintRoom()
    this.sceneChanged()
  }

  /** White, or the material look; the props follow, loading textured models when needed. */
  setLook(look: Look, siStyle: SiStyle) {
    this.siStyle = siStyle
    this.applyLook(look)
  }

  private applyLook(look: Look) {
    this.look = look
    this.paintRoom()
    for (const placed of this.items.values()) {
      if (look === 'material') this.loadFinish(placed)
      this.showLook(placed)
    }
    this.sceneChanged()
  }

  private paintRoom() {
    let materials: Record<RoomSurface, THREE.MeshStandardMaterial> | undefined
    if (this.look === 'material' && this.space) {
      materials = this.roomLooks.get(this.siStyle)
      if (!materials) {
        materials = roomMaterials(this.siStyle, this.shopType, this.space)
        this.roomLooks.set(this.siStyle, materials)
      }
    }
    for (const mesh of this.room.children) {
      const surfaceName = mesh.userData['surface'] as RoomSurface | undefined
      if (mesh instanceof THREE.Mesh && surfaceName) {
        mesh.material = materials ? materials[surfaceName] : this.roomWhite
      }
    }
  }

  /** The textured model shows in the material look once it has loaded; otherwise the white. */
  private showLook(placed: PlacedItem) {
    const textured = this.look === 'material' && placed.finish !== null
    placed.white.visible = !textured
    if (placed.finish) placed.finish.visible = textured
  }

  /** Brings the props in line with the layout; models load in the background. */
  setItems(items: readonly LayoutItem[], assets: ReadonlyMap<string, Asset>) {
    const seen = new Set<string>()
    for (const item of items) {
      seen.add(item.id)
      const asset = item.assetId && !item.placeholder ? assets.get(item.assetId) : undefined
      // The light white-model copy when there is one (see pnpm catalog:white).
      const url = asset?.whiteGlb?.url ?? asset?.glb?.url ?? null
      // The light material copy when there is one (see pnpm catalog:finish).
      const finishUrl = asset?.finishGlb?.url ?? asset?.glb?.url ?? null
      const signature = url ? `${url}|${finishUrl}` : `box:${item.w}:${item.d}:${item.h}`
      let placed = this.items.get(item.id)
      if (!placed || placed.signature !== signature) {
        if (placed) this.removeItem(item.id)
        placed = {
          group: new THREE.Group(),
          item,
          signature,
          white: new THREE.Group(),
          finishUrl,
          finishPrepared: Boolean(asset?.finishGlb),
          finish: null,
          finishState: 'none',
          hit: new THREE.Mesh(HIT_BOX, HIT_MATERIAL),
        }
        placed.hit.userData['itemId'] = item.id
        this.hits.add(placed.hit)
        placed.group.userData['itemId'] = item.id
        placed.group.add(placed.white)
        this.props.add(placed.group)
        this.items.set(item.id, placed)
        this.fill(placed, url)
        if (this.look === 'material') this.loadFinish(placed)
      }
      placed.item = item
      const group = placed.group
      group.position.set(item.cx, 0, item.cz)
      // A box already has the rotated footprint; a model turns (legacy: +Z front → −X at 90°).
      group.rotation.y = url ? (-item.rotation * Math.PI) / 180 : 0
      // The footprint is already turned (w × d on the plan), so the box needs no rotation.
      placed.hit.scale.set(item.w, item.h, item.d)
      placed.hit.position.set(item.cx, item.h / 2, item.cz)
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this.removeItem(id)
    this.sceneChanged()
  }

  /** Floor marks under the selected prop and props with errors. */
  setMarks(selectedId: string | null, flagged: ReadonlySet<string>) {
    this.marks.children.forEach(disposeTree)
    this.marks.clear()
    for (const { item } of this.items.values()) {
      const selected = item.id === selectedId
      if (!selected && !flagged.has(item.id)) continue
      const mark = new THREE.Mesh(
        new THREE.PlaneGeometry(item.w + 0.08, item.d + 0.08),
        new THREE.MeshBasicMaterial({
          color: flagged.has(item.id) ? '#b00020' : '#111111',
          transparent: true,
          opacity: selected ? 0.35 : 0.25,
          depthWrite: false,
        }),
      )
      mark.rotation.x = -Math.PI / 2
      mark.position.set(item.cx, 0.003, item.cz)
      this.marks.add(mark)
    }
    this.requestRender()
  }

  showView(view: Pick<Camera, 'position' | 'target' | 'fovDeg'>) {
    this.camera.position.set(...view.position)
    this.camera.fov = view.fovDeg
    this.camera.updateProjectionMatrix()
    this.controls.target.set(...view.target)
    this.controls.update()
    this.requestRender()
  }

  currentView(): ViewPose {
    return {
      position: toVec3(this.camera.position),
      target: toVec3(this.controls.target),
      fovDeg: Math.round(this.camera.fov * 10) / 10,
    }
  }

  /** Resolves once every model that is loading now has arrived (or failed). */
  async whenLoaded(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending])
  }

  /**
   * Renders views to PNG data URLs at a fixed size, one view per task so the page stays
   * responsive. Within a task the canvas is resized, drawn, read and restored, so the on-screen
   * view never flickers. Returns fewer images if the scene is disposed meanwhile.
   */
  async renderViews(
    views: readonly Pick<Camera, 'position' | 'target' | 'fovDeg'>[],
    width: number,
    height: number,
    look: Look = this.look,
  ): Promise<string[]> {
    const shown = this.look
    if (look !== shown) {
      this.applyLook(look)
      await this.whenLoaded()
    }
    try {
      return await this.shoot(views, width, height)
    } finally {
      if (!this.disposed && this.look !== shown) this.applyLook(shown)
    }
  }

  private async shoot(
    views: readonly Pick<Camera, 'position' | 'target' | 'fovDeg'>[],
    width: number,
    height: number,
  ): Promise<string[]> {
    const shot = new THREE.PerspectiveCamera(48, width / height, 0.05, 300)
    const images: string[] = []
    for (const view of views) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (this.disposed) break
      const size = this.renderer.getSize(new THREE.Vector2())
      const ratio = this.renderer.getPixelRatio()
      this.renderer.setPixelRatio(1)
      this.renderer.setSize(width, height, false)
      shot.position.set(...view.position)
      shot.fov = view.fovDeg
      shot.updateProjectionMatrix()
      shot.lookAt(...view.target)
      this.renderer.render(this.scene, shot)
      images.push(this.canvas.toDataURL('image/png'))
      this.renderer.setPixelRatio(ratio)
      this.renderer.setSize(size.x, size.y, false)
      this.renderer.render(this.scene, this.camera)
    }
    return images
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.requestRender()
  }

  /** Content moved, appeared or vanished: shadows must be recomputed on the next frame. */
  private sceneChanged() {
    this.renderer.shadowMap.needsUpdate = true
    this.requestRender()
  }

  readonly requestRender = () => {
    if (this.frame || this.disposed) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.renderer.render(this.scene, this.camera)
    })
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.endDrag)
    this.canvas.removeEventListener('pointercancel', this.endDrag)
    this.controls.dispose()
    this.viewListener = null
    for (const id of [...this.items.keys()]) this.removeItem(id)
    this.room.children.forEach(disposeGeometry)
    this.roomWhite.dispose()
    this.roomLooks.forEach(disposeRoomMaterials)
    // Finished materials are clones; their textures belong to the shared model cache.
    this.finishedMaterials.forEach((material) => material.dispose())
    this.frontMaterials.forEach((material) => material.dispose())
    this.marks.children.forEach(disposeTree)
    this.scene.environment?.dispose()
    this.renderer.dispose()
    // Release the WebGL context once the canvas has really left the page; a disposed renderer keeps
    // it alive and the browser drops the oldest one after ~16. React StrictMode re-creates the
    // scene on the same, still attached canvas, which must keep its context.
    const gl = this.renderer.getContext()
    setTimeout(() => {
      if (!this.canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext()
    })
  }

  /**
   * Compiles the shaders of a model before it joins the scene, off the main thread where the browser
   * supports it (KHR_parallel_shader_compile); otherwise the first frame compiles them in one block.
   */
  private async prepare(object: THREE.Object3D): Promise<void> {
    try {
      await this.renderer.compileAsync(object, this.camera, this.scene)
    } catch {
      // Compiling up front is an optimisation only; the first render compiles what is missing.
    }
  }

  // ---- internals ----

  private fill(placed: PlacedItem, url: string | null) {
    if (!url) {
      placed.white.add(placeholderBox(placed.item))
      return
    }
    const load = loadModel(url)
      .then(async (model) => {
        if (this.items.get(placed.item.id) !== placed) return
        const copy = model.clone(true)
        await this.prepare(copy)
        if (this.items.get(placed.item.id) !== placed) return
        placed.white.add(copy)
        this.failed.delete(placed.item.id)
      })
      .catch(() => {
        if (this.items.get(placed.item.id) !== placed) return
        placed.white.add(placeholderBox(placed.item))
        this.failed.add(placed.item.id)
      })
      .finally(() => {
        this.pending.delete(load)
        this.emitStatus()
        this.sceneChanged()
      })
    this.pending.add(load)
    this.emitStatus()
  }

  /** Loads the textured model of a prop once; if it fails the white model stays in its place. */
  private loadFinish(placed: PlacedItem) {
    if (!placed.finishUrl || placed.finishState !== 'none') return
    placed.finishState = 'loading'
    const load = this.finished(placed.finishUrl, placed.finishPrepared)
      .then(async (model) => {
        if (this.items.get(placed.item.id) !== placed) return
        const copy = model.clone(true)
        await this.prepare(copy)
        if (this.items.get(placed.item.id) !== placed) return
        placed.finish = copy
        placed.finishState = 'ready'
        placed.group.add(placed.finish)
        this.showLook(placed)
      })
      .catch(() => {
        placed.finishState = 'failed'
      })
      .finally(() => {
        this.pending.delete(load)
        this.emitStatus()
        this.sceneChanged()
      })
    this.pending.add(load)
    this.emitStatus()
  }

  private finished(url: string, prepared: boolean): Promise<THREE.Object3D> {
    let model = this.finishes.get(url)
    if (!model) {
      model = loadSource(url).then((gltf) =>
        finishModel(gltf, prepared, this.scene.environment, this.finishedMaterials, (material) =>
          this.frontSided(material),
        ),
      )
      model.catch(() => this.finishes.delete(url))
      this.finishes.set(url, model)
    }
    return model
  }

  private frontSided(material: THREE.Material): THREE.Material {
    let front = this.frontMaterials.get(material)
    if (!front) {
      front = material.clone()
      front.side = THREE.FrontSide
      this.frontMaterials.set(material, front)
    }
    return front
  }

  private removeItem(id: string) {
    const placed = this.items.get(id)
    if (!placed) return
    // Shared model geometry stays cached; only boxes made for this item are freed.
    placed.group.traverse((node) => {
      if (node.userData['placeholder']) disposeTree(node)
    })
    this.props.remove(placed.group)
    this.hits.remove(placed.hit)
    this.items.delete(id)
    this.failed.delete(id)
  }

  private emitStatus() {
    this.statusListener?.({
      loading: this.pending.size,
      failed: [...this.failed].map((id) => this.items.get(id)?.item.name ?? id),
    })
  }

  private ray(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    return this.raycaster
  }

  private pick(event: PointerEvent): PlacedItem | null {
    // Boxes may have moved since the last frame.
    this.hits.updateMatrixWorld()
    for (const hit of this.ray(event).intersectObjects(this.hits.children, false)) {
      const id: unknown = hit.object.userData['itemId']
      if (typeof id === 'string') return this.items.get(id) ?? null
    }
    return null
  }

  private floorPoint(event: PointerEvent): [number, number] | null {
    const point = this.ray(event).ray.intersectPlane(this.floor, new THREE.Vector3())
    return point ? [point.x, point.z] : null
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    const placed = this.pick(event)
    this.handlers?.onSelect(placed?.item.id ?? null)
    if (!placed || placed.item.locked || !this.handlers?.onMove) return
    const point = this.floorPoint(event)
    if (!point) return
    this.drag = {
      id: placed.item.id,
      dx: point[0] - placed.item.cx,
      dz: point[1] - placed.item.cz,
      group: `drag3d:${placed.item.id}:${event.timeStamp}`,
    }
    this.controls.enabled = false
    this.canvas.setPointerCapture(event.pointerId)
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.drag) return
    const point = this.floorPoint(event)
    if (point) {
      this.handlers?.onMove?.(this.drag.id, point[0] - this.drag.dx, point[1] - this.drag.dz, {
        group: this.drag.group,
        snap: !event.altKey,
      })
    }
  }

  private readonly endDrag = () => {
    if (!this.drag) return
    this.drag = null
    this.controls.enabled = true
  }
}
