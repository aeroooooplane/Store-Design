import { describe, expect, it } from 'vitest'
import { LayoutSchema, validateLayout } from '../schemas/layout.ts'
import type { LayoutItem } from '../schemas/layout.ts'
import { rectangleSpace } from '../schemas/space.ts'
import type { Space } from '../schemas/space.ts'
import {
  DEFAULT_WALL_ELEVATION_M,
  defaultElevation,
  itemsCollide,
  mountedWall,
  wallFaces,
  wallMountSnap,
} from './index.ts'

// 6 m × 4 m, 3 m high; the main entrance runs along the bottom edge (z = 4).
const space = rectangleSpace(6, 4, 3)
const partition = {
  id: 'partition-1',
  kind: 'hollow_partition' as const,
  cx: 3,
  cz: 2,
  w: 4,
  d: 0.2,
  h: 2.4,
}

describe('空心隔板上的贴墙道具', () => {
  it('隔板两侧分别朝外，背面贴合且校验认可', () => {
    for (const [z, expectedZ, rotation] of [
      [1.8, 1.875, 180],
      [2.2, 2.125, 0],
    ]) {
      const placed = wallMountSnap(logo({ elevation: 1.2 }), 3, z!, space, '+Z', undefined, [
        partition,
      ])!
      expect(placed).toMatchObject({ cx: 3, cz: expectedZ, rotation })
      const piece = logo({ ...placed, elevation: 1.2 })
      expect(mountedWall(piece, space, [partition])?.fixtureId).toBe(partition.id)
      const layout = LayoutSchema.parse({
        schemaVersion: 3,
        items: [piece],
        fixtures: [partition],
        planning: null,
      })
      expect(validateLayout(space, layout).some((i) => i.code === 'item_not_on_wall')).toBe(false)
      expect(
        validateLayout(space, { ...layout, fixtures: [] }).some(
          (i) => i.code === 'item_not_on_wall',
        ),
      ).toBe(true)
    }
  })
  it('默认安装高度不超过隔板顶部，远处不自动吸附', () => {
    const piece = logo({ cz: 2.125, h: 0.8 })
    expect(defaultElevation(piece, [], space, [partition])).toBe(1.6)
    expect(wallMountSnap(piece, 3, 3, space, '+Z', undefined, [partition])).toBeNull()
  })
  it('隔板窄端面与低矮面不能支撑超宽或超高道具，外围墙仍沿用原行为', () => {
    const wide = logo({ w: 1.2, elevation: 1, h: 0.5 })
    expect(wallMountSnap(wide, 0.97, 2, space, '+Z', undefined, [partition])).toBeNull()
    const short = { ...partition, h: 0.4 }
    expect(wallMountSnap(wide, 3, 2.2, space, '+Z', undefined, [short])).toBeNull()
    expect(
      mountedWall({ ...wide, cx: 0.975, cz: 2, w: 0.05, d: 1.2 }, space, [partition]),
    ).toBeNull()
    expect(mountedWall({ ...wide, cz: 2.125, elevation: 2.1 }, space, [partition])).toBeNull()
    expect(wallMountSnap(logo(), 0.2, 3.6, space, '+Z')).not.toBeNull()
  })
  it('配件柜穿过外表面形成的缺口不算支撑，柜顶以上的实体仍可贴面', () => {
    const cabinet = item('cabinet', { cx: 3, cz: 3, w: 1.2, d: 2, h: 2.4 })
    const piece = logo({ w: 1, cz: 2.125, elevation: 1.2, h: 0.5 })
    expect(mountedWall(piece, space, [partition], [cabinet])).toBeNull()
    expect(wallMountSnap(piece, 3, 2.2, space, '+Z', undefined, [partition], [cabinet])).toBeNull()
    const layout = LayoutSchema.parse({
      schemaVersion: 3,
      planning: null,
      fixtures: [partition],
      items: [piece, cabinet],
    })
    expect(validateLayout(space, layout).some((i) => i.code === 'item_not_on_wall')).toBe(true)
    expect(mountedWall(piece, space, [partition], [{ ...cabinet, h: 1 }])?.fixtureId).toBe(
      partition.id,
    )
  })
})

function item(id: string, overrides: Partial<LayoutItem> = {}): LayoutItem {
  return {
    id,
    assetId: null,
    function: 'accessory_cabinet',
    name: id,
    cx: 3,
    cz: 0.275,
    rotation: 0,
    w: 2.4,
    d: 0.55,
    h: 2.4,
    placeholder: false,
    locked: false,
    ...overrides,
  }
}

/** A 3453 mm 墙面 LOGO on the back wall, 50 mm thick. */
const logo = (overrides: Partial<LayoutItem> = {}) =>
  item('logo', {
    function: 'signage',
    w: 3.453,
    d: 0.05,
    h: 0.453,
    cz: 0.025,
    mount: 'wall',
    elevation: 2.5,
    ...overrides,
  })

