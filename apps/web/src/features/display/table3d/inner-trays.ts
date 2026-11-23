import * as THREE from 'three'
import type { TableShape } from './layout.ts'

type Strip = NonNullable<TableShape['strip']>
export type InnerVersion = 'legacy' | '2026'

/** The guide's A, D and C inserts occupy one, two and four length units. */
export function innerPlaces(ids: string[], strip: Strip, end: 'left' | 'right') {
  const horizontal = strip.w > strip.d
  const length = Math.max(strip.w, strip.d)
  const width = Math.min(strip.w, strip.d)
  const weights = ids.map((id) => (/^C\d+$/.test(id) ? 4 : /^D\d+$/.test(id) ? 2 : 1))
  const sum = weights.reduce((a, b) => a + b, 0)
  let cursor = -length / 2
  return ids.map((id, i) => {
    const span = (length * weights[i]!) / sum
    const center = cursor + span / 2
    cursor += span
    // Order runs from the far end towards E, including mirrored landscape tables.
    const direction = horizontal && end === 'left' ? -1 : 1
    return {
      id,
      span,
      width,
      x: strip.x + (horizontal ? direction * center : 0),
      z: strip.z + (horizontal ? 0 : center),
      angle: horizontal ? (direction === 1 ? 0 : Math.PI) : -Math.PI / 2,
    }
  })
}

/** A local +x run of tray frames; pictures and labels stay attached to the tray as the view turns. */
export async function buildInnerTrays(
  ids: string[],
  strip: Strip,
  height: number,
  end: 'left' | 'right',
  version: InnerVersion,
  image: (url: string) => Promise<HTMLImageElement | null>,
) {
  const root = new THREE.Group()
  const border = Math.min(0.003, strip.w / 16, strip.d / 16)
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(strip.w, 0.006, strip.d),
    new THREE.MeshStandardMaterial({ color: 0x6c7379, metalness: 0.5, roughness: 0.45 }),
  )
  frame.position.set(strip.x, height + 0.003, strip.z)
  root.add(frame)
  const interior = { ...strip, w: strip.w - 2 * border, d: strip.d - 2 * border }
  const models = await Promise.all(
    innerPlaces(ids, interior, end).map(async ({ id, span, width, x, z, angle }) => {
      const group = new THREE.Group()
      group.position.set(x, height + 0.006, z)
      group.rotation.y = angle
      const rim = Math.min(0.004, span * 0.08, width * 0.08)
      const metal = new THREE.MeshStandardMaterial({
        color: 0xb2b5b8,
        metalness: 0.46,
        roughness: 0.38,
      })
      function edge(w: number, d: number, px: number, pz: number) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.008, d), metal)
        rail.position.set(px, 0.004, pz)
        group.add(rail)
      }
      edge(span, rim, 0, (width - rim) / 2)
      edge(span, rim, 0, -(width - rim) / 2)
      edge(rim, width - 2 * rim, (span - rim) / 2, 0)
      edge(rim, width - 2 * rim, -(span - rim) / 2, 0)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(64, Math.min(1024, Math.round((200 * span) / width)))
      canvas.height = 200
      const ctx = canvas.getContext('2d')
      const pic = /^[ACD]\d{1,2}$/.test(id)
        ? await image('/api/v1/display-inner-trays/' + version + '/' + id)
        : null
      if (ctx) {
        ctx.fillStyle = '#c9cdd0'
        ctx.fillRect(0, 0, canvas.width, 200)
        if (pic) ctx.drawImage(pic, 0, 0, canvas.width, 153)
        ctx.fillStyle = '#282d31'
        ctx.fillRect(0, 153, canvas.width, 47)
        ctx.fillStyle = 'white'
        ctx.font = 'bold 43px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(id, canvas.width / 2, 188, canvas.width - 5)
      }
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(span - 2 * rim, width - 2 * rim),
        new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
      )
      floor.rotation.x = -Math.PI / 2
      floor.position.y = 0.001
      group.add(floor)
      return group
    }),
  )
  root.add(...models)
  return root
}
