import * as THREE from 'three'
import { trayParts, silver } from './tray-parts.ts'
import {
  additionalProduct,
  buildAdditionalProduct,
  type AdditionalProduct,
} from './four-table-products.ts'
import type { DisplayTable, SiStyle } from '@store/shared'
import type { SlotPlace } from './layout.ts'

export type ProductTray =
  'single' | 'double' | 'scene' | 'ace' | 'go-ultra' | 'mic-pro' | AdditionalProduct

export function productTray(si: SiStyle, unit: string | null): ProductTray | undefined {
  if (si !== 'SI2.0') return
  switch (unit) {
    case 'X4 Air':
    case 'X5':
    case 'X6':
      return 'single'
    case 'X5+X4 Air':
      return 'double'
    case 'AP2':
      return 'ace'
    case 'GO Ultra':
      return 'go-ultra'
    case 'Mic Pro':
      return 'mic-pro'
    case 'scene-X6':
      return 'scene'
    default:
      return additionalProduct(unit)
  }
}

export function outwardAngle(
  slot: string,
  orientation: DisplayTable['orientation'],
  end: 'left' | 'right',
) {
  switch (slot[0]) {
    case 'L':
      return -Math.PI / 2
    case 'R':
      return Math.PI / 2
    case 'T':
      return Math.PI
    case 'E':
      return orientation === 'landscape' ? ((end === 'left' ? -1 : 1) * Math.PI) / 2 : 0
    default:
      return 0 // near row, or a wall-side table facing the aisle
  }
}

const charcoal = 0x282a2d

/** All dimensions are metres, with the customer at +z. The single base and socket use
 * the archived 320 × 180 drawing. Rods, cameras and scene decoration are visual approximations. */
