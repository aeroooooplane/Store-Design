import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { WALL_THICKNESS_M, defaultCameras, wallSegments } from '@store/shared'
import type { Asset, Camera, LayoutItem, Point, ShopType, Space } from '@store/shared'

/** Legacy white-mode look (demo/src/scene.js). */
const WHITE = '#f7f7f5'
const BACKGROUND = '#e8eaed'
const FLOOR_THICKNESS_M = 0.16

export interface ViewPose {
  position: [number, number, number]
  target: [number, number, number]
  fovDeg: number
}

export interface SceneHandlers {
  onSelect: (itemId: string | null) => void
  onMove: (itemId: string, cx: number, cz: number) => void
}

export interface LoadStatus {
  loading: number
  /** Models that could not be loaded and are shown as boxes. */
  failed: string[]
}

// ---- model cache: one load per GLB per page; instances are cheap clones ----

type AnyMaterial = THREE.Material | THREE.Material[]
type Drawable =
  | THREE.Mesh<THREE.BufferGeometry, AnyMaterial>
  | THREE.LineSegments<THREE.BufferGeometry, AnyMaterial>
const isDrawable = (node: THREE.Object3D): node is Drawable =>
  node instanceof THREE.Mesh || node instanceof THREE.LineSegments

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const models = new Map<string, Promise<THREE.Object3D>>()

/**
 * Below this opacity a surface reads as glass and stays see-through; above it (frosted acrylic,
 * light boxes) it is drawn as a solid white panel, so the shadowed inside of a counter does not
 * show through as dark grey.
 */
const GLASS_OPACITY = 0.4

/**
 * Plain white, matte. Texture alpha is kept so perforated or cut-out parts stay open (the
 * colour is forced to white in the shader, as in the legacy viewer); glass stays faintly
 * see-through and is marked so it casts no shadow.
 */
function whiteMaterial(source: THREE.Material): THREE.Material {
  const original = source as THREE.MeshStandardMaterial
  const cutout =
    !!original.alphaMap || (!!original.map && (source.transparent || source.alphaTest > 0))
  const glass = !cutout && source.transparent && source.opacity < GLASS_OPACITY
  const material = new THREE.MeshStandardMaterial({
    color: WHITE,
    roughness: glass ? 0.2 : 1,
    metalness: 0,
    // SketchUp exports often contain reversed faces; single-sided they would leave holes.
    side: THREE.DoubleSide,
    // Normals in SketchUp exports often point against the face winding (tops lit as if facing
    // down); flat shading derives them from the geometry instead. The white model loses
    // nothing by it.
    flatShading: true,
    transparent: glass || (cutout && source.transparent),
    opacity: glass ? Math.max(source.opacity, 0.25) : cutout ? source.opacity : 1,
    alphaTest: source.alphaTest,
    depthWrite: !glass,
  })
  material.userData['glass'] = glass
  if (original.alphaMap) material.alphaMap = original.alphaMap
  if (cutout && original.map) {
    material.map = original.map
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor.rgb = vec3(1.0);',
      )
    }
    material.customProgramCacheKey = () => 'white-cutout'
  }
  return material
}

function loadModel(url: string): Promise<THREE.Object3D> {
  let model = models.get(url)
  if (!model) {
    model = loader.loadAsync(url).then((gltf) => {
      gltf.scene.traverse((node) => {
        if (!(node instanceof THREE.Mesh) || !isDrawable(node)) return
        // Kept for the material renders of the next stage.
        node.userData['original'] = node.material
        node.material = Array.isArray(node.material)
          ? node.material.map(whiteMaterial)
          : whiteMaterial(node.material)
        const materials = Array.isArray(node.material) ? node.material : [node.material]
        node.castShadow = !materials.every((m) => m.userData['glass'] === true)
        node.receiveShadow = true
      })
      return gltf.scene
    })
    // A failed load is retried on the next scene.
    model.catch(() => models.delete(url))
    models.set(url, model)
  }
  return model
}

// ---- geometry helpers ----

/** Plan polygon extruded upwards from y = bottom; plan z maps to scene z. */
function prism(polygon: readonly Point[], bottom: number, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(polygon.map(([x, z]) => new THREE.Vector2(x, -z)))
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, bottom, 0)
  return geometry
}

