import * as THREE from 'three'
import type { ProductAssembly } from './product-tray.ts'
import { buildRetroGo } from './retro-go.ts'
import { trayParts, silver } from './tray-parts.ts'

// Each key is an SI1.0 choice from the approved catalog. Shared assemblies omit the SI2.0 base.
const shared = {
  'X4 Air': 'single',
  X5: 'single',
  X6: 'single',
  'X5+X4 Air': 'double',
  AP1: 'ace',
  AP2: 'ace',
  'AP2 街拍': 'AP2 街拍',
  'AP2 大师': 'AP2 大师',
  'GO Ultra': 'go-ultra',
  AG: 'AG',
  'AG Pac Neo': 'AG Pac Neo',
  'AG Pac Air': 'AG Pac Air',
  'Luna A': 'Luna A',
  'Luna B': 'Luna B',
  'Luna C': 'Luna C',
  Flow2: 'Flow2',
  Link2: 'Link2',
  'Mic Pro': 'mic-pro',
  'scene-Luna Ultra': 'scene-Luna Ultra',
  'scene-AG': 'scene-AG',
} as const satisfies Record<string, ProductAssembly>
const dedicated = [
  'GO 3S 复古',
  'hero-X5',
  'hero-GO3S',
  'hero-AP2',
  'GO3S',
  'GO Ultra-v1',
  'GO Ultra HK',
  'Snap',
  'scene-X5',
  'scene-GO Ultra',
  'scene-GO Ultra HK',
  'scene-AP2',
] as const
type Unit = keyof typeof shared | (typeof dedicated)[number]
export interface Si1Selection {
  si: 'SI1.0'
  unit: Unit
  scene: boolean
}
const choices = new Set<string>([...Object.keys(shared), ...dedicated])
export function si1Selection(unit: string | null): Si1Selection | undefined {
  if (unit && choices.has(unit))
    return { si: 'SI1.0', unit: unit as Unit, scene: unit.startsWith('scene-') }
  return undefined
}

const ink = 0x212327,
  glass = 0x12202e,
  ivory = 0xeae8e1
type Parts = ReturnType<typeof trayParts>
function lens(p: Parts, x: number, y: number, z: number, r: number) {
  const lens = p.post(r, 0.006, x, y - 0.003, z, glass)
  lens.rotation.x = Math.PI / 2
}
function goDock(p: Parts, x: number, y: number, z: number, w: number, color: number) {
  p.box(w, w * 0.61, w * 0.43, x, y + w * 0.305, z, color, w * 0.08)
  lens(p, x + w * 0.18, y + w * 0.36, z + w * 0.216, w * 0.14)
  p.box(w * 0.74, w * 0.42, 0.004, x, y + w * 0.815, z - w * 0.14, glass, 0.002)
}
function printedDisc(
  p: Parts,
  x: number,
  y: number,
  z: number,
  r: number,
  graphic: HTMLImageElement | null,
  uv: readonly [number, number, number, number],
) {
  const rim = p.post(r, 0.006, x, y - 0.003, z, ink)
  rim.rotation.x = Math.PI / 2
  const face = p.part(new THREE.CircleGeometry(r * 0.96, 48), 0x91b5c1, x, y, z + 0.0032)
  if (graphic) {
    const texture = new THREE.Texture(graphic)
    texture.repeat.set(uv[2], uv[3])
    texture.offset.set(uv[0], 1 - uv[1] - uv[3])
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    face.material.map = texture
    face.material.color.set(0xffffff)
  }
}

