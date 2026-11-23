import * as THREE from 'three'
import type { TableShape } from './layout.ts'

type Strip = NonNullable<TableShape['strip']>
export type InnerVersion = 'legacy' | '2026'

// 指引第三节总装图及 A/C/D 单件图，毫米。桌体索引中的 strip 仅用于确定中心与长轴。
const FRAME = { length: 680, width: 135, height: 30, clearLength: 670, clearWidth: 125 }
/** Centers measured on the unrotated SI2.0 meshes at the 27 mm-deep pocket.
 * The catalog strip also spans unused space between product rows. */
export function socketOnBody(asset: string, strip: Strip): Strip {
  switch (asset) {
    case 'asset-24312623':
      return { ...strip, x: 0, z: -0.002 }
    case 'asset-41053706':
      return { ...strip, x: 0.002, z: 0 }
    default:
      return strip
  }
}
function lengthMm(id: string) {
  if (/^A\d+$/.test(id)) return 110
  if (/^C\d+$/.test(id)) return 445
  if (/^D\d+$/.test(id)) return 225
  return 0
}

export function innerFitNote(ids: string[]) {
  const notes: string[] = []
  const excess = ids.reduce((n, id) => n + lengthMm(id), 0) - FRAME.clearLength
  if (excess > 0) notes.push(`内盘合计超过外框净长 ${excess} mm，请核对组合`)
  const unknown = ids.filter((id) => !lengthMm(id))
  if (unknown.length) notes.push(`${unknown.join('、')} 缺少尺寸图，未建模`)
  return notes.join('。')
}

export function innerPlaces(ids: string[], strip: Strip, end: 'left' | 'right') {
  const horizontal = strip.w > strip.d
  const known = ids.filter((id) => lengthMm(id) > 0)
  const total = known.reduce((n, id) => n + lengthMm(id), 0)
  const gap =
    known.length > 1
      ? Math.min(1, Math.max(0, (FRAME.clearLength - total) / (known.length - 1)))
      : 0
  let cursor = -(total + gap * Math.max(0, known.length - 1)) / 2
  return known.map((id) => {
    const span = lengthMm(id)
    const center = (cursor + span / 2) / 1000
    cursor += span + gap
    const direction = horizontal && end === 'left' ? -1 : 1
    return {
      id,
      span: span / 1000,
      width: FRAME.clearWidth / 1000,
      x: strip.x + (horizontal ? direction * center : 0),
      z: strip.z + (horizontal ? 0 : center),
      angle: horizontal ? (direction === 1 ? 0 : Math.PI) : -Math.PI / 2,
    }
  })
}

/** Cut only the local socket in the preview's table. Cached catalog materials stay shared elsewhere. */
export function openTraySocket(table: THREE.Object3D, strip: Strip, height: number) {
  const horizontal = strip.w > strip.d
  const halfX = (horizontal ? FRAME.length : FRAME.width) / 2000
  const halfZ = (horizontal ? FRAME.width : FRAME.length) / 2000
  const planes = [
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), strip.x - halfX),
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -strip.x - halfX),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), strip.z - halfZ),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -strip.z - halfZ),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), height - FRAME.height / 1000),
  ]
  const copies = new Map<THREE.Material, THREE.Material>()
  function cut(original: THREE.Material) {
    let m = copies.get(original)
    if (!m) {
      m = original.clone()
      m.clippingPlanes = planes
      m.clipIntersection = true
      copies.set(original, m)
    }
    return m
  }
  table.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      const mesh = node as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cut) : cut(mesh.material)
    }
  })
  return () => copies.forEach((material) => material.dispose())
}

function block(
  group: THREE.Group,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  group.add(mesh)
}

