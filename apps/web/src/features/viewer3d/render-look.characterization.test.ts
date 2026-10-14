/**
 * Characterization tests: they pin the current behaviour of render-look.ts before refactoring.
 * Values were read from the running code, not from the manuals.
 */
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Space } from '@store/shared'
import {
  RENDER_LOOK,
  disposeRoomMaterials,
  finishMaterial,
  floorKind,
  floorLayout,
  roomMaterials,
} from './render-look.ts'

const shop = (w: number, d: number, entrances: Space['entrances'] = []): Space => ({
  schemaVersion: 1,
  boundary: [
    [0, 0],
    [w, 0],
    [w, d],
    [0, d],
  ],
  height: 3,
  entrances,
  openEdges: [],
  obstacles: [],
  calibration: null,
})

/** 8 × 6 m, main entrance on the bottom edge from x = 2 to 8 (midpoint x = 5). */
const sideHall = () => shop(8, 6, [{ a: [8, 6], b: [2, 6], kind: 'main' }])
/** 4 × 10 m, only a side entrance, on the left edge from z = 1 to 9. */
const leftEntrance = () => shop(4, 10, [{ a: [0, 1], b: [0, 9], kind: 'side' }])

/** A 2D context that records what is drawn (jsdom has no canvas). */
function recordingContext() {
  const calls: { op: string; args: unknown[] }[] = []
  const context = new Proxy(
    {},
    {
      get:
        (_target, prop) =>
        (...args: unknown[]) => {
          calls.push({ op: String(prop), args })
        },
      set: (_target, prop, value) => {
        calls.push({ op: `${String(prop)}=`, args: [value] })
        return true
      },
    },
  )
  return { calls, context }
}

const round = (values: readonly number[], digits = 4) =>
  values.map((v) => Math.round(v * 10 ** digits) / 10 ** digits)

describe('RENDER_LOOK', () => {
  it('fixes the floor of each kind: tile size (long, short) in metres, bond and finish', () => {
    expect(RENDER_LOOK.floors).toEqual({
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
    })
  })

  it('fixes walls per SI style and the island edging (80 mm wide, 30 mm high)', () => {
    expect(RENDER_LOOK.walls).toEqual({
      'SI1.0': { color: '#e4dfd3', roughness: 0.85, metalness: 0 },
      'SI2.0': { color: '#48443f', roughness: 0.55, metalness: 0.2 },
    })
    expect(RENDER_LOOK.edging).toEqual({
      color: '#b3b3b3',
      metalness: 0.6,
      roughness: 0.45,
      width: 0.08,
      height: 0.03,
    })
  })
})

describe('floorKind', () => {
  it('gives island shops their own floor whatever the SI style', () => {
    expect(floorKind('SI1.0', 'island')).toBe('island')
    expect(floorKind('SI2.0', 'island')).toBe('island')
  })

  it('uses the SI style for side-hall shops and zones', () => {
    expect(floorKind('SI1.0', 'side_hall')).toBe('SI1.0')
    expect(floorKind('SI2.0', 'side_hall')).toBe('SI2.0')
    expect(floorKind('SI1.0', 'zone')).toBe('SI1.0')
    expect(floorKind('SI2.0', 'zone')).toBe('SI2.0')
  })
})

