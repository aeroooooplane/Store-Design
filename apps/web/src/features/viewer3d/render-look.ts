import * as THREE from 'three'
import { mainEntrance } from '@store/shared'
import type { ShopType, SiStyle, Space } from '@store/shared'

type FloorKind = SiStyle | 'island'

interface FloorSpec {
  /** Tile size in metres: long side, short side. */
  tile: readonly [number, number]
  color: string
  /** Each tile varies by up to this fraction of its brightness. */
  shade: number
  joint: string
  /** Drawn joint width (wider than the real 2 mm so it stays visible in a whole-shop view). */
  jointM: number
  /** Stack bond, or every other row shifted by half a tile (click floors). */
  bond: 'stack' | 'running'
  /** Terrazzo chips. */
  chips: boolean
  roughness: number
}

/**
 * The material look of browser renders, per the 店铺形象设计标准 manuals (资源库/05_店铺形象设计标准;
 * page numbers are PDF pages). The manuals give materials and sizes, not colour codes: the hex
 * values are measured from their swatch photos. White-model and material images share scene,
 * camera and visibility; only materials change. Every value lives here so the look is tuned in
 * one place.
 */
export const RENDER_LOOK = {
  floors: {
    /** SI1.0 p.113/144: 800×800 soft-matte light-grey tile (东鹏 803302), 2 mm light-grey joints. */
    'SI1.0': {
      tile: [0.8, 0.8],
      color: '#bfbbb8',
      shade: 0.02,
      joint: '#a6a29f',
      jointM: 0.004,
      bond: 'stack',
      chips: false,
      roughness: 0.45,
    },
    /** SI2.0 p.26/141: 1200×600 off-white imitation terrazzo, the 1200 side along the entrance. */
    'SI2.0': {
      tile: [1.2, 0.6],
      color: '#e6e6e3',
      shade: 0.012,
      joint: '#cbcbc7',
      jointM: 0.004,
      bond: 'stack',
      chips: true,
      roughness: 0.4,
    },
    /** 中岛店 SI1.0 p.114/145, SI2.0 p.27/142: 600×300 light-grey click floor, half-offset rows. */
    island: {
      tile: [0.6, 0.3],
      color: '#c8c6c3',
      shade: 0.025,
      joint: '#adaba8',
      jointM: 0.003,
      bond: 'running',
      chips: false,
      roughness: 0.5,
    },
  },
  walls: {
    /** SI1.0 p.113/137: white micro-cement (万磊 WSZ-6201). */
    'SI1.0': { color: '#e4dfd3', roughness: 0.85, metalness: 0 },
    /** SI2.0 p.39–42: 星空灰 aluminium composite panels. */
    'SI2.0': { color: '#48443f', roughness: 0.55, metalness: 0.2 },
  },
  /** 中岛店 edge: 80 mm matte silver-grey stainless (SI2.0 raises the floor 30 mm). */
  edging: { color: '#b3b3b3', metalness: 0.6, roughness: 0.45, width: 0.08, height: 0.03 },
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
  floors: Record<FloorKind, FloorSpec>
  walls: Record<SiStyle, { color: string; roughness: number; metalness: number }>
  [key: string]: unknown
}

export type RoomSurface = 'floor' | 'wall' | 'edging'

/** Island shops have their own floor whatever the SI style. */
export function floorKind(siStyle: SiStyle, shopType: ShopType): FloorKind {
  return shopType === 'island' ? 'island' : siStyle
}

/** How the tiles are laid: long side along plan x or z, and the point a tile is centred on. */
export interface FloorLayout {
  alongX: boolean
  origin: readonly [number, number]
}

/**
 * Side-hall floors are laid from the centre of the main entrance with the long side along it;
 * island floors run along the shop's long side from its centre (manual pages above).
 */
