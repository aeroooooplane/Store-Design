import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { WHITE, isDrawable } from './scene-geometry.ts'

/**
 * Below this opacity a surface reads as glass and stays see-through; above it (frosted acrylic,
 * light boxes) it is drawn as a solid white panel, so the shadowed inside of a counter does not
 * show through as dark grey.
 */
const GLASS_OPACITY = 0.4

/**
 * White-model materials, shared by every model. Double-sided because SketchUp exports often
 * contain reversed faces, and flat shaded because their normals often point against the face
 * winding (tops lit as if facing down); flat shading derives normals from the geometry.
 */
const SOLID = new THREE.MeshStandardMaterial({
  color: WHITE,
  roughness: 1,
  metalness: 0,
  side: THREE.DoubleSide,
  flatShading: true,
})
const GLASS = new THREE.MeshStandardMaterial({
  color: WHITE,
  roughness: 0.2,
  metalness: 0,
  side: THREE.DoubleSide,
  flatShading: true,
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
})
const cutouts = new WeakMap<THREE.Material, THREE.Material>()

type Kind = 'solid' | 'glass' | 'cutout'

function kindOf(source: THREE.Material): Kind {
  const original = source as THREE.MeshStandardMaterial
  if (original.alphaMap || (original.map && (source.transparent || source.alphaTest > 0))) {
    return 'cutout'
  }
  return source.transparent && source.opacity < GLASS_OPACITY ? 'glass' : 'solid'
}

/**
 * Perforated or cut-out parts keep their texture alpha; the colour is forced to white in the
 * shader, as in the legacy viewer.
 */
function cutoutMaterial(source: THREE.Material): THREE.Material {
  let material = cutouts.get(source)
  if (!material) {
    const original = source as THREE.MeshStandardMaterial
    const white = SOLID.clone()
    white.map = original.map
    white.alphaMap = original.alphaMap
    white.transparent = source.transparent
    white.opacity = source.opacity
    white.alphaTest = source.alphaTest
    white.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        ['#include <map_fragment>', 'diffuseColor.rgb = vec3(1.0);'].join('\n'),
      )
    }
    white.customProgramCacheKey = () => 'white-cutout'
    cutouts.set(source, white)
    material = white
  }
  return material
}

/** One geometry from many parts, transforms baked in; flat shading needs positions only. */
function mergeParts(parts: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]) {
  let vertices = 0
  let indices = 0
  for (const { geometry } of parts) {
    const count = geometry.getAttribute('position').count
    vertices += count
    indices += geometry.index?.count ?? count
  }
  const positions = new Float32Array(vertices * 3)
  const index = new Uint32Array(indices)
  const v = new THREE.Vector3()
  let base = 0
  let at = 0
  for (const { geometry, matrix } of parts) {
    const position = geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(matrix)
      positions.set([v.x, v.y, v.z], (base + i) * 3)
    }
    const source = geometry.index
    const count = source?.count ?? position.count
    for (let i = 0; i < count; i++) index[at + i] = base + (source ? source.getX(i) : i)
    base += position.count
    at += count
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setIndex(new THREE.BufferAttribute(index, 1))
  merged.computeBoundingSphere()
  merged.computeBoundingBox()
  return merged
}

/**
 * The white version of a model: all solid parts in one mesh and all glass in another, so a
 * prop costs one or two draw calls instead of hundreds. Cut-out parts stay separate.
 */
export function buildWhite(gltf: GLTF): THREE.Object3D {
  const root = gltf.scene
  root.updateMatrixWorld(true)
  const parts: Record<
    'solid' | 'glass',
    { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]
  > = { solid: [], glass: [] }
  const model = new THREE.Group()
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !isDrawable(node)) return
    const source = Array.isArray(node.material) ? node.material[0] : node.material
    if (!source) return
    const kind = kindOf(source)
    if (kind !== 'cutout') {
      parts[kind].push({ geometry: node.geometry, matrix: node.matrixWorld })
      return
    }
    const mesh = new THREE.Mesh(node.geometry, cutoutMaterial(source))
    mesh.applyMatrix4(node.matrixWorld)
    mesh.castShadow = true
    mesh.receiveShadow = true
    model.add(mesh)
  })
  for (const kind of ['solid', 'glass'] as const) {
    if (!parts[kind].length) continue
    const mesh = new THREE.Mesh(mergeParts(parts[kind]), kind === 'solid' ? SOLID : GLASS)
    mesh.castShadow = kind === 'solid'
    mesh.receiveShadow = true
    model.add(mesh)
  }
  return model
}
