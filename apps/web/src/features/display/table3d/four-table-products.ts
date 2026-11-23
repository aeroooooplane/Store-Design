import { buildRetroGo } from './retro-go.ts'
import * as THREE from 'three'
import { trayParts, silver } from './tray-parts.ts'

const selections = [
  'Luna A',
  'Luna B',
  'Flow2',
  'Link2',
  'AG',
  'AG Pac Air',
  'AG Pac Neo',
  'GO Ultra HK',
  'GO 3S 复古',
  'AP2 大师',
  'AP2 街拍',
] as const
export type AdditionalProduct = (typeof selections)[number]
export function additionalProduct(unit: string | null) {
  return selections.find((id) => id === unit)
}

const graphite = 0x26282c,
  glass = 0x142331,
  ivory = 0xe6e5de,
  gray = 0xa7abac
/** Local millimetres above the 5 mm base sheet. Fixtures follow the SI2.0 guide and
 * assembled shop photos. Devices, rods and the two Pac kits are display approximations. */
function components(group: THREE.Group) {
  const { box, post, part } = trayParts(group)
  function oval(x: number, y: number, z: number, w: number, h: number, d: number, color: number) {
    const m = part(new THREE.SphereGeometry(1, 24, 16), color, x, y, z)
    m.scale.set(w / 2, h / 2, d / 2)
    return m
  }
  function rod(
    a: [number, number, number],
    b: [number, number, number],
    radius: number,
    color: number,
  ) {
    const from = new THREE.Vector3(...a),
      to = new THREE.Vector3(...b)
    const axis = to.sub(from)
    const mesh = post(radius, axis.length(), 0, 0, 0, color)
    mesh.position.copy(from).addScaledVector(axis, 0.5)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize())
  }
  function cameraFace(x: number, y: number, z: number, w: number, h: number, body: number) {
    box(w, h, 24, x, y, z, body, 5)
    oval(x + w * 0.19, y + 1, z + 12, h * 0.64, h * 0.64, 9, glass)
    box(w * 0.3, h * 0.49, 2, x - w * 0.24, y, z + 12, 0x354958, 1)
  }
  return { box, post, part, oval, rod, cameraFace }
}
type Parts = ReturnType<typeof components>

function luna(p: Parts, dual: boolean) {
  p.box(265, 12, 134, 0, 6, -5, silver, 2)
  // A has two handheld gimbals; B replaces the second with creator accessories.
  function handheld(x: number, color: number) {
    p.post(16, 8, x, 12, 5, gray)
    p.box(30, 85, 24, x, 60, 5, color, 7)
    p.box(34, 27, 4, x, 72, 19, glass, 3)
    p.oval(x, 43, 18, 11, 11, 3, 0x505559)
    p.post(6, 16, x, 102, 5, graphite)
    p.rod([x, 116, 5], [x + 12, 124, 5], 5, color)
    p.box(41, 24, 24, x, 132, 5, color, 8)
    p.oval(x + 5, 132, 17, 15, 15, 6, glass)
  }
  handheld(-67, graphite)
  if (dual) handheld(67, ivory)
  else {
    p.post(15, 41, 26, 12, 5, graphite)
    p.oval(83, 32, 9, 34, 36, 31, 0x434547)
    p.oval(83, 32, 24, 25, 25, 4, 0xe0b52c)
  }
}

function flow(p: Parts) {
  // Both retail gimbals are displayed open. The Pro carries a phone on the rear stand.
  function gimbal(x: number, z: number, color: number, phone: boolean) {
    for (const a of [Math.PI / 2, (7 * Math.PI) / 6, (11 * Math.PI) / 6]) {
      p.rod([x, 30, z], [x + 43 * Math.cos(a), 3, z + 43 * Math.sin(a)], 3.3, color)
    }
    p.post(10, 85, x, 19, z, color)
    p.oval(x, 81, z + 8, 13, 23, 4, gray)
    p.rod([x, 101, z], [x - 16, 142, z - 4], 6, color)
    p.rod([x - 16, 142, z - 4], [x + 4, 158, z - 4], 5, color)
    p.oval(x + 4, 158, z - 4, 24, 25, 16, color)
    p.box(43, 13, 12, x + 4, 161, z + 6, color, 3)
    if (phone) {
      p.box(75, 145, 8, x + 4, 162, z + 14, graphite, 5)
      p.box(69, 137, 1, x + 4, 162, z + 18.3, 0x384b58, 3)
    }
  }
  gimbal(-64, -20, ivory, true)
  gimbal(65, 22, 0xd2d0ca, false)
}

function link(p: Parts) {
  p.box(203, 5, 132, -38, 4, 0, gray, 3)
  const lid = p.box(199, 118, 5, -38, 62, -65, graphite, 3)
  lid.rotation.x = -0.13
  const screen = p.box(190, 109, 1, -38, 62, -61.8, 0x425975, 2)
  screen.rotation.x = lid.rotation.x
  for (let i = 0; i < 5; i++) p.box(165, 1, 5, -38, 7, -36 + i * 9, graphite, 1)
  p.box(50, 1, 25, -38, 7, 38, 0x9b9c9c, 1)
  p.post(18, 7, 110, 0, 0, graphite)
  p.post(5, 32, 110, 7, 0, graphite)
  p.box(30, 140, 28, 110, 106, 0, graphite, 7)
  p.box(40, 25, 23, 110, 188, 0, graphite, 6)
  p.oval(103, 188, 12, 14, 14, 5, glass)
}

