import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import {
  defaultCameras,
  isWallArt,
  wallArtSize,
  wallArtFromCorner,
  fixtureSolids,
  frontCorners,
  itemElevation,
  itemMount,
  itemTilt,
  modelBox,
  scaleFromCorner,
  turnPoint,
} from '@store/shared'
import type {
  Asset,
  Camera,
  Corner,
  Fixture,
  LayoutItem,
  Market,
  ModelSize,
  ShopType,
  SiStyle,
  Space,
} from '@store/shared'
import { finishModel } from './finish-model.ts'
import { createRotateRing, placeRotateRing, rotationOnFloor } from './rotate-ring.ts'
import { loadModel, loadSource } from './model-cache.ts'
import { disposeRoomMaterials, roomMaterials } from './render-look.ts'
import type { RoomSurface } from './render-look.ts'
import { aimSun, buildRoom } from './room-builder.ts'
import { disposeGeometry, disposeTree, placeholderBox, surface, toVec3 } from './scene-geometry.ts'
import { signFaces, wallPicture } from './wall-picture.ts'
import { wallArt } from './wall-art.ts'

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
  /**
   * A LOGO dragged by a corner of its front (see scaleFromCorner): its new scale, centre and
   * bottom height. Without it the corners do nothing.
   */
  onResize?: (
    itemId: string,
    placement: {
      scale: number
      cx: number
      cz: number
      elevation: number
      size?: { w: number; h: number }
    },
    gesture: { group: string },
  ) => void
  /**
   * The selected prop turned by its rotation ring: the angle the pointer points it at; `snap`
   * is off while Alt is held. Without it no ring is shown.
   */
  onRotate?: (itemId: string, rotation: number, gesture: { group: string; snap: boolean }) => void
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
  /** A LOGO's model size at scale 1, for resizing by its corners; null for other props. */
  model: ModelSize | null
}

