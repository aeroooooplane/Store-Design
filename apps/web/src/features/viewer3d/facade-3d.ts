import * as THREE from 'three'
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'
import { facadeWordmark, reviewFacade } from '@store/shared'
import type { Market, SiStyle, Space } from '@store/shared'
import { facadeColors, facadePieces } from '../facade/appearance.ts'

export function buildFacade3d(space: Space, siStyle: SiStyle, market: Market): THREE.Group | null {
  const facade = space.facade
  if (!facade) return null
  const reviewed = reviewFacade(space, facade, siStyle, market)
  if (!reviewed) return null

  const root = new THREE.Group()
  const { frame } = reviewed
  root.position.set(frame.origin[0], 0, frame.origin[1])
  root.rotation.y = Math.atan2(-frame.direction[1], frame.direction[0])
  const colors = facadeColors(siStyle)
  for (const p of facadePieces(facade, reviewed)) {
    const material =
      p.finish === 'screen' || p.finish === 'light'
        ? new THREE.MeshBasicMaterial({ color: colors[p.finish] })
        : new THREE.MeshStandardMaterial({
            color: colors[p.finish],
            roughness: p.finish === 'trim' ? 0.45 : 0.63,
            metalness: p.finish === 'trim' || siStyle === 'SI1.0' ? 0.32 : 0.12,
          })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.depth), material)
    mesh.position.set(p.x + p.w / 2, p.y + p.h / 2, p.front - p.depth / 2 + 0.002)
    mesh.receiveShadow = true
    mesh.userData['facadeFinish'] = p.finish
    root.add(mesh)
  }

  const art = facadeWordmark(market)
  const markup = art.paths
    .map((shape) => `<path d="${shape.d}" fill-rule="${shape.evenOdd ? 'evenodd' : 'nonzero'}"/>`)
    .join('')
  const source = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`)
  const shapes = source.paths.flatMap((p) => p.toShapes())
  const scale = reviewed.logoHeight / art.height
  const body = new THREE.ExtrudeGeometry(shapes, {
    depth: 0.025 / scale,
    bevelEnabled: false,
    curveSegments: 8,
  })
  // SVG y increases down the flat artwork. Set its top at the letter's installed elevation.
  body.scale(scale, -scale, scale)
  const face = new THREE.MeshStandardMaterial({
    color: '#fffdfa',
    emissive: '#fff9ed',
    emissiveIntensity: 0.58,
    side: THREE.DoubleSide,
  })
  const sides = new THREE.MeshStandardMaterial({
    color: '#a0a2a5',
    roughness: 0.6,
    side: THREE.DoubleSide,
  })
  const logo = new THREE.Mesh(body, [face, sides])
  logo.position.set(
    (frame.width - reviewed.logoWidth) / 2,
    facade.clearHeight + reviewed.logoOffset + reviewed.logoHeight,
    0.008,
  )
  logo.userData['facadeFinish'] = 'logo'
  root.add(logo)
  return root
}
