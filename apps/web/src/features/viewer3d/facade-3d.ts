import * as THREE from 'three'
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'
import { facadeWordmark, reviewFacadeConfig } from '@store/shared'
import type { FacadeSection, Market, SiStyle, Space } from '@store/shared'
import { facadeColors, sectionPieces } from '../facade/appearance.ts'

function buildSection(section: FacadeSection, siStyle: SiStyle, market: Market) {
  const root = new THREE.Group()
  const { frame } = section
  root.position.set(frame.origin[0], 0, frame.origin[1])
  root.rotation.y = Math.atan2(-frame.direction[1], frame.direction[0])
  const colors = facadeColors(siStyle)
  for (const p of sectionPieces(section)) {
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
  if (section.logos.length === 0) return root

  const art = facadeWordmark(market)
  const markup = art.paths
    .map(
      (shape) =>
        '<path d="' + shape.d + '" fill-rule="' + (shape.evenOdd ? 'evenodd' : 'nonzero') + '"/>',
    )
    .join('')
  const source = new SVGLoader().parse(
    '<svg xmlns="http://www.w3.org/2000/svg">' + markup + '</svg>',
  )
  const shapes = source.paths.flatMap((p) => p.toShapes())
  for (const spec of section.logos) {
    const scale = spec.height / art.height
    const body = new THREE.ExtrudeGeometry(shapes, {
      depth: 0.025 / scale,
      bevelEnabled: false,
      curveSegments: 8,
    })
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
    const width = art.width * scale
    logo.position.set(spec.center - width / 2, spec.top, 0.008)
    logo.rotation.x = spec.tilt ?? 0
    logo.userData['facadeFinish'] = 'logo'
    root.add(logo)
    if (section.beamOnly) {
      const drop = section.fasciaBottom - spec.top
      if (drop > 0.001) {
        for (const at of [0.26, 0.74]) {
          const pin = new THREE.Mesh(
            new THREE.CylinderGeometry(0.006, 0.006, drop, 8),
            new THREE.MeshStandardMaterial({ color: colors.trim, metalness: 0.4 }),
          )
          pin.position.set(spec.center + width * (at - 0.5), spec.top + drop / 2, 0.017)
          root.add(pin)
        }
      }
    }
  }
  return root
}

export function buildFacade3d(space: Space, siStyle: SiStyle, market: Market): THREE.Group | null {
  const result = space.facade && reviewFacadeConfig(space, space.facade, siStyle, market)
  if (!result) return null
  const root = new THREE.Group()
  root.add(...result.sections.map((section) => buildSection(section, siStyle, market)))
  return root
}