function goShelf(p: Parts, unit: Unit) {
  const upper = unit === 'GO Ultra-v1' ? ink : ivory
  for (const x of [-0.108, 0.015]) p.box(0.006, 0.061, 0.054, x, 0.04, -0.026, silver)
  p.box(0.142, 0.005, 0.062, -0.047, 0.073, -0.026, silver)
  goDock(p, -0.052, 0.075, -0.025, 0.059, upper)
  if (unit === 'GO Ultra-v1') {
    p.box(0.032, 0.031, 0.02, -0.105, 0.024, 0.038, ivory, 0.006)
    lens(p, -0.105, 0.027, 0.05, 0.008)
  } else {
    p.post(0.018, 0.009, -0.103, 0.009, 0.033, ink)
    p.post(0.009, 0.026, -0.103, 0.018, 0.033, ink)
    p.box(0.033, 0.005, 0.011, -0.103, 0.046, 0.033, ink, 0.002)
  }
  if (unit === 'hero-GO3S' || unit === 'GO Ultra HK')
    p.box(0.033, 0.015, 0.024, -0.104, 0.083, -0.022, ivory, 0.004)
  p.post(0.018, 0.01, -0.049, 0.009, 0.033, ivory)
  p.box(0.034, 0.014, 0.027, 0.006, 0.016, 0.033, ink, 0.004)
}

function kittyHeart(p: Parts, graphic: HTMLImageElement | null) {
  // The ordinary Hello Kitty edition adds a heart-shaped tabletop panel above the price insert.
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.quadraticCurveTo(-0.055, 0.052, -0.033, 0.066)
  shape.quadraticCurveTo(-0.013, 0.078, 0, 0.055)
  shape.quadraticCurveTo(0.02, 0.08, 0.035, 0.062)
  shape.quadraticCurveTo(0.049, 0.044, 0, 0)
  const frame = p.part(
    new THREE.ExtrudeGeometry(shape, { depth: 0.003, bevelEnabled: false }),
    0xf2cdd6,
    0.109,
    0.019,
    -0.049,
  )
  p.box(0.069, 0.013, 0.023, 0.109, 0.012, -0.048, ivory, 0.002)
  if (graphic) {
    const art = new THREE.ShapeGeometry(shape)
    const pos = art.getAttribute('position'),
      uv = art.getAttribute('uv')
    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getX(i) + 0.041) / 0.082,
        v = pos.getY(i) / 0.071
      uv.setXY(i, (221 + 70 * u) / 400, 1 - (118 - 60 * v) / 225)
    }
    const tex = new THREE.Texture(graphic)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    const face = new THREE.Mesh(art, new THREE.MeshBasicMaterial({ map: tex }))
    face.position.z = 0.0032
    frame.add(face)
  }
}

function snap(p: Parts) {
  p.box(0.091, 0.009, 0.126, 0, 0.0045, 0, silver, 0.006)
  const holder = p.box(0.068, 0.079, 0.01, 0, 0.049, -0.017, ivory, 0.005)
  holder.rotation.x = -0.24
  const phone = new THREE.Group()
  holder.add(phone)
  phone.position.set(0, 0.037, 0.01)
  const parts = trayParts(phone)
  parts.box(0.074, 0.145, 0.009, 0, 0, 0, ivory, 0.006)
  parts.box(0.061, 0.089, 0.007, 0, -0.012, 0.008, 0xd5d0cf, 0.005)
  for (const [x, y] of [
    [-0.023, 0.059],
    [-0.012, 0.052],
    [-0.023, 0.044],
  ] as const)
    lens(parts, x, y, 0.006, 0.005)
}

