import * as THREE from 'three'
import type { ShopType, SiStyle } from '@store/shared'

/**
 * The material look of browser renders, after the Blender scene of the store-layout-render
 * skill (build_xian_v2.py). White-model and material images share scene, camera and
 * visibility; only materials change. Every value lives here so the look is tuned in one place.
 */
export const RENDER_LOOK = {
  floor: {
    /** SI1.0 灰色地面. `shade`: each tile varies by up to this fraction of its brightness. */
    'SI1.0': { tile: '#919598', shade: 0.025, joint: '#73777a', roughness: 0.55 },
    /** SI2.0 黑色地面 (only the colour is specified so far). */
    'SI2.0': { tile: '#3a3c3f', shade: 0.04, joint: '#232426', roughness: 0.5 },
  },
  /** 中岛店: grey floor whatever the SI style, with continuous stainless edging. */
  islandFloor: 'SI1.0',
  /** Stack-bond floor tiles (metres); the joint is drawn wider than real so it stays visible. */
  tile: { width: 0.6, depth: 0.3, joint: 0.005 },
  wall: { color: '#babdbf', roughness: 0.6 },
  edging: { color: '#b1b6ba', metalness: 0.65, roughness: 0.34, width: 0.04, height: 0.02 },
  /** Props keep their own colours and textures; material names adjust the finish. */
  props: {
    roughness: 0.7,
    glass: { pattern: /玻璃|translucent glass|磨砂亚克力/i, opacity: 0.35, roughness: 0.25 },
    metal: { pattern: /不锈钢|金属|银色桌腿|steel|alumin/i, metalness: 0.65, roughness: 0.34 },
    lacquer: { pattern: /烤漆|桌面材质|人造石/, roughness: 0.4 },
    screen: { pattern: /画面|屏幕/, emissive: 0.55 },
    glow: { pattern: /发光|emissive/i, emissive: 1 },
  },
} as const satisfies {
  floor: Record<SiStyle, { tile: string; shade: number; joint: string; roughness: number }>
  islandFloor: SiStyle
  [key: string]: unknown
}

export type RoomSurface = 'floor' | 'wall' | 'edging'

/** Which floor a shop gets: island shops are always grey. */
export function floorStyle(siStyle: SiStyle, shopType: ShopType): SiStyle {
  return shopType === 'island' ? RENDER_LOOK.islandFloor : siStyle
}

const TILES_PER_SIDE = 4

/**
 * A 4 × 4 patch of tiles with joints, each tile a faint shade lighter or darker (fixed
 * sequence, so every render is the same), repeated over the floor. Floor UVs are plan metres,
 * so the repeat sets the real tile size. Null where there is no 2D canvas (tests).
 */
function tileTexture(siStyle: SiStyle): THREE.Texture | null {
  const { tile, shade, joint } = RENDER_LOOK.floor[siStyle]
  const { width, depth, joint: jointM } = RENDER_LOOK.tile
  const px = 256 / width
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(TILES_PER_SIDE * width * px)
  canvas.height = Math.round(TILES_PER_SIDE * depth * px)
  const g = canvas.getContext('2d')
  if (!g) return null
  g.fillStyle = joint
  g.fillRect(0, 0, canvas.width, canvas.height)
  const gap = Math.max(1, jointM * px)
  const base = new THREE.Color(tile)
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  for (let row = 0; row < TILES_PER_SIDE; row++) {
    for (let col = 0; col < TILES_PER_SIDE; col++) {
      const color = base.clone().multiplyScalar(1 + (random() * 2 - 1) * shade)
      g.fillStyle = `#${color.getHexString()}`
      g.fillRect(
        col * width * px + gap / 2,
        row * depth * px + gap / 2,
        width * px - gap,
        depth * px - gap,
      )
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1 / (TILES_PER_SIDE * width), 1 / (TILES_PER_SIDE * depth))
  texture.anisotropy = 8
  return texture
}

/** Room materials of the material look, made once per scene and style. */
export function roomMaterials(siStyle: SiStyle): Record<RoomSurface, THREE.MeshStandardMaterial> {
  const floor = RENDER_LOOK.floor[siStyle]
  const map = tileTexture(siStyle)
  return {
    floor: new THREE.MeshStandardMaterial({
      color: map ? '#ffffff' : floor.tile,
      map,
      roughness: floor.roughness,
      metalness: 0,
    }),
    wall: new THREE.MeshStandardMaterial({
      color: RENDER_LOOK.wall.color,
      roughness: RENDER_LOOK.wall.roughness,
      metalness: 0,
    }),
    edging: new THREE.MeshStandardMaterial({
      color: RENDER_LOOK.edging.color,
      roughness: RENDER_LOOK.edging.roughness,
      metalness: RENDER_LOOK.edging.metalness,
    }),
  }
}

export function disposeRoomMaterials(materials: Record<RoomSurface, THREE.MeshStandardMaterial>) {
  for (const material of Object.values(materials)) {
    material.map?.dispose()
    material.dispose()
  }
}

/**
 * A prop material with its finish adjusted by name (the skill's name pass). Double-sided and
 * flat shaded for the same SketchUp export problems as the white model. Metals reflect the
 * room environment, which is passed in because each scene has its own.
 */
export function finishMaterial(source: THREE.Material, environment: THREE.Texture | null) {
  if (!(source instanceof THREE.MeshStandardMaterial)) return source
  const { props } = RENDER_LOOK
  const material = source.clone()
  const name = source.name
  material.side = THREE.DoubleSide
  material.flatShading = true
  material.roughness = props.roughness
  if (props.glass.pattern.test(name)) {
    material.transparent = true
    material.opacity = Math.min(material.opacity, props.glass.opacity)
    material.roughness = props.glass.roughness
    material.depthWrite = false
  } else if (props.metal.pattern.test(name)) {
    material.metalness = props.metal.metalness
    material.roughness = props.metal.roughness
    material.envMap = environment
  } else if (props.lacquer.pattern.test(name)) {
    material.roughness = props.lacquer.roughness
  }
  const glow = props.glow.pattern.test(name)
    ? props.glow.emissive
    : props.screen.pattern.test(name)
      ? props.screen.emissive
      : 0
  if (glow > 0) {
    material.emissive = material.map ? new THREE.Color('#ffffff') : material.color.clone()
    material.emissiveMap = material.map
    material.emissiveIntensity = glow
  }
  return material
}
