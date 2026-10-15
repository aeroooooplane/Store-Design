import * as THREE from 'three'
import type { DisplayTable, PictureRect } from '@store/shared'
import { tableShape } from './layout.ts'
import type { SlotPlace, TableShape } from './layout.ts'

/** What a slot holds, as the scene needs it. */
export interface SlotContent {
  slot: string
  hero: boolean
  /** Product name; drawn on the card only when `names` is on (the PPT writes it as text). */
  name: string
  empty: boolean
  /** Tray picture (the guide's render), or null. */
  photo: string | null
}

export interface TableSceneInput {
  table: DisplayTable
  end: 'left' | 'right'
  contents: SlotContent[]
  names: boolean
}

/**
 * What stands on one slot. The stand-up card below is the first version; a tray model made by the
 * designers can replace it later by returning its own object. `card` is the outline a click picks
 * and `name` where the product name sits (both world corners), so labels and the PPT follow.
 */
export type SlotDresser = (
  place: SlotPlace,
  content: SlotContent,
  shape: TableShape,
  names: boolean,
) => Promise<{ object: THREE.Object3D; card: THREE.Vector3[]; name: THREE.Vector3[] }>

export interface TableScene {
  scene: THREE.Scene
  /** Aims a camera from the entrance side, a little to the right, at the whole table; returns
   * the point it looks at. */
  frame: (camera: THREE.PerspectiveCamera) => THREE.Vector3
  target: THREE.Vector3
  slots: { slot: string; card: THREE.Vector3[]; name: THREE.Vector3[] }[]
  dispose: () => void
}

const CARD = { w: 0.3, h: 0.4, head: 0.05, foot: 0.085, tilt: (48 * Math.PI) / 180 }
const PX = 512
const RED = '#e60012'
const BACKGROUND = '#eef1f5'

const images = new Map<string, Promise<HTMLImageElement | null>>()
function loadImage(url: string) {
  let image = images.get(url)
  if (!image) {
    image = new Promise((resolve) => {
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = url
    })
    images.set(url, image)
  }
  return image
}