function ace(p: Parts, x: number, y: number, z: number, w: number) {
  p.box(w, w * 0.64, w * 0.42, x, y + w * 0.32, z, ink, w * 0.06)
  lens(p, x + w * 0.21, y + w * 0.34, z + w * 0.21, w * 0.2)
  p.box(w * 0.38, w * 0.37, 0.003, x - w * 0.24, y + w * 0.32, z + w * 0.215, glass)
}
function sceneProduct(p: Parts, unit: Unit, graphic: HTMLImageElement | null) {
  const go = unit === 'scene-GO Ultra' || unit === 'scene-GO Ultra HK'
  p.box(0.33, 0.016, 0.16, 0.031, 0.013, 0, go ? 0x909d66 : ink, 0.003)
  // Tablet next to the scene, visible from the aisle.
  const tablet = p.box(0.068, 0.009, 0.112, -0.164, 0.014, 0.008, ink, 0.004)
  tablet.rotation.x = 0.1
  if (unit === 'scene-AP2') {
    ace(p, -0.004, 0.021, -0.021, 0.176)
    p.box(0.15, 0.085, 0.008, -0.004, 0.178, -0.05, glass, 0.008)
    ace(p, 0.142, 0.021, 0.031, 0.066)
  } else if (go) {
    const kitty = unit === 'scene-GO Ultra HK'
    p.post(0.055, 0.016, 0.117, 0.022, -0.015, ivory)
    p.box(0.098, 0.099, 0.055, 0.117, 0.09, -0.015, ivory, 0.022)
    lens(p, 0.139, 0.109, 0.014, 0.022)
    p.post(0.005, 0.071, -0.049, 0.02, -0.025, silver)
    printedDisc(
      p,
      -0.049,
      0.109,
      -0.025,
      0.068,
      graphic,
      kitty ? [0.35, 0.2, 0.19, 0.34] : [0.374, 0.42, 0.182, 0.323],
    )
    if (kitty)
      for (const dx of [-0.025, 0.002])
        p.box(0.025, 0.023, 0.008, -0.059 + dx, 0.17, -0.021, 0xd7476c, 0.006)
    goDock(p, -0.045, 0.022, 0.03, 0.052, ivory)
  } else {
    p.post(0.008, 0.098, -0.045, 0.021, -0.027, ink)
    printedDisc(p, -0.045, 0.164, -0.027, 0.069, graphic, [0.358, 0.222, 0.15, 0.267])
    p.box(0.081, 0.203, 0.055, 0.1, 0.123, 0, ink, 0.013)
    lens(p, 0.1, 0.19, 0.028, 0.024)
    p.box(0.064, 0.104, 0.002, 0.1, 0.103, 0.028, glass)
  }
}

export function makeSi1Tray(
  selection: Si1Selection,
  graphic: HTMLImageElement | null,
  assemble: (
    kind: ProductAssembly,
    image: HTMLImageElement | null,
    base: boolean,
  ) => { group: THREE.Group },
) {
  const { unit, scene } = selection
  const group = new THREE.Group()
  const p = trayParts(group)
  if (unit === 'Snap') {
    snap(p)
    return { group, width: 0.091, depth: 0.126 }
  }
  // Display footprints approximated from SI1.0 reference views. Regular units have a right-hand price insert.
  const width = scene ? 0.425 : 0.32,
    depth = scene ? 0.183 : 0.18
  p.box(width, 0.005, depth, 0, 0.0025, 0, 0xb7b9bd, 0.002)
  if (!scene) {
    p.box(0.207, 0.003, 0.14, -0.044, 0.0065, 0, 0x7f8186, 0.003)
    p.box(0.073, 0.001, 0.124, 0.112, 0.0056, 0, ivory, 0.002)
  }
  if (Object.hasOwn(shared, unit)) {
    const assembly = assemble(shared[unit as keyof typeof shared], null, false).group
    const scale = scene ? 0.95 : 0.76
    assembly.scale.setScalar(scale)
    assembly.position.set(scene ? 0 : -0.043, 0.006, 0)
    group.add(assembly)
  } else if (unit === 'GO 3S 复古') {
    const retro = new THREE.Group()
    retro.scale.setScalar(0.00084)
    retro.position.set(-0.042, 0.008, 0)
    buildRetroGo(retro, graphic, true)
    group.add(retro)
  } else if (unit === 'hero-X5') {
    p.post(0.007, 0.16, -0.043, 0.008, 0, ink)
    printedDisc(p, -0.043, 0.224, -0.012, 0.083, graphic, [0.343, 0.089, 0.291, 0.433])
    p.box(0.037, 0.093, 0.026, -0.043, 0.2, 0.012, ink, 0.005)
    lens(p, -0.043, 0.23, 0.027, 0.01)
  } else if (unit === 'hero-AP2') {
    ace(p, -0.043, 0.009, 0, 0.083)
  } else if (unit === 'GO Ultra HK') {
    goShelf(p, unit)
    kittyHeart(p, graphic)
  } else if (scene) {
    sceneProduct(p, unit, graphic)
  } else {
    goShelf(p, unit)
  }
  return { group, width, depth }
}