export function makeProductTray(
  kind: ProductTray,
  slotLabel: string,
  graphic: HTMLImageElement | null,
) {
  const group = new THREE.Group()
  const { part, box, post } = trayParts(group)
  function camera(x: number, z: number, bottom: number, white = false) {
    const finish = white ? 0xd8d8d4 : charcoal
    const length = 0.183
    post(0.011, length, x, bottom, z, finish)
    post(0.007, 0.012, x, bottom + length, z, charcoal)
    const y = bottom + length + 0.012
    box(0.048, 0.115, 0.029, x, y + 0.0575, z, finish, 0.007)
    box(0.038, 0.051, 0.002, x, y + 0.044, z + 0.015, 0x152637, 0.001)
    for (const side of [-1, 1]) {
      const lens = part(
        new THREE.SphereGeometry(0.016, 20, 12),
        0x152235,
        x,
        y + 0.092,
        z + side * 0.014,
      )
      lens.scale.z = 0.5
    }
  }
  const sceneTray = kind === 'scene'
  const width = sceneTray ? 0.425 : 0.32
  const depth = sceneTray ? 0.183 : 0.18
  box(width, 0.005, depth, 0, 0.0025, 0, silver)
  if (kind === 'single') {
    post(0.025, 0.01, 0, 0.005, -0.025, silver)
    post(0.015, 0.03, 0, 0.015, -0.025, silver)
    camera(0, -0.025, 0.045)
  } else if (kind === 'ace') {
    post(0.025, 0.01, 0, 0.005, -0.025, silver)
    post(0.015, 0.03, 0, 0.015, -0.025, silver)
    post(0.011, 0.145, 0, 0.045, -0.025, charcoal)
    box(0.071, 0.05, 0.03, 0, 0.218, -0.025, charcoal, 0.004)
    box(0.027, 0.026, 0.005, 0.018, 0.22, -0.008, 0x152235, 0.005)
    box(0.043, 0.031, 0.004, -0.003, 0.259, -0.03, 0x29363a, 0.002)
  } else if (kind === 'go-ultra') {
    // SI2.0 plate and 5 mm acrylic display, drawing p.8: 145 mm wide, 86° inclination.
    box(0.15, 0.01, 0.1, -0.042, 0.01, -0.001, silver, 0.002)
    const panel = box(0.145, 0.2, 0.005, -0.042, 0.114, -0.051, 0xd8dcdf, 0.002)
    panel.rotation.x = (-4 * Math.PI) / 180
    const acrylic = panel.material
    acrylic.transparent = true
    acrylic.opacity = 0.47
    acrylic.depthWrite = false
    box(0.07, 0.014, 0.03, -0.042, 0.022, 0.018, silver, 0.003)
    box(0.066, 0.047, 0.026, -0.042, 0.052, 0.013, 0xe3e3df, 0.006)
    const lens = part(new THREE.SphereGeometry(0.012, 20, 12), 0x192631, -0.025, 0.059, 0.026)
    lens.scale.z = 0.42
    box(0.06, 0.034, 0.005, -0.042, 0.092, 0.004, charcoal, 0.002)
    box(0.034, 0.007, 0.039, 0.095, 0.009, -0.002, charcoal, 0.003)
    const pendant = post(0.018, 0.008, -0.042, 0.143, -0.045, 0xe6e5df)
    pendant.rotation.x = Math.PI / 2
  } else if (kind === 'mic-pro') {
    // SI2.0 drawing p.9: 265 × 135 × 12 mm accessory plinth on the common base.
    box(0.265, 0.012, 0.135, 0, 0.011, -0.004, silver, 0.002)
    box(0.112, 0.047, 0.046, 0, 0.041, -0.042, charcoal, 0.008)
    const lid = box(0.11, 0.046, 0.008, 0, 0.08, -0.062, charcoal, 0.005)
    lid.rotation.x = -0.18
    box(0.046, 0.021, 0.024, -0.075, 0.03, 0.028, 0x26282a, 0.004)
    for (const x of [0.018, 0.082]) {
      const mic = post(0.021, 0.015, x, 0.029, 0.028, charcoal)
      mic.rotation.x = Math.PI / 2
      const cap = post(0.017, 0.002, x, 0.035, 0.037, 0xe2b420)
      cap.rotation.x = Math.PI / 2
    }
  } else if (kind === 'double') {
    box(0.145, 0.01, 0.06, 0, 0.01, -0.012, charcoal)
    box(0.222, 0.01, 0.099, 0, 0.02, -0.012, silver)
    for (const x of [-0.065, 0.065]) {
      post(0.022, 0.009, x, 0.025, -0.012, silver)
      post(0.016, 0.022, x, 0.034, -0.012, silver)
      camera(x, -0.012, 0.056, x > 0)
    }
  } else if (kind === 'scene') {
    box(0.422, 0.021, 0.181, 0, 0.0155, 0, charcoal)
    const terrain = new THREE.PlaneGeometry(0.24, 0.175, 36, 24)
    terrain.rotateX(-Math.PI / 2)
    const p = terrain.attributes['position']!
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i)
      const taper = Math.max(0, 1 - (x / 0.12) ** 2) * Math.max(0, 1 - (z / 0.0875) ** 2)
      p.setY(
        i,
        taper * (0.018 + 0.033 * Math.abs(Math.sin(120 * x + Math.sin(81 * z)) * Math.cos(87 * z))),
      )
    }
    terrain.computeVertexNormals()
    part(terrain, 0x343539, -0.084, 0.0261, 0)
    post(0.007, 0.15, -0.093, 0.026, -0.018, charcoal)
    const disk = post(0.115, 0.009, -0.093, 0.24, -0.018, charcoal)
    disk.rotation.x = Math.PI / 2
    if (graphic) {
      // The circular artwork is the left display in the standard X6 guide render.
      const texture = new THREE.Texture(graphic)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.repeat.set(0.233, 0.447)
      texture.offset.set(0.299, 0.484)
      texture.needsUpdate = true
      const face = new THREE.Mesh(
        new THREE.CircleGeometry(0.111, 64),
        new THREE.MeshBasicMaterial({ map: texture }),
      )
      face.position.set(-0.093, disk.position.y, -0.0134)
      group.add(face)
    }
    const ring = part(new THREE.RingGeometry(0.04, 0.043, 48), 0xffffff, 0.115, 0.0262, -0.015)
    ring.rotation.x = -Math.PI / 2
    camera(0.115, -0.015, 0.026)
  } else {
    buildAdditionalProduct(kind, group, graphic)
  }
  if (!slotLabel) return { group, width, depth }
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 80
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#292c30'
    ctx.fillRect(0, 0, 512, 80)
    ctx.font = 'bold 52px sans-serif'
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.fillText(slotLabel, 256, 58, 500)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12, 0.022),
      new THREE.MeshBasicMaterial({ map: texture }),
    )
    plate.rotation.x = -Math.PI / 2
    plate.position.set(sceneTray ? 0.108 : 0, sceneTray ? 0.0265 : 0.0055, 0.07)
    if (kind === 'GO 3S 复古') {
      plate.scale.set(0.46, 0.45, 1)
      plate.position.z = 0.083
    }
    group.add(plate)
  }
  return { group, width, depth }
}

export function placeProductTray(
  model: ReturnType<typeof makeProductTray>,
  at: SlotPlace,
  height: number,
  angle: number,
) {
  const sideways = Math.abs(Math.sin(angle)) > 0.5
  const scale = Math.min(
    1,
    (sideways ? at.d : at.w) / model.width,
    (sideways ? at.w : at.d) / model.depth,
  )
  model.group.scale.setScalar(scale)
  model.group.rotation.y = angle
  model.group.position.set(at.x, height + 0.001, at.z)
}