/** Writes text in one line, shrinking it to fit the width. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number) {
  let size = 56
  ctx.font = `bold ${size}px "Microsoft YaHei", sans-serif`
  while (size > 18 && ctx.measureText(text).width > width) {
    size -= 2
    ctx.font = `bold ${size}px "Microsoft YaHei", sans-serif`
  }
  ctx.fillText(text, x, y, width)
}

/** The card's face: slot code (and 明星位) on top, the tray picture, the product name below. */
async function cardTexture(content: SlotContent, names: boolean) {
  const canvas = document.createElement('canvas')
  canvas.width = PX
  canvas.height = Math.round((PX * CARD.h) / CARD.w)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const scale = PX / CARD.w
    const head = CARD.head * scale
    const foot = CARD.foot * scale
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#374151'
    ctx.font = 'bold 40px "Microsoft YaHei", sans-serif'
    ctx.fillText(content.slot, 22, head / 2 + 4)
    if (content.hero) {
      const x = 30 + ctx.measureText(content.slot).width
      ctx.fillStyle = RED
      ctx.fillRect(x, 12, 132, head - 16)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 32px "Microsoft YaHei", sans-serif'
      ctx.fillText('明星位', x + 18, head / 2 + 4)
    }
    const box = { x: 14, y: head, w: canvas.width - 28, h: canvas.height - head - foot }
    const image = content.photo ? await loadImage(content.photo) : null
    if (image) {
      // Cover the box, cropping the overflowing side.
      const s = Math.max(box.w / image.width, box.h / image.height)
      const sw = box.w / s
      const sh = box.h / s
      ctx.drawImage(
        image,
        (image.width - sw) / 2,
        (image.height - sh) / 2,
        sw,
        sh,
        box.x,
        box.y,
        box.w,
        box.h,
      )
    } else {
      ctx.fillStyle = '#f3f4f6'
      ctx.fillRect(box.x, box.y, box.w, box.h)
      ctx.fillStyle = '#9ca3af'
      ctx.font = '34px "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(content.empty ? '待定' : '暂无图片', canvas.width / 2, box.y + box.h / 2)
      ctx.textAlign = 'left'
    }
    if (names) {
      ctx.fillStyle = content.empty ? '#9ca3af' : content.hero ? RED : '#111827'
      ctx.textAlign = 'center'
      fitText(ctx, content.name, canvas.width / 2, canvas.height - foot / 2, canvas.width - 32)
      ctx.textAlign = 'left'
    }
    ctx.strokeStyle = content.hero ? RED : '#9aa7ba'
    ctx.lineWidth = content.hero ? 16 : 8
    ctx.strokeRect(0, 0, canvas.width, canvas.height)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** The first dresser: a stand-up card leaning back a little, on a silver tray. */
export const cardDresser: SlotDresser = async (place, content, shape, names) => {
  const group = new THREE.Group()
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(place.w, 0.012, place.d),
    new THREE.MeshStandardMaterial({ color: '#c5cad1', metalness: 0.5, roughness: 0.35 }),
  )
  tray.position.set(place.x, shape.height + 0.006, place.z)
  group.add(tray)
  const pivot = new THREE.Group()
  pivot.position.set(place.x, shape.height + 0.012, place.z + place.d * 0.35)
  pivot.rotation.x = -CARD.tilt
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(CARD.w, CARD.h),
    new THREE.MeshBasicMaterial({ map: await cardTexture(content, names), toneMapped: false }),
  )
  card.position.y = CARD.h / 2
  pivot.add(card)
  group.add(pivot)
  group.updateMatrixWorld(true)
  const at = (x: number, y: number) => new THREE.Vector3(x, y, 0).applyMatrix4(pivot.matrixWorld)
  const [l, r] = [-CARD.w / 2, CARD.w / 2]
  return {
    object: group,
    card: [at(l, 0), at(r, 0), at(r, CARD.h), at(l, CARD.h)],
    name: [at(l, 0), at(r, 0), at(r, CARD.foot), at(l, CARD.foot)],
  }
}

/** Module codes written flat along the strip, upright as seen from the viewer. */
function stripTexture(modules: string[], w: number, d: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round((256 * w) / Math.min(w, d))
  canvas.height = Math.round((256 * d) / Math.min(w, d))
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#6b7280'
    ctx.font = 'bold 150px "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const n = Math.max(modules.length, 1)
    modules.forEach((m, i) => {
      const t = (i + 0.5) / n
      if (w >= d) ctx.fillText(m, canvas.width * t, canvas.height / 2)
      else ctx.fillText(m, canvas.width / 2, canvas.height * t)
    })
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    const mesh = node as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      const map = (material as THREE.MeshBasicMaterial).map
      map?.dispose()
      material.dispose()
    }
  })
}