export async function buildInnerTrays(
  ids: string[],
  strip: Strip,
  height: number,
  end: 'left' | 'right',
  version: InnerVersion,
  image: (url: string) => Promise<HTMLImageElement | null>,
) {
  const root = new THREE.Group()
  const frame = new THREE.Group()
  frame.position.set(strip.x, height + 0.0005, strip.z)
  frame.rotation.y = strip.w > strip.d ? 0 : -Math.PI / 2
  root.add(frame)
  const metal = new THREE.MeshStandardMaterial({
    color: 0xaeafb1,
    metalness: 0.45,
    roughness: 0.48,
  })
  const l = FRAME.length / 1000,
    w = FRAME.width / 1000,
    h = FRAME.height / 1000
  block(frame, l, 0.005, w, 0, -h + 0.0025, 0, metal)
  for (const side of [-1, 1]) {
    block(frame, l, h, 0.005, 0, -h / 2, (side * (w - 0.005)) / 2, metal)
    block(frame, 0.005, h, w - 0.01, (side * (l - 0.005)) / 2, -h / 2, 0, metal)
  }
  const models = await Promise.all(
    innerPlaces(ids, strip, end).map(async (p) => {
      const group = new THREE.Group()
      group.position.set(p.x, height + 0.0005 - 0.025, p.z)
      group.rotation.y = p.angle
      const liner = new THREE.MeshStandardMaterial({ color: 0xb8b8b7, roughness: 0.96 })
      block(group, p.span, 0.005, p.width, 0, 0.0025, 0, liner)
      const rim = 0.01
      for (const side of [-1, 1]) {
        block(group, p.span, 0.015, rim, 0, 0.0125, (side * (p.width - rim)) / 2, liner)
        block(group, rim, 0.015, p.width - 2 * rim, (side * (p.span - rim)) / 2, 0.0125, 0, liner)
      }
      const pic = await image(
        '/api/v1/display-inner-trays/' + version + '/' + encodeURIComponent(p.id),
      )
      const grooves = p.id.startsWith('C')
      const surface = new THREE.PlaneGeometry(
        p.span - 2 * rim,
        p.width - 2 * rim,
        1,
        grooves ? 84 : 1,
      )
      surface.rotateX(-Math.PI / 2)
      if (grooves) {
        // Section C: two 45 mm longitudinal channels with a 10 mm divider.
        const pos = surface.getAttribute('position')
        for (let i = 0; i < pos.count; i++) {
          const radius = 0.0225
          const offset = (Math.abs(pos.getZ(i)) - 0.0275) / radius
          pos.setY(i, 0.015 * (1 - Math.sqrt(Math.max(0, 1 - offset * offset))))
        }
        surface.computeVertexNormals()
      }
      let finish: THREE.Material = liner
      if (pic) {
        // Project the whole source onto the physical footprint, cropping the printed
        // rim where the actual geometry begins. Both image axes use the same px/mm.
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(p.span * 4000)
        canvas.height = Math.round(p.width * 4000)
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const scale = Math.min(canvas.width / pic.naturalWidth, canvas.height / pic.naturalHeight)
          const w = pic.naturalWidth * scale,
            h = pic.naturalHeight * scale
          ctx.fillStyle = '#bbbcb9'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(pic, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
        }
        const texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.offset.set(rim / p.span, rim / p.width)
        texture.repeat.set(1 - (2 * rim) / p.span, 1 - (2 * rim) / p.width)
        finish = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
      }
      const face = new THREE.Mesh(surface, finish)
      face.position.y = 0.0052
      group.add(face)
      const plaque = document.createElement('canvas')
      plaque.width = 128
      plaque.height = 40
      const ctx = plaque.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#dadbd9'
        ctx.fillRect(0, 0, 128, 40)
        ctx.fillStyle = '#303332'
        ctx.textAlign = 'center'
        ctx.font = 'bold 33px sans-serif'
        ctx.fillText(p.id, 64, 32, 122)
        const label = new THREE.CanvasTexture(plaque)
        label.colorSpace = THREE.SRGBColorSpace
        const badge = new THREE.Mesh(
          new THREE.PlaneGeometry(0.034, 0.009),
          new THREE.MeshBasicMaterial({ map: label, toneMapped: false }),
        )
        badge.rotation.x = -Math.PI / 2
        badge.position.set(0, 0.0202, (p.width - rim) / 2)
        group.add(badge)
      }
      group.name = p.id
      return group
    }),
  )
  root.add(...models)
  return root
}
