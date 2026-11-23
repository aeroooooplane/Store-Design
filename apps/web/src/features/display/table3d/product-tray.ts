import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { DisplayTable, SiStyle } from '@store/shared'
import type { SlotPlace } from './layout.ts'

export type ProductTray = 'single' | 'double' | 'scene'

export function productTray(si: SiStyle, unit: string | null): ProductTray | undefined {
  if (si !== 'SI2.0') return
  switch (unit) {
    case 'X4 Air':
    case 'X5':
    case 'X6':
      return 'single'
    case 'X5+X4 Air':
      return 'double'
    case 'scene-X6':
      return 'scene'
    default:
      return undefined
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

const silver = 0xb9bfc6
const charcoal = 0x282a2d

/** All dimensions are metres, with the customer at +z. The single base and socket use
 * the archived 320 × 180 drawing. Rods, cameras and scene decoration are visual approximations. */
export function makeProductTray(
  kind: ProductTray,
  slotLabel: string,
  graphic: HTMLImageElement | null,
) {
  const group = new THREE.Group()
  function part(geometry: THREE.BufferGeometry, color: number, x: number, y: number, z: number) {
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: color === silver ? 0.55 : 0.12,
      roughness: 0.43,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    group.add(mesh)
    return mesh
  }
  function box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: number,
    radius = 0,
  ) {
    return part(
      radius ? new RoundedBoxGeometry(w, h, d, 3, radius) : new THREE.BoxGeometry(w, h, d),
      color,
      x,
      y,
      z,
    )
  }
  function post(
    radius: number,
    height: number,
    x: number,
    bottom: number,
    z: number,
    color: number,
  ) {
    return part(
      new THREE.CylinderGeometry(radius, radius, height, 24),
      color,
      x,
      bottom + height / 2,
      z,
    )
  }
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
  } else if (kind === 'double') {
    box(0.145, 0.01, 0.06, 0, 0.01, -0.012, charcoal)
    box(0.222, 0.01, 0.099, 0, 0.02, -0.012, silver)
    for (const x of [-0.065, 0.065]) {
      post(0.022, 0.009, x, 0.025, -0.012, silver)
      post(0.016, 0.022, x, 0.034, -0.012, silver)
      camera(x, -0.012, 0.056, x > 0)
    }
  } else {
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
  }
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