/** Builds one table with what stands on its slots, ready to render from any camera. */
export async function buildTableScene(
  input: TableSceneInput,
  dress: SlotDresser = cardDresser,
): Promise<TableScene> {
  const shape = tableShape(input.table, input.end)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BACKGROUND)
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a8f98', 1.7))
  const sun = new THREE.DirectionalLight('#ffffff', 1.3)
  sun.position.set(2, 4, 3)
  scene.add(sun)

  const root = new THREE.Group()
  scene.add(root)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: '#e3e6eb', roughness: 0.9 }),
  )
  floor.rotation.x = -Math.PI / 2
  root.add(floor)
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(shape.width + 0.02, 0.04, shape.depth + 0.02),
    new THREE.MeshStandardMaterial({ color: '#f6f6f4', roughness: 0.55 }),
  )
  top.position.y = shape.height - 0.02
  root.add(top)
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(shape.width - 0.06, shape.height - 0.04, shape.depth - 0.06),
    new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.7 }),
  )
  body.position.y = (shape.height - 0.04) / 2
  root.add(body)
  if (shape.wall) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(shape.width + 0.3, 1.5, 0.05),
      new THREE.MeshStandardMaterial({ color: '#d4d9e0', roughness: 0.9 }),
    )
    wall.position.set(0, 0.75, -shape.depth / 2 - 0.05)
    root.add(wall)
  }
  if (shape.strip && input.table.modules.length) {
    const { x, z, w, d } = shape.strip
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({
        map: stripTexture(input.table.modules, w, d),
        toneMapped: false,
      }),
    )
    strip.rotation.x = -Math.PI / 2
    strip.position.set(x, shape.height + 0.003, z)
    root.add(strip)
  }

  const byslot = new Map(input.contents.map((c) => [c.slot, c]))
  const slots: TableScene['slots'] = []
  for (const place of shape.slots) {
    const content = byslot.get(place.slot)
    if (!content) continue
    const dressed = await dress(place, content, shape, input.names)
    root.add(dressed.object)
    slots.push({ slot: place.slot, card: dressed.card, name: dressed.name })
  }

  root.updateMatrixWorld(true)
  const target = new THREE.Vector3(0, shape.height + 0.1, 0)
  // Everything that must be in the picture: the table and the cards.
  const points = [
    ...slots.flatMap((s) => s.card),
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].flatMap((sz) =>
        [0, shape.height].map(
          (y) => new THREE.Vector3((sx * shape.width) / 2, y, (sz * shape.depth) / 2),
        ),
      ),
    ),
  ]
  const azimuth = (14 * Math.PI) / 180
  const elevation = (56 * Math.PI) / 180
  const direction = new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  )
  const frame = (camera: THREE.PerspectiveCamera) => {
    // Centre what is seen and move until it just fits (its size is about 1 / distance).
    const aim = target.clone()
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()
    let distance = 3
    for (let i = 0; i < 12; i++) {
      camera.position.copy(aim).addScaledVector(direction, distance)
      camera.lookAt(aim)
      camera.updateMatrixWorld(true)
      camera.updateProjectionMatrix()
      let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity]
      for (const p of points) {
        const v = p.clone().project(camera)
        x0 = Math.min(x0, v.x)
        x1 = Math.max(x1, v.x)
        y0 = Math.min(y0, v.y)
        y1 = Math.max(y1, v.y)
      }
      const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance
      right.setFromMatrixColumn(camera.matrixWorld, 0)
      up.setFromMatrixColumn(camera.matrixWorld, 1)
      aim
        .addScaledVector(right, ((x0 + x1) / 2) * half * camera.aspect)
        .addScaledVector(up, ((y0 + y1) / 2) * half)
      distance *= Math.max((x1 - x0) / 2, (y1 - y0) / 2) / 0.88
    }
    return aim
  }
  return {
    scene,
    frame,
    target,
    slots,
    dispose: () => disposeTree(scene),
  }
}

/** Bounding rectangle of world points on the camera's picture, 0–1 from the top-left. */
export function pictureRect(points: THREE.Vector3[], camera: THREE.Camera): PictureRect {
  const xs: number[] = []
  const ys: number[] = []
  for (const p of points) {
    const v = p.clone().project(camera)
    xs.push((v.x + 1) / 2)
    ys.push((1 - v.y) / 2)
  }
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  const x = clamp(Math.min(...xs))
  const y = clamp(Math.min(...ys))
  return { x, y, w: clamp(Math.max(...xs)) - x, h: clamp(Math.max(...ys)) - y }
}

/**
 * A tilted strip (corners bottom-left, bottom-right, top-right, top-left) as the rectangle that
 * fits it on the picture: the middle of its slanted edges, not the box around them, so a label
 * laid there covers the strip and not the picture above it.
 */
export function stripRect(corners: THREE.Vector3[], camera: THREE.Camera): PictureRect {
  const [bl, br, tr, tl] = corners.map((p) => {
    const v = p.clone().project(camera)
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 }
  })
  if (!bl || !br || !tr || !tl) return pictureRect(corners, camera)
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  const x = clamp((bl.x + tl.x) / 2)
  const y = clamp((tl.y + tr.y) / 2)
  return { x, y, w: clamp((br.x + tr.x) / 2) - x, h: clamp((bl.y + br.y) / 2) - y }
}
