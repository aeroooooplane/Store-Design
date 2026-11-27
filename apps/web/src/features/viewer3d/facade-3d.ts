import * as THREE from 'three'
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'
import {
  distance,
  facadeOuterDepth,
  facadePoint,
  facadeWordmark,
  locatePoint,
  polygonArea,
  reviewFacadeConfig,
} from '@store/shared'
import type { FacadeSection, Market, Point, SiStyle, Space } from '@store/shared'
import { facadeColors, sectionPieces } from '../facade/appearance.ts'
import { prism } from './scene-geometry.ts'

function outsideFace(section: FacadeSection) {
  return Math.max(facadeOuterDepth(), section.screens.length ? section.screenInset + 0.09 : 0)
}

function panelMaterial(siStyle: SiStyle) {
  return new THREE.MeshStandardMaterial({
    color: facadeColors(siStyle).panel,
    roughness: 0.63,
    metalness: siStyle === 'SI1.0' ? 0.32 : 0.12,
  })
}

function buildSection(section: FacadeSection, siStyle: SiStyle, market: Market, outside: boolean) {
  const root = new THREE.Group()
  const { frame } = section
  root.position.set(frame.origin[0], 0, frame.origin[1])
  root.rotation.y = Math.atan2(-frame.direction[1], frame.direction[0])
  const colors = facadeColors(siStyle)
  const offset = outside ? outsideFace(section) : 0
  for (const p of sectionPieces(section)) {
    const material =
      p.finish === 'screen' || p.finish === 'light'
        ? new THREE.MeshBasicMaterial({ color: colors[p.finish] })
        : new THREE.MeshStandardMaterial({
            color: colors[p.finish],
            roughness: p.finish === 'trim' ? 0.45 : 0.63,
            metalness: p.finish === 'trim' || siStyle === 'SI1.0' ? 0.32 : 0.12,
          })
    const face = offset + p.front + (outside ? 0 : 0.002)
    const back = outside && p.finish !== 'light' ? 0 : face - p.depth
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, face - back), material)
    mesh.position.set(p.x + p.w / 2, p.y + p.h / 2, (face + back) / 2)
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
    logo.position.set(spec.center - width / 2, spec.top, offset + 0.008)
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

/** Two sections that meet at a rounded or sharp exterior corner need a solid fascia return. */
function addCornerReturns(
  root: THREE.Group,
  sections: FacadeSection[],
  boundary: Space['boundary'],
  si: SiStyle,
) {
  const ends = (section: FacadeSection) => [
    section.frame.origin,
    facadePoint(section.frame, section.frame.width),
  ]
  for (const [i, a] of sections.entries()) {
    for (const b of sections.slice(i + 1)) {
      const join = ends(a).find((point) => ends(b).some((end) => distance(point, end) <= 0.003))
      if (!join) continue
      const bottom = Math.max(a.fasciaBottom, b.fasciaBottom)
      const top = Math.min(a.fasciaBottom + a.fasciaHeight, b.fasciaBottom + b.fasciaHeight)
      if (top - bottom < 0.001) continue
      const face = (section: FacadeSection): Point => {
        const depth = outsideFace(section)
        return [
          join[0] + section.frame.outward[0] * depth,
          join[1] + section.frame.outward[1] * depth,
        ]
      }
      const p = face(a)
      const q = face(b)
      const wedge = [join, p, q]
      const centre: Point = [(join[0] + p[0] + q[0]) / 3, (join[1] + p[1] + q[1]) / 3]
      if (polygonArea(wedge) < 1e-5 || locatePoint(centre, boundary) !== 'outside') continue
      const mesh = new THREE.Mesh(prism(wedge, bottom, top - bottom), panelMaterial(si))
      mesh.userData['facadeFinish'] = 'panel'
      root.add(mesh)
    }
  }
}

export function buildFacade3d(space: Space, siStyle: SiStyle, market: Market): THREE.Group | null {
  const config = space.facade
  const result = config && reviewFacadeConfig(space, config, siStyle, market)
  if (!config || !result) return null
  const outside = !('kind' in config) || config.kind !== 'island_hanging'
  const root = new THREE.Group()
  root.add(...result.sections.map((section) => buildSection(section, siStyle, market, outside)))
  if ('kind' in config && config.kind === 'corner')
    addCornerReturns(root, result.sections, space.boundary, siStyle)
  return root
}
