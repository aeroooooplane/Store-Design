import * as THREE from 'three'
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js'
import { silver, trayParts } from './tray-parts.ts'

const black = 0x242426
const white = 0xece8dc

function roundedOutline(w: number, h: number, r: number, cx = 0) {
  const s = new THREE.Shape()
  const l = cx - w / 2,
    right = cx + w / 2,
    top = h / 2,
    b = -top
  s.moveTo(l + r, b)
  s.lineTo(right - r, b)
  s.quadraticCurveTo(right, b, right, b + r)
  s.lineTo(right, top - r)
  s.quadraticCurveTo(right, top, right - r, top)
  s.lineTo(l + r, top)
  s.quadraticCurveTo(l, top, l, top - r)
  s.lineTo(l, b + r)
  s.quadraticCurveTo(l, b, l + r, b)
  return s
}

// Coordinates on the SI2.0 shop photo (1280 × 960). Only the printed panel
// is sampled. Its four corners taper in perspective towards the bottom.
function printedFace(
  geometry: THREE.BufferGeometry,
  image: HTMLImageElement,
  pendant: boolean,
  si1: boolean,
) {
  const pos = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / 145 + 0.5
    const v = 1 - (pos.getY(i) + (pendant ? 126 : 0)) / 200
    const t = v / (0.86 + 0.14 * v)
    const x = THREE.MathUtils.lerp(446 + 331 * u, 459 + 280 * u, t)
    const y = THREE.MathUtils.lerp(109 + 12 * u, 514 + 7 * u, t)
    if (si1) {
      // Corners of the printed panel on the archived SI1.0 shop photo (400 × 225 reference).
      uv.setXY(
        i,
        THREE.MathUtils.lerp(160 + 87 * u, 167 + 69 * u, t) / 400,
        1 - THREE.MathUtils.lerp(12 - 7 * u, 122 - 14 * u, t) / 225,
      )
    } else uv.setXY(i, x / 1280, 1 - y / 960)
  }
  const map = new THREE.Texture(image)
  map.colorSpace = THREE.SRGBColorSpace
  map.needsUpdate = true
  return new THREE.MeshBasicMaterial({ map, toneMapped: false, side: THREE.DoubleSide })
}

function displayBoard(parent: THREE.Group, image: HTMLImageElement | null, si1: boolean) {
  const board = new THREE.Group()
  board.position.set(0, 12, -56)
  board.rotation.x = -THREE.MathUtils.degToRad(4)
  parent.add(board)
  const parts = trayParts(board)
  // Two cord notches open into the top edge.
  const outline = new THREE.Shape()
  outline.moveTo(-72.5, 0)
  outline.lineTo(72.5, 0)
  outline.lineTo(72.5, 195)
  outline.quadraticCurveTo(72.5, 200, 67.5, 200)
  for (const x of [33, -33]) {
    outline.lineTo(x + 5, 200)
    outline.lineTo(x + 5, 197)
    outline.absarc(x, 197, 5, 0, -Math.PI, true)
    outline.lineTo(x - 5, 200)
  }
  outline.lineTo(-67.5, 200)
  outline.quadraticCurveTo(-72.5, 200, -72.5, 195)
  outline.closePath()
  const acrylic = new THREE.ExtrudeGeometry(outline, { depth: 5, bevelEnabled: false })
  parts.part(acrylic, 0xdadadb, 0, 0, -2.5)
  if (image) {
    for (const z of [-2.55, 2.55]) {
      const geometry = new TessellateModifier(16, 8).modify(new THREE.ShapeGeometry(outline))
      const face = new THREE.Mesh(geometry, printedFace(geometry, image, false, si1))
      face.position.z = z
      board.add(face)
    }
  }
  const disc = parts.post(27, 4, 0, 0, 0, white)
  disc.rotation.x = Math.PI / 2
  disc.position.set(0, 126, 4.5)
  if (image) {
    const geo = new THREE.CircleGeometry(27, 48)
    const face = new THREE.Mesh(geo, printedFace(geo, image, true, si1))
    face.position.set(0, 126, 6.55)
    board.add(face)
    return // The photo includes the two cords and their ferrules.
  }
  for (const sign of [-1, 1]) {
    const a = new THREE.Vector3(sign * 33, 197, 3),
      b = new THREE.Vector3(sign * 12, 149, 5)
    const cord = parts.post(1.75, a.distanceTo(b), 0, 0, 0, white)
    cord.position.copy(a).lerp(b, 0.5)
    cord.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize())
  }
}

function sample(parent: THREE.Group, retro: boolean) {
  const holder = new THREE.Group()
  holder.position.set(retro ? 48 : -47, 12, retro ? -8 : 24)
  holder.rotation.y = THREE.MathUtils.degToRad(-25)
  parent.add(holder)
  trayParts(holder).box(92, 9, 42, 0, 4.5, 0, silver, 2)
  const unit = new THREE.Group()
  unit.position.set(0, 29, 0)
  unit.rotation.x = -0.28
  holder.add(unit)
  const { part, box, post } = trayParts(unit)
  const body = roundedOutline(84, 39, 9)
  if (retro) body.holes.push(roundedOutline(15, 18, 4, 28))
  part(
    new THREE.ExtrudeGeometry(body, {
      depth: 17,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 1.3,
      bevelThickness: 1.3,
    }),
    retro ? white : black,
    0,
    0,
    -9,
  )
  const pod = roundedOutline(retro ? 49 : 66, 25, 12)
  part(
    new THREE.ExtrudeGeometry(pod, {
      depth: 6,
      bevelEnabled: true,
      bevelSize: 1,
      bevelThickness: 1,
      bevelSegments: 2,
    }),
    retro ? white : 0x303033,
    retro ? -12 : 0,
    1,
    8,
  )
  box(15, 1.7, 7, retro ? 21 : -23, 20.5, 0, black, 0.8)
  box(2, 6, 7, 42.5, 0, 0, 0x444345, 1)
  if (retro)
    for (const [i, c] of [0xe09c3c, 0xd84e49, 0x78529a].entries())
      box(27, 1.45, 0.5, -19, -3 - i * 1.6, 15.2, c, 0.2)
  for (const [r, d, z, c] of [
    [10.8, 3, 16, black],
    [8.7, 2, 18, 0x48474a],
    [6.8, 2, 19.8, 0x101820],
  ] as const) {
    const lens = post(r, d, 0, 0, 0, c)
    lens.rotation.x = Math.PI / 2
    lens.position.set(retro ? 1 : 17, 1, z)
  }
}

export function buildRetroGo(parent: THREE.Group, image: HTMLImageElement | null, si1 = false) {
  trayParts(parent).box(216, 12, 158, 0, 6, -3, silver, 2)
  displayBoard(parent, image, si1)
  sample(parent, false)
  sample(parent, true)
}