describe('floorLayout', () => {
  it('lays side-hall floors along the main entrance, from its midpoint (not the shop centre)', () => {
    expect(floorLayout(sideHall(), 'side_hall')).toEqual({ alongX: true, origin: [5, 6] })
  })

  it('turns the tiles when the entrance runs along z', () => {
    expect(floorLayout(leftEntrance(), 'side_hall')).toEqual({ alongX: false, origin: [0, 5] })
  })

  it('treats zones like side halls', () => {
    expect(floorLayout(leftEntrance(), 'zone')).toEqual({ alongX: false, origin: [0, 5] })
  })

  it('prefers the main entrance over an earlier side entrance', () => {
    const space = shop(8, 6, [
      { a: [0, 0], b: [4, 0], kind: 'side' },
      { a: [8, 1], b: [8, 5], kind: 'main' },
    ])
    expect(floorLayout(space, 'side_hall')).toEqual({ alongX: false, origin: [8, 3] })
  })

  it('lays island floors along the longer side from the centre, ignoring entrances', () => {
    expect(floorLayout(sideHall(), 'island')).toEqual({ alongX: true, origin: [4, 3] })
    expect(floorLayout(leftEntrance(), 'island')).toEqual({ alongX: false, origin: [2, 5] })
  })

  it('falls back to the bounding box without entrances; a square runs along x', () => {
    expect(floorLayout(shop(5, 5), 'side_hall')).toEqual({ alongX: true, origin: [2.5, 2.5] })
    expect(floorLayout(shop(3, 7), 'side_hall')).toEqual({ alongX: false, origin: [1.5, 3.5] })
  })

  it('runs along x when a diagonal entrance is as long in x as in z, turned with it', () => {
    const space = shop(6, 6, [{ a: [0, 4], b: [2, 6], kind: 'main' }])
    // Since the irregular-shop work the tiles follow the slant (−45°: from +x towards +z).
    expect(floorLayout(space, 'side_hall')).toEqual({
      alongX: true,
      origin: [1, 5],
      angle: -Math.PI / 4,
    })
  })
})