/** Screen pixels within which the pointer is on a LOGO corner. */
const CORNER_PX = 12
/** Size of the corner grips drawn on the selected LOGO. */
const GRIP_M = 0.04

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
  /** 空心隔板: boxes in the wall material. */
  private readonly fixtures = new THREE.Group()
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
  /** A LOGO corner being dragged: the LOGO when the drag began and the plane of its front. */
  private cornerDrag: {
    start: LayoutItem
    model: ModelSize
    corner: Corner
    plane: THREE.Plane
    group: string
  } | null = null
  /** The ring round the selected prop (see rotate-ring.ts), and a turn being dragged on it. */
  private ring: THREE.Group | null = null
  private turnDrag: { id: string; centre: [number, number]; group: string } | null = null
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
    this.scene.add(
      this.sun,
      this.sun.target,
      this.room,
      this.fixtures,
      this.props,
      this.marks,
      this.hits,
    )

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
    for (const mesh of [...this.room.children, ...this.fixtures.children]) {
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
  setItems(
    items: readonly LayoutItem[],
    assets: ReadonlyMap<string, Asset>,
    market: Market = 'domestic',
  ) {
    const seen = new Set<string>()
    for (const item of items) {
      seen.add(item.id)
      const catalogued = item.assetId ? assets.get(item.assetId) : undefined
      const art = isWallArt(item)
      // A built-in screen or light box is only its picture on the wall face (wall-picture.ts).
      const picture =
        itemMount(item) === 'embedded'
          ? { url: catalogued?.preview?.url ?? null, front: catalogued?.front ?? null }
          : null
      const asset = !art && !picture && item.assetId && !item.placeholder ? catalogued : undefined
      // A LOGO in the other market's version (影石Insta360 ⇄ Insta360): one file for both looks.
      const marketUrl =
        asset?.market && asset.market !== market ? (asset.otherMarketGlb?.url ?? null) : null
      // The light white-model copy when there is one (see pnpm catalog:white).
      const url = marketUrl ?? asset?.whiteGlb?.url ?? asset?.glb?.url ?? null
      // The light material copy when there is one (see pnpm catalog:finish).
      const finishUrl = marketUrl ?? asset?.finishGlb?.url ?? asset?.glb?.url ?? null
      const signature = art
        ? `art:${catalogued?.productImage?.url}:${item.w}:${item.d}:${item.h}:${item.rotation}`
        : picture
          ? `picture:${picture.url}:${picture.front}:${item.w}:${item.d}:${item.h}:${item.rotation}`
          : url
            ? `${url}|${finishUrl}`
            : `box:${item.w}:${item.d}:${item.h}`
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
          model: null,
        }
        placed.hit.userData['itemId'] = item.id
        this.hits.add(placed.hit)
        placed.group.userData['itemId'] = item.id
        placed.group.add(placed.white)
        this.props.add(placed.group)
        this.items.set(item.id, placed)
        if (art)
          placed.white.add(
            wallArt(item, catalogued?.productImage?.url ?? null, () => this.requestRender()),
          )
        else if (picture)
          placed.white.add(
            wallPicture(item, picture.front, picture.url, () => this.requestRender()),
          )
        else this.fill(placed, url)
        // A sign still without a web model shows its preview on both faces (双面侧招).
        if (!picture && !url && catalogued?.standardName.includes('侧招') && catalogued.preview)
          placed.white.add(signFaces(item, catalogued.preview.url, () => this.requestRender()))
        if (this.look === 'material') this.loadFinish(placed)
      }
      placed.item = item
      placed.model = art
        ? wallArtSize(item)
        : item.function === 'signage' && catalogued
          ? catalogued.footprint
          : null
      const group = placed.group
      // Wall and ceiling pieces hang at their height above the floor.
      const elevation = itemElevation(item)
      // The model is centred on the whole of it, which may reach beyond the item (a 开箱桌's
      // stools on one side): the hit box and marks keep to the item.
      const model = modelBox(item, url ? asset : undefined)
      group.position.set(model.cx, elevation, model.cz)
      // A box already has the footprint at its nearest quarter turn and turns only by the tilt
      // beyond it; a model turns by the whole rotation (legacy: +Z front → −X at 90°).
      group.rotation.y = art ? 0 : ((url ? -item.rotation : -itemTilt(item)) * Math.PI) / 180
      // A LOGO resized in the properties panel (scale) shows at that size, like its plan symbol;
      // a placeholder box is drawn at the item's size already.
      group.scale.setScalar(url ? (item.scale ?? 1) : 1)
      // The footprint is already at its nearest quarter turn (w × d on the plan): a box turns
      // only by the tilt beyond it.
      placed.hit.scale.set(item.w, item.h, item.d)
      placed.hit.rotation.y = (-itemTilt(item) * Math.PI) / 180
      placed.hit.position.set(item.cx, elevation + item.h / 2, item.cz)
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this.removeItem(id)
    this.sceneChanged()
  }

  /**
   * 空心隔板 finished like the walls (white, or the wall material), with niches where the
   * accessory cabinets stand (fixtureSolids).
   */
  setFixtures(fixtures: readonly Fixture[], items: readonly LayoutItem[]) {
    this.fixtures.children.forEach(disposeGeometry)
    this.fixtures.clear()
    for (const { rect, bottom, top } of fixtures.flatMap((f) => fixtureSolids(f, items))) {
      const [w, d, h] = [rect.maxX - rect.minX, rect.maxZ - rect.minZ, top - bottom]
      const geometry = new THREE.BoxGeometry(w, h, d)
      geometry.translate((rect.minX + rect.maxX) / 2, bottom + h / 2, (rect.minZ + rect.maxZ) / 2)
      const box = new THREE.Mesh(geometry, this.roomWhite)
      box.castShadow = true
      box.receiveShadow = true
      box.userData['surface'] = 'wall' satisfies RoomSurface
      this.fixtures.add(box)
    }
    this.paintRoom()
    this.sceneChanged()
  }

  /** Floor marks under the selected prop and props with errors. */
  setMarks(selectedId: string | null, flagged: ReadonlySet<string>) {
    this.marks.children.forEach(disposeTree)
    this.marks.clear()
    this.ring = null
    for (const { item, model } of this.items.values()) {
      const selected = item.id === selectedId
      // The selected LOGO shows grips on the corners of its front: drag one to resize.
      if (selected && model && this.handlers?.onResize && !item.locked) {
        for (const { at } of frontCorners(item, model)) {
          const grip = new THREE.Mesh(
            new THREE.BoxGeometry(GRIP_M, GRIP_M, GRIP_M),
            new THREE.MeshBasicMaterial({ color: '#111111', depthTest: false }),
          )
          grip.renderOrder = 10
          grip.position.set(...at)
          this.marks.add(grip)
        }
      }
      // The selected prop on the floor or ceiling shows its rotation ring (a wall piece takes
      // its angle from the wall).
      if (
        selected &&
        this.handlers?.onRotate &&
        !item.locked &&
        itemMount(item) !== 'wall' &&
        itemMount(item) !== 'embedded'
      ) {
        const ring = createRotateRing(item)
        placeRotateRing(ring, item)
        this.marks.add(ring)
        this.ring = ring
      }
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
      // Flat on the floor, turned by the tilt beyond the nearest quarter turn.
      mark.rotation.set(-Math.PI / 2, 0, (-itemTilt(item) * Math.PI) / 180)
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

  /** The LOGO corner under the pointer (within CORNER_PX on screen), if any. */
  private cornerAt(event: PointerEvent): { placed: PlacedItem; corner: Corner } | null {
    if (!this.handlers?.onResize) return null
    const rect = this.canvas.getBoundingClientRect()
    let best: { placed: PlacedItem; corner: Corner; px: number } | null = null
    for (const placed of this.items.values()) {
      if (!placed.model || placed.item.locked) continue
      for (const { corner, at } of frontCorners(placed.item, placed.model)) {
        const p = new THREE.Vector3(...at).project(this.camera)
        if (p.z > 1) continue
        const x = ((p.x + 1) / 2) * rect.width + rect.left
        const y = ((1 - p.y) / 2) * rect.height + rect.top
        const px = Math.hypot(x - event.clientX, y - event.clientY)
        if (px <= CORNER_PX && (!best || px < best.px)) best = { placed, corner, px }
      }
    }
    return best
  }

  /** Starts resizing a LOGO by a corner; the pointer then moves on the plane of its front. */
  private startResize(event: PointerEvent): boolean {
    const hit = this.cornerAt(event)
    if (!hit || !hit.placed.model) return false
    const { item } = hit.placed
    const model = hit.placed.model
    const [fx, fz] = turnPoint(0, 1, item.rotation)
    const front = (model.d * (item.scale ?? 1)) / 2
    this.cornerDrag = {
      start: item,
      model,
      corner: hit.corner,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(fx, 0, fz),
        new THREE.Vector3(item.cx + fx * front, 0, item.cz + fz * front),
      ),
      group: `resize3d:${item.id}:${event.timeStamp}`,
    }
    this.handlers?.onSelect(item.id)
    this.controls.enabled = false
    this.canvas.setPointerCapture(event.pointerId)
    return true
  }

  /** Whether the pointer is on the selected prop's rotation ring. */
  private onRing(event: PointerEvent): string | null {
    if (!this.ring || !this.handlers?.onRotate) return null
    this.ring.updateMatrixWorld(true)
    const hit = this.ray(event).intersectObjects(this.ring.children, false)[0]
    const id: unknown = hit?.object.userData['rotateRing']
    return typeof id === 'string' ? id : null
  }

  /** Starts turning the selected prop by its ring; the pointer then points it round. */
  private startTurn(event: PointerEvent): boolean {
    const id = this.onRing(event)
    const placed = id ? this.items.get(id) : undefined
    if (!placed) return false
    this.turnDrag = {
      id: placed.item.id,
      centre: [placed.item.cx, placed.item.cz],
      group: `turn3d:${placed.item.id}:${event.timeStamp}`,
    }
    this.controls.enabled = false
    this.canvas.setPointerCapture(event.pointerId)
    return true
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    if (this.startResize(event)) return
    if (this.startTurn(event)) return
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
    if (this.turnDrag) {
      const { id, centre, group } = this.turnDrag
      const rotation = rotationOnFloor(this.ray(event).ray, centre)
      if (rotation !== null) this.handlers?.onRotate?.(id, rotation, { group, snap: !event.altKey })
      return
    }
    if (this.cornerDrag) {
      const { start, model, corner, plane, group } = this.cornerDrag
      const point = this.ray(event).ray.intersectPlane(plane, new THREE.Vector3())
      if (point) {
        const pointer = { plan: [point.x, point.z] as [number, number], y: point.y }
        const resized = isWallArt(start) ? wallArtFromCorner(start, corner, pointer) : null
        const placement = resized
          ? {
              scale: 1,
              cx: resized.cx,
              cz: resized.cz,
              elevation: resized.elevation,
              size: { w: resized.w, h: resized.h },
            }
          : scaleFromCorner(start, model, corner, {
              plan: [point.x, point.z],
              y: point.y,
            })
        this.handlers?.onResize?.(start.id, placement, { group })
      }
      return
    }
    if (!this.drag) {
      // A diagonal resize cursor over a LOGO corner.
      const hit = this.cornerAt(event)
      this.canvas.style.cursor = hit
        ? hit.corner.x === hit.corner.y
          ? 'nesw-resize'
          : 'nwse-resize'
        : this.onRing(event)
          ? 'grab'
          : ''
      return
    }
    const point = this.floorPoint(event)
    if (point) {
      this.handlers?.onMove?.(this.drag.id, point[0] - this.drag.dx, point[1] - this.drag.dz, {
        group: this.drag.group,
        snap: !event.altKey,
      })
    }
  }

  private readonly endDrag = () => {
    if (!this.drag && !this.cornerDrag && !this.turnDrag) return
    this.drag = null
    this.cornerDrag = null
    this.turnDrag = null
    this.controls.enabled = true
  }
}
