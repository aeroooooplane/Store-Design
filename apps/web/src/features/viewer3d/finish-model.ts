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
  let preserveAppearance = true
  root.traverse((node) => {
    if (!isDrawable(node)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    const finished = materials.map((source) => {
      const preserved = source.userData['storeDesignPreserveAppearance'] === true
      preserveAppearance &&= preserved
      let material = finishedMaterials.get(source)
      if (!material) {
        // Reviewed AI/PBR assets keep their original normals, sidedness and finish values.
        // Textures and geometry remain shared by every placement; the scene owns this clone.
        material = preserved ? source.clone() : finishMaterial(source, environment)
        if (material !== source) finishedMaterials.set(source, material)
      }
      return material
    })
    node.material = Array.isArray(node.material) ? finished : (finished[0] ?? node.material)
    node.castShadow = true
    node.receiveShadow = true
  })
  // Only unprepared SketchUp sources need the back-layer scan; reviewed PBR stays intact.
  if (!prepared && !preserveAppearance) separateBackLayers(root, frontSided)
  return root
}