function surface(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.8, metalness: 0 })
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((node) => {
    if (isDrawable(node)) {
      node.geometry.dispose()
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      materials.forEach((m) => m.dispose())
    }
  })
}

/** Outlined box for an item without a loadable model (footprint is already rotated). */
function placeholderBox(item: LayoutItem): THREE.Object3D {
  const geometry = new THREE.BoxGeometry(item.w, item.h, item.d)
  geometry.translate(0, item.h / 2, 0)
  const box = new THREE.Mesh(geometry, surface())
  box.castShadow = true
  box.receiveShadow = true
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: '#888888' }),
  )
  box.add(edges)
  box.userData['placeholder'] = true
  return box
}

interface PlacedItem {
  group: THREE.Group
  item: LayoutItem
  /** Rebuild when the model or the box size changes. */
  signature: string
}

const toVec3 = (v: THREE.Vector3): [number, number, number] => [
  Math.round(v.x * 1000) / 1000,
  Math.round(v.y * 1000) / 1000,
  Math.round(v.z * 1000) / 1000,
]

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
  private readonly sun = new THREE.DirectionalLight('#fff4e8', 1.6)
  private readonly items = new Map<string, PlacedItem>()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly failed = new Set<string>()
  private readonly raycaster = new THREE.Raycaster()
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private handlers: SceneHandlers | null = null
  private statusListener: ((status: LoadStatus) => void) | null = null
  private drag: { id: string; dx: number; dz: number } | null = null
  private frame = 0
  private disposed = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
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
    this.scene.add(this.sun, this.sun.target, this.room, this.props, this.marks)

    // Registered before OrbitControls so a press on a prop can switch orbiting off first.
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.endDrag)
    canvas.addEventListener('pointercancel', this.endDrag)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.addEventListener('change', this.requestRender)
  }

  setHandlers(handlers: SceneHandlers | null) {
    this.handlers = handlers
  }

  onStatus(listener: ((status: LoadStatus) => void) | null) {
    this.statusListener = listener
    this.emitStatus()
  }

  /** Floor, walls and obstacles; also re-aims the sun and, on first use, the view. */
  setRoom(space: Space, shopType: ShopType, resetView: boolean) {
    this.room.children.forEach(disposeTree)
    this.room.clear()

    const floor = new THREE.Mesh(
      prism(space.boundary, -FLOOR_THICKNESS_M, FLOOR_THICKNESS_M),
      surface(),
    )
    floor.receiveShadow = true
    this.room.add(floor)

    for (const wall of wallSegments(space, shopType)) {
      const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
      const geometry = new THREE.BoxGeometry(length, wall.height, WALL_THICKNESS_M)
      const mesh = new THREE.Mesh(geometry, surface())
      const half = WALL_THICKNESS_M / 2
      mesh.position.set(
        (wall.a[0] + wall.b[0]) / 2 + wall.outward[0] * half,
        wall.height / 2,
        (wall.a[1] + wall.b[1]) / 2 + wall.outward[1] * half,
      )
      mesh.rotation.y = -Math.atan2(wall.b[1] - wall.a[1], wall.b[0] - wall.a[0])
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.room.add(mesh)
    }

    for (const obstacle of space.obstacles) {
      const height = obstacle.height ?? space.height
      const mesh = new THREE.Mesh(prism(obstacle.polygon, 0, height), surface())
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.room.add(mesh)
    }

    const xs = space.boundary.map((p) => p[0])
    const zs = space.boundary.map((p) => p[1])
    const [minX, maxX, minZ, maxZ] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...zs),
      Math.max(...zs),
    ]
    const span = Math.max(maxX - minX, maxZ - minZ, 1)
    this.sun.position.set(minX + (maxX - minX) * 0.4, space.height * 3, minZ + (maxZ - minZ) * 0.8)
    this.sun.target.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
    const shadow = this.sun.shadow.camera
    shadow.left = shadow.bottom = -span
    shadow.right = shadow.top = span
    shadow.far = span * 8
    shadow.updateProjectionMatrix()

    if (resetView) {
      const [front] = defaultCameras(space)
      if (front) this.showView(front)
    }
    this.requestRender()
  }

  /** Brings the props in line with the layout; models load in the background. */
  setItems(items: readonly LayoutItem[], assets: ReadonlyMap<string, Asset>) {
    const seen = new Set<string>()
    for (const item of items) {
      seen.add(item.id)
      const asset = item.assetId && !item.placeholder ? assets.get(item.assetId) : undefined
      const url = asset?.glb?.url ?? null
      const signature = url ?? `box:${item.w}:${item.d}:${item.h}`
      let placed = this.items.get(item.id)
      if (!placed || placed.signature !== signature) {
        if (placed) this.removeItem(item.id)
        placed = { group: new THREE.Group(), item, signature }
        placed.group.userData['itemId'] = item.id
        this.props.add(placed.group)
        this.items.set(item.id, placed)
        this.fill(placed, url)
      }
      placed.item = item
      const group = placed.group
      group.position.set(item.cx, 0, item.cz)
      // A box already has the rotated footprint; a model turns (legacy: +Z front → −X at 90°).
      group.rotation.y = url ? (-item.rotation * Math.PI) / 180 : 0
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this.removeItem(id)
    this.requestRender()
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
   * Renders views to PNG data URLs at a fixed size. The canvas is resized and restored within
   * one task, so the on-screen view never flickers.
   */
  renderViews(
    views: readonly Pick<Camera, 'position' | 'target' | 'fovDeg'>[],
    width: number,
    height: number,
  ): string[] {
    const size = this.renderer.getSize(new THREE.Vector2())
    const ratio = this.renderer.getPixelRatio()
    const shot = new THREE.PerspectiveCamera(48, width / height, 0.05, 300)
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(width, height, false)
    const images = views.map((view) => {
      shot.position.set(...view.position)
      shot.fov = view.fovDeg
      shot.updateProjectionMatrix()
      shot.lookAt(...view.target)
      this.renderer.render(this.scene, shot)
      return this.canvas.toDataURL('image/png')
    })
    this.renderer.setPixelRatio(ratio)
    this.renderer.setSize(size.x, size.y, false)
    this.renderer.render(this.scene, this.camera)
    return images
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
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
    for (const id of [...this.items.keys()]) this.removeItem(id)
    this.room.children.forEach(disposeTree)
    this.marks.children.forEach(disposeTree)
    this.scene.environment?.dispose()
    this.renderer.dispose()
  }

  // ---- internals ----

  private fill(placed: PlacedItem, url: string | null) {
    if (!url) {
      placed.group.add(placeholderBox(placed.item))
      return
    }
    const load = loadModel(url)
      .then((model) => {
        if (this.items.get(placed.item.id) !== placed) return
        placed.group.add(model.clone(true))
        this.failed.delete(placed.item.id)
      })
      .catch(() => {
        if (this.items.get(placed.item.id) !== placed) return
        placed.group.add(placeholderBox(placed.item))
        this.failed.add(placed.item.id)
      })
      .finally(() => {
        this.pending.delete(load)
        this.emitStatus()
        this.requestRender()
      })
    this.pending.add(load)
    this.emitStatus()
  }

  private removeItem(id: string) {
    const placed = this.items.get(id)
    if (!placed) return
    // Shared model geometry stays cached; only boxes made for this item are freed.
    placed.group.traverse((node) => {
      if (node.userData['placeholder']) disposeTree(node)
    })
    this.props.remove(placed.group)
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
    for (const hit of this.ray(event).intersectObjects(this.props.children, true)) {
      for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) {
        const id: unknown = node.userData['itemId']
        if (typeof id === 'string') return this.items.get(id) ?? null
      }
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
    if (!placed || placed.item.locked) return
    const point = this.floorPoint(event)
    if (!point) return
    this.drag = { id: placed.item.id, dx: point[0] - placed.item.cx, dz: point[1] - placed.item.cz }
    this.controls.enabled = false
    this.canvas.setPointerCapture(event.pointerId)
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.drag) return
    const point = this.floorPoint(event)
    if (point) this.handlers?.onMove(this.drag.id, point[0] - this.drag.dx, point[1] - this.drag.dz)
  }

  private readonly endDrag = () => {
    if (!this.drag) return
    this.drag = null
    this.controls.enabled = true
  }
}
