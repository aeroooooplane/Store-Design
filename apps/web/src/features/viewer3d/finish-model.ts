import type * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { separateBackLayers } from './back-layers.ts'
import { finishMaterial } from './render-look.ts'
import { isDrawable } from './scene-geometry.ts'

/**
 * The textured copy of a model for the material look. `finishedMaterials` holds the adjusted
 * finishes per source material (owned by the scene, because metals use its environment);
 * `frontSided` gives the front-side-only copy of a finished material.
 */
export function finishModel(
  gltf: GLTF,
  prepared: boolean,
  environment: THREE.Texture | null,
  finishedMaterials: Map<THREE.Material, THREE.Material>,
  frontSided: (material: THREE.Material) => THREE.Material,
): THREE.Object3D {
  const root = gltf.scene.clone(true)
  root.traverse((node) => {
    if (!isDrawable(node)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    const finished = materials.map((source) => {
      let material = finishedMaterials.get(source)
      if (!material) {
        material = finishMaterial(source, environment)
        if (material !== source) finishedMaterials.set(source, material)
      }
      return material
    })
    node.material = Array.isArray(node.material) ? finished : (finished[0] ?? node.material)
    node.castShadow = true
    node.receiveShadow = true
  })
  // A full model is searched for the two sides of its faces; the light copy has them marked.
  if (!prepared) separateBackLayers(root, frontSided)
  return root
}
