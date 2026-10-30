import * as THREE from 'three'

/** 通高边界墙的展示材质，白模和材质视图一致，不用于矮柜、柱子或隔板。 */
export const BOUNDARY_WALL_LOOK = { color: '#8f8f8f', opacity: 0.24 } as const

export function boundaryWallMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    ...BOUNDARY_WALL_LOOK,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    roughness: 0.9,
    metalness: 0,
  })
}