describe('roomMaterials without a 2D canvas', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('colours the floor plainly and keeps each surface’s finish', () => {
    const si1 = roomMaterials('SI1.0', 'side_hall', sideHall())
    expect(si1.floor.map).toBeNull()
    expect(si1.floor.color.getHexString()).toBe('bfbbb8')
    expect(si1.floor.roughness).toBe(0.45)
    expect(si1.floor.metalness).toBe(0)
    expect(si1.wall.color.getHexString()).toBe('e4dfd3')
    expect([si1.wall.roughness, si1.wall.metalness]).toEqual([0.85, 0])
    expect(si1.edging.color.getHexString()).toBe('b3b3b3')
    expect([si1.edging.roughness, si1.edging.metalness]).toEqual([0.45, 0.6])

    const si2 = roomMaterials('SI2.0', 'side_hall', sideHall())
    expect(si2.floor.color.getHexString()).toBe('e6e6e3')
    expect(si2.floor.roughness).toBe(0.4)
    expect(si2.wall.color.getHexString()).toBe('48443f')
    expect([si2.wall.roughness, si2.wall.metalness]).toEqual([0.55, 0.2])
  })

  it('gives island shops the island floor but the SI style’s walls', () => {
    const island = roomMaterials('SI2.0', 'island', sideHall())
    expect(island.floor.color.getHexString()).toBe('c8c6c3')
    expect(island.floor.roughness).toBe(0.5)
    expect(island.wall.color.getHexString()).toBe('48443f')
  })

  it('disposes every material and its map', () => {
    const materials = roomMaterials('SI1.0', 'side_hall', sideHall())
    const texture = new THREE.Texture()
    materials.floor.map = texture
    const disposed = [
      vi.spyOn(texture, 'dispose'),
      vi.spyOn(materials.floor, 'dispose'),
      vi.spyOn(materials.wall, 'dispose'),
      vi.spyOn(materials.edging, 'dispose'),
    ]
    disposeRoomMaterials(materials)
    for (const spy of disposed) expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('floor texture (drawn on a recording 2D context)', () => {
  let recorder: ReturnType<typeof recordingContext>
  beforeEach(() => {
    recorder = recordingContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      recorder.context as unknown as CanvasRenderingContext2D,
    )
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const texture = (material: THREE.MeshStandardMaterial) => {
    const map = material.map as THREE.CanvasTexture
    return { map, canvas: map.image }
  }
  const tiles = () =>
    recorder.calls
      .filter((c) => c.op === 'fillRect')
      .slice(1)
      .map((c) => round(c.args as number[], 3))

  it('SI1.0: 4 × 4 stacked 800 mm tiles, centred on the entrance midpoint', () => {
    const floor = roomMaterials('SI1.0', 'side_hall', sideHall()).floor
    const { map, canvas } = texture(floor)
    expect(floor.color.getHexString()).toBe('ffffff')
    expect([canvas.width, canvas.height]).toEqual([1280, 1280])
    expect(round(map.repeat.toArray())).toEqual([0.3125, 0.3125])
    // offset = ((tw / 2 − ox) / 4tw, (td / 2 + oz) / 4td) with origin (5, 6).
    expect(round(map.offset.toArray())).toEqual([-1.4375, 2])
    expect([map.wrapS, map.wrapT]).toEqual([THREE.RepeatWrapping, THREE.RepeatWrapping])
    expect(map.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(map.anisotropy).toBe(8)

    // Joint colour fills the canvas first, then 16 tiles inset by half a joint (1.2 px minimum).
    expect(recorder.calls.slice(0, 2)).toEqual([
      { op: 'fillStyle=', args: ['#a6a29f'] },
      { op: 'fillRect', args: [0, 0, 1280, 1280] },
    ])
    expect(tiles()).toHaveLength(16)
    expect(tiles().slice(0, 5)).toEqual([
      [0.8, 0.8, 318.4, 318.4],
      [320.8, 0.8, 318.4, 318.4],
      [640.8, 0.8, 318.4, 318.4],
      [960.8, 0.8, 318.4, 318.4],
      [0.8, 320.8, 318.4, 318.4],
    ])
    // A fixed shade sequence around #bfbbb8, so every render is the same.
    const shades = recorder.calls
      .filter((c) => c.op === 'fillStyle=')
      .slice(1, 6)
      .map((c) => c.args[0])
    expect(shades).toEqual(['#bdb9b6', '#c0bcb9', '#bebab7', '#bebab7', '#c0bcb9'])
    expect(recorder.calls).toHaveLength(34)
  })

  it('SI2.0: 1200 × 600 tiles with the long side along an x entrance, plus terrazzo chips', () => {
    const { map, canvas } = texture(roomMaterials('SI2.0', 'side_hall', sideHall()).floor)
    expect([canvas.width, canvas.height]).toEqual([1600, 800])
    expect(round(map.repeat.toArray())).toEqual([0.2083, 0.4167])
    expect(round(map.offset.toArray())).toEqual([-0.9167, 2.625])
    expect(tiles().slice(0, 16)[0]).toEqual([0.667, 0.667, 398.667, 198.667])
    // round(1600 × 800 × 0.004) chips, each drawn as fillStyle, beginPath, arc, fill.
    const arcs = recorder.calls.filter((c) => c.op === 'arc')
    expect(arcs).toHaveLength(5120)
    expect(recorder.calls).toHaveLength(2 + 16 * 2 + 5120 * 4)
  })

  it('SI2.0: the long side turns with an entrance along z', () => {
    const { map, canvas } = texture(roomMaterials('SI2.0', 'side_hall', leftEntrance()).floor)
    expect([canvas.width, canvas.height]).toEqual([800, 1600])
    expect(round(map.repeat.toArray())).toEqual([0.4167, 0.2083])
    expect(round(map.offset.toArray())).toEqual([0.125, 1.1667])
  })

  it('island: 600 × 300 click floor, odd rows shifted half a tile', () => {
    const { map, canvas } = texture(roomMaterials('SI2.0', 'island', sideHall()).floor)
    expect([canvas.width, canvas.height]).toEqual([960, 480])
    expect(round(map.repeat.toArray())).toEqual([0.4167, 0.8333])
    // Island floors start from the shop centre (4, 3), not the entrance.
    expect(round(map.offset.toArray())).toEqual([-1.5417, 2.625])
    const rows = tiles()
    // Rows of 4 and 5 tiles; the half tiles at the edges wrap around.
    expect(rows).toHaveLength(4 + 5 + 4 + 5)
    expect(rows.slice(0, 9).map((r) => r[0])).toEqual([
      0.6, 240.6, 480.6, 720.6, -119.4, 120.6, 360.6, 600.6, 840.6,
    ])
    expect(rows[0]).toEqual([0.6, 0.6, 238.8, 118.8])
    expect(recorder.calls.some((c) => c.op === 'arc')).toBe(false)
  })

  it('draws the same texture every time', () => {
    roomMaterials('SI1.0', 'side_hall', sideHall())
    const first = JSON.stringify(recorder.calls)
    recorder.calls.length = 0
    roomMaterials('SI1.0', 'side_hall', sideHall())
    expect(JSON.stringify(recorder.calls)).toBe(first)
  })
})

describe('finishMaterial by material name', () => {
  const finish = (
    name: string,
    options: THREE.MeshStandardMaterialParameters = {},
    environment: THREE.Texture | null = null,
  ) =>
    finishMaterial(
      new THREE.MeshStandardMaterial({ name, color: '#336699', ...options }),
      environment,
    ) as THREE.MeshStandardMaterial

  it('leaves materials that are not MeshStandardMaterial untouched (same object)', () => {
    const basic = new THREE.MeshBasicMaterial({ name: '玻璃' })
    expect(finishMaterial(basic, null)).toBe(basic)
  })

  it('gives plain props matte flat-shaded double-sided copies; other values are kept', () => {
    const source = new THREE.MeshStandardMaterial({ name: 'wood', roughness: 0.1, metalness: 0.3 })
    const finished = finishMaterial(source, null) as THREE.MeshStandardMaterial
    expect(finished).not.toBe(source)
    expect(finished.roughness).toBe(0.7)
    expect(finished.metalness).toBe(0.3)
    expect(finished.flatShading).toBe(true)
    expect(finished.side).toBe(THREE.DoubleSide)
    expect(finished.transparent).toBe(false)
    expect(finished.emissiveIntensity).toBe(1)
    expect(finished.emissive.getHexString()).toBe('000000')
    // The source is not changed.
    expect([source.roughness, source.flatShading, source.side]).toEqual([
      0.1,
      false,
      THREE.FrontSide,
    ])
  })

  it.each(['玻璃', '磨砂亚克力', 'Translucent Glass', 'TRANSLUCENT GLASS'])(
    'makes %s see-through glass',
    (name) => {
      const glass = finish(name)
      expect(glass.transparent).toBe(true)
      expect(glass.opacity).toBe(0.35)
      expect(glass.roughness).toBe(0.25)
      expect(glass.depthWrite).toBe(false)
      expect(glass.metalness).toBe(0)
    },
  )

  it('keeps a glass opacity already below 0.35', () => {
    expect(finish('玻璃', { transparent: true, opacity: 0.2 }).opacity).toBe(0.2)
  })

  it.each(['不锈钢', '金属', '银色桌腿', 'Steel', 'aluminium', 'ALUMINUM'])(
    'makes %s metal reflecting the given environment',
    (name) => {
      const environment = new THREE.Texture()
      const metal = finish(name, {}, environment)
      expect(metal.metalness).toBe(0.65)
      expect(metal.roughness).toBe(0.34)
      expect(metal.envMap).toBe(environment)
      expect(metal.transparent).toBe(false)
    },
  )

  it.each(['烤漆', '桌面材质', '人造石'])('gives %s a lacquer finish', (name) => {
    const lacquer = finish(name)
    expect(lacquer.roughness).toBe(0.4)
    expect(lacquer.metalness).toBe(0)
  })

  it('checks glass before metal before lacquer', () => {
    expect(finish('不锈钢玻璃').roughness).toBe(0.25)
    expect(finish('不锈钢玻璃').metalness).toBe(0)
    expect(finish('烤漆不锈钢').roughness).toBe(0.34)
  })

  it('lights screens at 0.55 and glowing parts at 1, in their own colour', () => {
    const screen = finish('屏幕画面')
    expect(screen.emissiveIntensity).toBe(0.55)
    expect(screen.emissive.getHexString()).toBe('336699')
    expect(screen.emissiveMap).toBeNull()
    expect(screen.roughness).toBe(0.7)

    expect(finish('发光灯箱').emissiveIntensity).toBe(1)
    expect(finish('Emissive').emissiveIntensity).toBe(1)
    // Glow wins over screen.
    expect(finish('发光屏幕').emissiveIntensity).toBe(1)
  })

  it('combines glow with the surface finish', () => {
    const glassScreen = finish('玻璃 屏幕')
    expect([glassScreen.transparent, glassScreen.opacity, glassScreen.emissiveIntensity]).toEqual([
      true,
      0.35,
      0.55,
    ])
    const glowingMetal = finish('不锈钢 发光')
    expect([glowingMetal.metalness, glowingMetal.emissiveIntensity]).toEqual([0.65, 1])
  })

  it('lights textured screens white through their own map', () => {
    const map = new THREE.Texture()
    const screen = finish('屏幕', { map })
    expect(screen.emissive.getHexString()).toBe('ffffff')
    expect(screen.emissiveMap).toBe(map)
  })
})