describe('itemsCollide', () => {
  it('floor props clash when their footprints overlap', () => {
    expect(itemsCollide(item('a'), item('b', { cx: 4 }))).toBe(true)
    expect(itemsCollide(item('a'), item('b', { cx: 5.4 }))).toBe(false)
  })

  it('a wall piece above a cabinet is no clash', () => {
    expect(itemsCollide(logo(), item('cabinet'))).toBe(false)
    expect(itemsCollide(logo({ elevation: 0.5 }), item('cabinet'))).toBe(false)
  })

  it('two wall pieces clash only where their heights overlap too', () => {
    expect(itemsCollide(logo(), logo({ id: 'b', elevation: 2.7 }))).toBe(true)
    expect(itemsCollide(logo(), logo({ id: 'b', elevation: 1.5 }))).toBe(false)
  })
})

describe('wallFaces', () => {
  it('finds the four walls of a rectangle with their inward directions', () => {
    const faces = wallFaces(space)
    expect(faces.map((f) => [f.along, f.inward[0], f.inward[1]])).toEqual([
      ['x', 0, 1],
      ['z', -1, 0],
      ['x', 0, -1],
      ['z', 1, 0],
    ])
  })

  it('marks open stretches and leaves out slanted edges', () => {
    const open: Space = { ...space, openEdges: [{ a: [6, 1], b: [6, 3] }] }
    expect(wallFaces(open).find((f) => f.along === 'z' && f.inward[0] < 0)?.open).toEqual([[1, 3]])
    const slanted = rectangleSpace(6, 4, 3)
    slanted.boundary = [
      [0, 0],
      [6, 0],
      [5, 4],
      [0, 4],
    ]
    expect(wallFaces(slanted)).toHaveLength(3)
  })
})

describe('wallMountSnap', () => {
  it('puts the back of a piece onto the back wall, front into the shop', () => {
    const placed = wallMountSnap(logo(), 3, 0.2, space, '+Z')
    expect(placed).toEqual({ cx: 3, cz: 0.025, rotation: 0, w: 3.453, d: 0.05 })
  })

  it('turns a piece dragged to a side wall and swaps its footprint', () => {
    const placed = wallMountSnap(logo(), 0.2, 2, space, '+Z')
    expect(placed).toEqual({ cx: 0.025, cz: 2, rotation: 270, w: 0.05, d: 3.453 })
  })

  it('keeps a long piece on its stretch of wall near a corner', () => {
    // 3453 mm on the 4 m side wall, dragged near the bottom corner: it slides back to fit.
    expect(wallMountSnap(logo(), 0.2, 3.6, space, '+Z')).toMatchObject({ cx: 0.025, cz: 2.274 })
    expect(wallMountSnap(logo(), 5.8, 0.03, space, '+Z')).toMatchObject({ cx: 4.274, cz: 0.025 })
  })

  it('does not snap far from the walls or on an open stretch', () => {
    expect(wallMountSnap(logo(), 3, 1.5, space, '+Z')).toBeNull()
    const open: Space = { ...space, openEdges: [{ a: [0, 0], b: [6, 0] }] }
    expect(wallMountSnap(logo(), 3, 0.2, open, '+Z')).toBeNull()
  })
})

describe('mountedWall', () => {
  it('is the wall the back touches, within 10 mm', () => {
    expect(mountedWall(logo(), space)?.along).toBe('x')
    expect(mountedWall(logo({ cz: 0.03 }), space)?.along).toBe('x')
    expect(mountedWall(logo({ cz: 0.08 }), space)).toBeNull()
  })

  it('is the wall a piece runs along when its end also touches the next wall', () => {
    // On the left wall, pushed into the bottom corner: its end touches the bottom wall too.
    const corner = logo({ cx: 0.025, cz: 2.274, w: 0.05, d: 3.453, rotation: 270 })
    expect(mountedWall(corner, space)?.along).toBe('z')
  })
})

describe('defaultElevation', () => {
  it('sits above the tallest prop below, or at the default height', () => {
    expect(defaultElevation(logo(), [item('cabinet')], space)).toBe(2.5)
    expect(defaultElevation(logo(), [], space)).toBe(DEFAULT_WALL_ELEVATION_M)
    expect(defaultElevation(logo(), [item('far', { cz: 3 })], space)).toBe(DEFAULT_WALL_ELEVATION_M)
  })

  it('never reaches above the ceiling; ceiling pieces hang from it', () => {
    expect(defaultElevation(logo({ h: 0.8 }), [item('cabinet')], space)).toBe(2.2)
    expect(defaultElevation(logo({ mount: 'ceiling', h: 1.6, cz: 2 }), [], space)).toBe(1.4)
  })
})

describe('validateLayout with wall pieces', () => {
  const layout = (items: LayoutItem[]) => LayoutSchema.parse({ schemaVersion: 3, items })
  const codes = (items: LayoutItem[]) => validateLayout(space, layout(items)).map((i) => i.code)

  it('accepts a LOGO on the wall above a cabinet', () => {
    expect(codes([item('cabinet'), logo()])).toEqual([])
  })

  it('warns when a wall piece is off the wall', () => {
    const issues = validateLayout(space, layout([logo({ cz: 1 })]))
    expect(issues.map((i) => [i.code, i.severity])).toEqual([['item_not_on_wall', 'warning']])
  })

  it('counts the height above the floor against the ceiling', () => {
    expect(codes([logo({ elevation: 2.7 })])).toEqual(['item_too_tall'])
  })

  it('lets a wall piece hang over an entrance', () => {
    expect(codes([logo({ cz: 3.975, rotation: 180 })])).toEqual([])
  })
})