function aerial(p: Parts, kind: 'AG' | 'AG Pac Air' | 'AG Pac Neo') {
  const neo = kind === 'AG Pac Neo'
  const y = 187
  p.post(6, y, 0, 0, -28, silver)
  p.oval(0, y, -28, 43, 34, 80, ivory)
  p.oval(0, y - 8, 11, 16, 16, 12, glass)
  for (const side of [-1, 1])
    for (const fore of [-1, 1]) {
      const x = side * 73,
        z = -22 + fore * 48
      p.rod([side * 12, y, -28 + fore * 15], [x, y, z], 4, ivory)
      p.post(6, 9, x, y - 3, z, gray)
      const blade = p.box(neo ? 48 : 69, 2, 8, x, y + 8, z, graphite, 2)
      blade.rotation.y = side * fore * 0.62
      if (neo) {
        const guard = p.part(new THREE.TorusGeometry(35, 1.6, 6, 32), ivory, x, y + 9, z)
        guard.rotation.x = Math.PI / 2
        p.rod([x - 32, y + 9, z], [x + 32, y + 9, z], 1.5, ivory)
      }
    }
  if (neo) {
    p.box(204, 12, 77, 0, 6, 20, silver, 3)
    p.box(25, 50, 21, -47, 40, 25, ivory, 6)
    p.box(26, 30, 5, -47, 53, 38, glass, 3)
    p.box(56, 15, 18, 54, 19, 24, ivory, 5)
  } else {
    const gogglesY = kind === 'AG' ? 39 : 82
    if (kind !== 'AG') p.post(5, 75, 0, 0, 0, gray)
    p.box(102, 50, 43, -10, gogglesY, 4, ivory, 10)
    for (const side of [-1, 1]) {
      p.oval(-10 + side * 25, gogglesY, 27, 42, 37, 7, glass)
      p.rod(
        [-10 + side * 44, gogglesY + 15, -8],
        [-10 + side * 54, gogglesY + 43, -11],
        3,
        graphite,
      )
    }
    if (kind === 'AG') {
      p.box(22, 72, 25, 88, 40, 17, ivory, 8)
      p.oval(88, 76, 17, 20, 15, 19, graphite)
    } else {
      p.box(79, 22, 34, -10, 19, 56, ivory, 8)
      for (const side of [-1, 1]) p.oval(-10 + side * 29, 16, 68, 25, 23, 36, ivory)
    }
  }
}

function kittyGo(p: Parts) {
  p.box(230, 10, 100, 0, 6, -3, silver, 2)

  // Die-cut character display (219 × 270 × 5 mm) behind the pink camera dock.
  p.oval(-22, 88, -39, 119, 151, 5, 0xe74665)
  p.oval(-22, 186, -39, 189, 146, 5, ivory)
  for (const side of [-1, 1]) {
    const ear = p.part(new THREE.ConeGeometry(29, 49, 3), ivory, -22 + side * 64, 244, -39)
    ear.scale.z = 0.11
    ear.rotation.z = -side * 0.32
    p.oval(-22 + side * 38, 185, -35, 9, 15, 2, graphite)
    for (const offset of [-7, 4, 15])
      p.rod(
        [-22 + side * 76, 174 + offset, -34],
        [-22 + side * 105, 174 + offset * 1.6, -34],
        1.6,
        graphite,
      )
  }
  p.oval(-22, 175, -35, 12, 8, 2, 0xdba432)
  for (const x of [17, 45]) p.oval(x, 234, -34, 32, 25, 7, 0xe3365d)
  p.oval(31, 234, -28, 16, 17, 5, 0xd8304e)
  p.cameraFace(-25, 39, 16, 65, 47, 0xf1c9cf)
  p.box(37, 6, 40, 82, 13, 0, graphite, 4)
}

function aceKit(p: Parts, master: boolean) {
  p.box(180, 12, 145, 0, 6, -3, silver, 2)
  p.box(170, 2, 135, 0, 13, -3, 0x636669, 2)
  if (master) p.box(85, 18, 62, 0, 24, 1, graphite, 4)
  const y = master ? 57 : 40
  p.cameraFace(6, y, 0, 89, 49, master ? graphite : 0x50545b)
  p.box(22, 53, 32, -43, y, 0, graphite, 5)
  p.post(7, 5, -42, y + 25, 0, 0x55575a)
}
export function buildAdditionalProduct(
  kind: AdditionalProduct,
  parent: THREE.Group,
  graphic: HTMLImageElement | null = null,
) {
  const assembly = new THREE.Group()
  assembly.scale.setScalar(0.001)
  assembly.position.y = 0.005
  const p = components(assembly)
  switch (kind) {
    case 'Luna A':
    case 'Luna B':
      luna(p, kind === 'Luna A')
      break
    case 'Flow2':
      flow(p)
      break
    case 'Link2':
      link(p)
      break
    case 'AG':
    case 'AG Pac Air':
    case 'AG Pac Neo':
      aerial(p, kind)
      break
    case 'GO Ultra HK':
      kittyGo(p)
      break
    case 'GO 3S 复古':
      buildRetroGo(assembly, graphic)
      break
    case 'AP2 大师':
    case 'AP2 街拍':
      aceKit(p, kind === 'AP2 大师')
      break
  }
  parent.add(assembly)
}
