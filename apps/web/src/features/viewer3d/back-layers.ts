import * as THREE from 'three'

/** Positions are matched on a 1 mm grid. */
const GRID = 1000
/** Normals this close to opposite count as the two sides of one face. */
const OPPOSITE = -0.9

/** Which triangles of a geometry are one side of a two-sided face, found once per geometry. */
type Split = { kind: 'none' } | { kind: 'all' } | { kind: 'mixed' }
const splits = new WeakMap<THREE.BufferGeometry, Split>()

type MeshLike = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>

interface Triangle {
  mesh: number
  index: number
  normal: THREE.Vector3
}

function vertexIndex(geometry: THREE.BufferGeometry, corner: number): number {
  return geometry.index ? geometry.index.getX(corner) : corner
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3
}

/**
 * SketchUp faces have a front and a back material, and its glTF export writes them as two
 * coincident triangles facing opposite ways. Props are drawn double-sided (SketchUp leaves some
 * faces reversed), so the inner layer shows through the outer one: an island table's dark edge
 * band looks like the white top it is painted with on the inside. Triangles that have such a
 * partner are drawn front-side only (`frontSided` gives that variant of a material); every
 * other triangle stays double-sided. Returns how many triangles were paired.
 */
export function separateBackLayers(
  root: THREE.Object3D,
  frontSided: (material: THREE.Material) => THREE.Material,
): number {
  root.updateMatrixWorld(true)
  const meshes: MeshLike[] = []
  root.traverse((node) => {
    if (node instanceof THREE.Mesh && !Array.isArray(node.material)) meshes.push(node as MeshLike)
  })

  // Geometry already split (another instance or an earlier scene): only the materials change.
  const fresh = meshes.filter((mesh) => !splits.has(mesh.geometry))
  const paired = new Map<THREE.BufferGeometry, Set<number>>()
  if (fresh.length) {
    const faces = new Map<string, Triangle[]>()
    const corner = new THREE.Vector3()
    const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
    const key = (v: THREE.Vector3) =>
      `${Math.round(v.x * GRID)},${Math.round(v.y * GRID)},${Math.round(v.z * GRID)}`
    fresh.forEach((mesh, m) => {
      const geometry = mesh.geometry
      const position = geometry.getAttribute('position')
      for (let t = 0; t < triangleCount(geometry); t++) {
        corners.forEach((target, k) => {
          corner.fromBufferAttribute(position, vertexIndex(geometry, t * 3 + k))
          target.copy(corner).applyMatrix4(mesh.matrixWorld)
        })
        const [a, b, c] = corners as [THREE.Vector3, THREE.Vector3, THREE.Vector3]
        const normal = new THREE.Vector3()
          .subVectors(b, a)
          .cross(new THREE.Vector3().subVectors(c, a))
        if (normal.lengthSq() < 1e-14) continue
        normal.normalize()
        const id = [key(a), key(b), key(c)].sort().join('|')
        const list = faces.get(id)
        const triangle = { mesh: m, index: t, normal }
        if (list) list.push(triangle)
        else faces.set(id, [triangle])
      }
    })
    const mark = (triangle: Triangle) => {
      const geometry = fresh[triangle.mesh]?.geometry
      if (!geometry) return
      const set = paired.get(geometry) ?? new Set<number>()
      set.add(triangle.index)
      paired.set(geometry, set)
    }
    for (const list of faces.values()) {
      if (list.length < 2) continue
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const first = list[i]
          const second = list[j]
          if (first && second && first.normal.dot(second.normal) < OPPOSITE) {
            mark(first)
            mark(second)
          }
        }
      }
    }
  }

  let count = 0
  for (const mesh of meshes) {
    const geometry = mesh.geometry
    let split = splits.get(geometry)
    if (!split) {
      const set = paired.get(geometry)
      const total = triangleCount(geometry)
      split = !set?.size
        ? { kind: 'none' }
        : set.size === total
          ? { kind: 'all' }
          : { kind: 'mixed' }
      if (set && split.kind === 'mixed') reorder(geometry, set)
      splits.set(geometry, split)
      count += set?.size ?? 0
    }
    const material = mesh.material as THREE.Material
    if (split.kind === 'all') mesh.material = frontSided(material)
    else if (split.kind === 'mixed') mesh.material = [material, frontSided(material)]
  }
  return count
}

/** Unpaired triangles first (group 0, double-sided), paired ones after (group 1, front only). */
function reorder(geometry: THREE.BufferGeometry, paired: Set<number>) {
  const total = triangleCount(geometry)
  const vertices = geometry.getAttribute('position').count
  const index = vertices > 65535 ? new Uint32Array(total * 3) : new Uint16Array(total * 3)
  let at = 0
  const copy = (t: number) => {
    for (let k = 0; k < 3; k++) index[at++] = vertexIndex(geometry, t * 3 + k)
  }
  for (let t = 0; t < total; t++) if (!paired.has(t)) copy(t)
  const unpaired = at
  for (let t = 0; t < total; t++) if (paired.has(t)) copy(t)
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  geometry.clearGroups()
  geometry.addGroup(0, unpaired, 0)
  geometry.addGroup(unpaired, total * 3 - unpaired, 1)
}