export function floorLayout(space: Space, shopType: ShopType): FloorLayout {
  const xs = space.boundary.map((p) => p[0])
  const zs = space.boundary.map((p) => p[1])
  const [minX, maxX, minZ, maxZ] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...zs),
    Math.max(...zs),
  ]
  const centre: [number, number] = [(minX + maxX) / 2, (minZ + maxZ) / 2]
  const entrance = mainEntrance(space)
  if (shopType === 'island' || !entrance) {
    return { alongX: maxX - minX >= maxZ - minZ, origin: centre }
  }
  const dx = Math.abs(entrance.b[0] - entrance.a[0])
  const dz = Math.abs(entrance.b[1] - entrance.a[1])
  return {
    alongX: dx >= dz,
    origin: [(entrance.a[0] + entrance.b[0]) / 2, (entrance.a[1] + entrance.b[1]) / 2],
  }
}

const TILES_PER_SIDE = 4

/**
 * A 4 × 4 patch of tiles with joints, each tile a faint shade lighter or darker (fixed sequence,
 * so every render is the same), repeated over the floor. Floor UVs are plan metres (u = x,
 * v = −z), so the repeat sets the real tile size and the offset centres a tile on the origin.
 * Null where there is no 2D canvas (tests).
 */
function floorTexture(spec: FloorSpec, layout: FloorLayout): THREE.Texture | null {
  const [long, short] = spec.tile
  const tw = layout.alongX ? long : short
  const td = layout.alongX ? short : long
  const px = Math.min(400, 1600 / (TILES_PER_SIDE * long))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(TILES_PER_SIDE * tw * px)
  canvas.height = Math.round(TILES_PER_SIDE * td * px)
  const g = canvas.getContext('2d')
  if (!g) return null
  g.fillStyle = spec.joint
  g.fillRect(0, 0, canvas.width, canvas.height)
  const gap = Math.max(1.2, spec.jointM * px)
  const base = new THREE.Color(spec.color)
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  for (let row = 0; row < TILES_PER_SIDE; row++) {
    // Running bond: odd rows start half a tile in; the tile cut at the edge wraps around.
    const shift = spec.bond === 'running' && row % 2 ? -0.5 : 0
    for (let col = -1; col <= TILES_PER_SIDE; col++) {
      const x = (col + shift) * tw * px
      if (x + tw * px <= 0 || x >= canvas.width) continue
      const color = base.clone().multiplyScalar(1 + (random() * 2 - 1) * spec.shade)
      g.fillStyle = `#${color.getHexString()}`
      g.fillRect(x + gap / 2, row * td * px + gap / 2, tw * px - gap, td * px - gap)
    }
  }
  if (spec.chips) {
    // Terrazzo: small grey chips, a few light ones.
    const chips = Math.round(canvas.width * canvas.height * 0.004)
    for (let i = 0; i < chips; i++) {
      const tone = random() < 0.8 ? 150 + random() * 50 : 236 + random() * 14
      g.fillStyle = `rgba(${tone}, ${tone}, ${tone - 3}, ${0.35 + random() * 0.4})`
      g.beginPath()
      g.arc(random() * canvas.width, random() * canvas.height, 0.5 + random() * 1.4, 0, Math.PI * 2)
      g.fill()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1 / (TILES_PER_SIDE * tw), 1 / (TILES_PER_SIDE * td))
  const [ox, oz] = layout.origin
  texture.offset.set((tw / 2 - ox) / (TILES_PER_SIDE * tw), (td / 2 + oz) / (TILES_PER_SIDE * td))
  texture.anisotropy = 8
  return texture
}

/** Room materials of the material look for one shop (the floor depends on its entrance). */
export function roomMaterials(
  siStyle: SiStyle,
  shopType: ShopType,
  space: Space,
): Record<RoomSurface, THREE.MeshStandardMaterial> {
  const floor = RENDER_LOOK.floors[floorKind(siStyle, shopType)]
  const wall = RENDER_LOOK.walls[siStyle]
  const map = floorTexture(floor, floorLayout(space, shopType))
  return {
    floor: new THREE.MeshStandardMaterial({
      color: map ? '#ffffff' : floor.color,
      map,
      roughness: floor.roughness,
      metalness: 0,
    }),
    wall: new THREE.MeshStandardMaterial({
      color: wall.color,
      roughness: wall.roughness,
      metalness: wall.metalness,
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
