import type { SiStyle } from '../enums.ts'
import { facingAfter, rotationFacing } from '../planner/orientation.ts'
import type { PlanDirection } from '../planner/orientation.ts'
import type { Asset } from '../schemas/asset.ts'
import { rotatedFootprint } from '../schemas/layout.ts'
import type { Layout, LayoutItem, Rotation } from '../schemas/layout.ts'
import { roundM } from '../units.ts'

/**
 * Which SI2.0 / SI1.0 props replace a prop of the other style when the project's SI style
 * changes (资源库/SI切换映射表.xlsx, approved by the user 2026-10-12). The key is the prop being
 * replaced; the value lists the replacements, side by side along its length (a 2.4 m cabinet
 * becomes two 1.2 m ones), or null when the style has no counterpart and the prop stays.
 * Props not listed (信息化物料, 品牌标识, 非标陈列, 环境设施, props of the target style) stay.
 */
export const SI_SWAP: Record<SiStyle, Readonly<Record<string, readonly string[] | null>>> = {
  'SI2.0': {
    'asset-2595882': ['asset-34327615'], // 1.2米配件柜 → 1.2米配件柜（骑行画面款）
    'asset-323015': ['asset-34327615'], // 1.6米配件柜 → 1.2米配件柜（SI2.0 无 1.6 米）
    'asset-2360478': ['asset-33819654'], // 1.8米边桌收银柜 → 1.8米收银边柜
    'asset-24498456': ['asset-33819654'], // 1.8米边桌收银柜（停用变体）→ 1.8米收银边柜
    'asset-24488377': ['asset-24432224'], // 1.8米收银台 → 1.8米收银桌(左)
    'asset-408124': ['asset-24312623'], // 1.8米普通中岛桌 → 1.8米普通中岛桌
    'asset-408125': ['asset-24312623'], // 1.8米普通中岛桌（停用变体）→ 1.8米普通中岛桌
    'asset-569180': ['asset-15903874'], // 培训坐凳 → 字母凳
    'asset-34320268': ['asset-33660153'], // 1.8米边桌配件柜 → 1.8米配件边柜(带托盘)
    'asset-752992': ['asset-33660153'], // 1.8米边桌储物柜 → 1.8米配件边柜(带托盘)
    'asset-666964': ['asset-16469753'], // 1.8米开箱储物柜 → 1.8米普通开箱桌
    'asset-1788391': ['asset-16469753'], // 1.8米普通开箱桌 → 1.8米普通开箱桌
  },
  'SI1.0': {
    'asset-34327615': ['asset-2595882'], // 1.2米配件柜 → 1.2米配件柜
    'asset-24482600': ['asset-2595882'], // 1.2米配件柜(AVBU) → 1.2米配件柜
    'asset-36890994': ['asset-2595882', 'asset-2595882'], // 2.4米配件柜(场景) → 1.2 × 2
    'asset-6799167': ['asset-2595882', 'asset-2595882'], // 2.4米配件柜(场景，停用变体) → 1.2 × 2
    'asset-36887885': ['asset-2595882', 'asset-2595882'], // 2.4米配件柜(AVBU) → 1.2 × 2
    'asset-36929122': ['asset-2595882', 'asset-2595882'], // 2.4米配件柜(AVBU+影石) → 1.2 × 2
    'asset-15903179': ['asset-2595882', 'asset-2595882', 'asset-2595882'], // 3.6米 → 1.2 × 3
    'asset-36857093': ['asset-2595882', 'asset-2595882', 'asset-2595882'], // 3.6米(AVBU) → 1.2 × 3
    'asset-33819654': ['asset-2360478'], // 1.8米收银边柜 → 1.8米边桌收银柜
    'asset-24432224': ['asset-24488377'], // 1.8米收银桌(左) → 1.8米收银台
    'asset-41053706': ['asset-408124'], // 1.8米亮脚中岛桌 → 1.8米普通中岛桌
    'asset-24312623': ['asset-408124'], // 1.8米普通中岛桌 → 1.8米普通中岛桌
    'asset-34276510': ['asset-408124'], // 1.8米普通中岛桌（停用变体）→ 1.8米普通中岛桌
    'asset-15903874': ['asset-569180'], // 字母凳 → 培训坐凳
    'asset-33660153': ['asset-34320268'], // 1.8米配件边柜(带托盘) → 1.8米边桌配件柜
    'asset-28192911': ['asset-34320268'], // 1.8米配件边柜(H1.3米) → 1.8米边桌配件柜
    'asset-41277543': ['asset-1788391'], // 1.8米亮脚开箱桌 → 1.8米普通开箱桌
    'asset-16469753': ['asset-1788391'], // 1.8米普通开箱桌 → 1.8米普通开箱桌
    // SI1.0 has no counterpart: they stay as they are.
    'asset-36882381': null, // 0.6米产品展示台
    'asset-37747691': null,
    'asset-37747692': null,
    'asset-37747693': null,
    'asset-16510684': null, // 试飞台
    'asset-36929204': null, // 徕卡墙画面标识组合
  },
}

type SwapAsset = Pick<Asset, 'id' | 'name' | 'function' | 'footprint' | 'front' | 'placeable'>

export interface SiSwapResult {
  layout: Layout
  /** Props replaced (a prop split in two counts once). */
  swapped: number
  /** Names of props of the other style that have no counterpart and stay. */
  kept: string[]
}

/** The world direction a prop faces, or null when it has none (front 'any' or unknown). */
function facing(asset: SwapAsset | undefined, rotation: Rotation): PlanDirection | null {
  const front = asset?.front
  return front && front !== 'any' ? facingAfter(front, rotation) : null
}

/**
 * The old prop's turn or a quarter turn more, whichever leaves the new footprint (pieces side
 * by side along the old length) closer to the old one; a tie keeps the old turn.
 */
function bestFit(asset: SwapAsset, item: LayoutItem, pieces: number): Rotation {
  const longAlongX = item.w >= item.d
  const kept = item.rotation
  const turned = (item.rotation + 90) % 360
  const misfit = (rotation: Rotation) => {
    const size = rotatedFootprint(asset, rotation)
    const w = longAlongX ? size.w * pieces : size.w
    const d = longAlongX ? size.d : size.d * pieces
    return Math.abs(w - item.w) + Math.abs(d - item.d)
  }
  return misfit(turned) < misfit(kept) - 1e-9 ? turned : kept
}

/**
 * The replacements of one prop. Each keeps the old prop's facing (or, without a front, the
 * direction of its long side); several stand side by side along the old prop's length. A prop
 * with a front keeps its back where it was, so a cabinet against a wall stays against it when
 * the new one is deeper or shallower; one without a front keeps its centre.
 */
function replace(item: LayoutItem, old: SwapAsset | undefined, news: SwapAsset[]): LayoutItem[] {
  const direction = facing(old, item.rotation)
  const longAlongX = item.w >= item.d
  const pieces = news.map((asset) => {
    let rotation = direction ? rotationFacing(asset.front, direction) : null
    // Without a front: the old turn or a quarter more, whichever fits the old footprint better.
    rotation ??= bestFit(asset, item, news.length)
    return { asset, rotation, size: rotatedFootprint(asset, rotation) }
  })
  const along = (size: { w: number; d: number }) => (longAlongX ? size.w : size.d)
  const across = (size: { w: number; d: number }) => (longAlongX ? size.d : size.w)
  const total = pieces.reduce((sum, p) => sum + along(p.size), 0)
  let offset = -total / 2
  return pieces.map(({ asset, rotation, size }, k) => {
    const middle = offset + along(size) / 2
    offset += along(size)
    // Keep the back edge: move forward by half the change in depth.
    const shift = direction ? (across(size) - across(item)) / 2 : 0
    const cx = item.cx + (longAlongX ? middle : 0) + (direction ? direction[0] * shift : 0)
    const cz = item.cz + (longAlongX ? 0 : middle) + (direction ? direction[1] * shift : 0)
    return {
      ...item,
      id: news.length > 1 ? `${item.id}-${k + 1}` : item.id,
      assetId: asset.id,
      function: asset.function,
      name: asset.name,
      cx: roundM(cx),
      cz: roundM(cz),
      rotation,
      w: size.w,
      d: size.d,
      h: size.h,
      placeholder: !asset.placeable,
    }
  })
}

/** The layout with every prop swapped to its counterpart of the target SI style. */
export function swapLayoutSi(
  layout: Layout,
  target: SiStyle,
  catalog: ReadonlyMap<string, SwapAsset>,
): SiSwapResult {
  const table = SI_SWAP[target]
  const items: LayoutItem[] = []
  const kept: string[] = []
  let swapped = 0
  for (const item of layout.items) {
    const entry = item.assetId ? table[item.assetId] : undefined
    if (entry === undefined) {
      items.push(item)
      continue
    }
    const news = (entry ?? []).map((id) => catalog.get(id))
    if (entry === null || !news.length || news.some((a) => !a)) {
      kept.push(item.name)
      items.push(item)
      continue
    }
    const old = item.assetId ? catalog.get(item.assetId) : undefined
    items.push(...replace(item, old, news as SwapAsset[]))
    swapped++
  }
  // Split pieces must not collide with ids already in the layout.
  const used = new Set<string>()
  const unique = items.map((item) => {
    let id = item.id
    for (let n = 2; used.has(id); n++) id = `${item.id.slice(0, 58)}-${n}`
    used.add(id)
    return id === item.id ? item : { ...item, id }
  })
  return { layout: { ...layout, items: unique }, swapped, kept }
}

/** "方案 · 按面积推荐 · SI1.0" → "方案 · 按面积推荐 · SI2.0": the switched copy's name. */
export function siSwapName(name: string, target: SiStyle): string {
  const base = name.replace(/（\d+）$/, '').replace(/ · SI[12]\.0$/, '')
  return `${base} · ${target}`
}

/**
 * The SI style a layout's props are of: the style most of its swappable props belong to (a prop
 * listed for swapping to SI2.0 is an SI1.0 one, and the other way round), or null when it has
 * none (an empty plan, only shared props).
 */
export function layoutSi(layout: Layout): SiStyle | null {
  let si1 = 0
  let si2 = 0
  for (const item of layout.items) {
    if (!item.assetId) continue
    if (item.assetId in SI_SWAP['SI2.0']) si1++
    else if (item.assetId in SI_SWAP['SI1.0']) si2++
  }
  return si1 === si2 ? null : si1 > si2 ? 'SI1.0' : 'SI2.0'
}

/**
 * The SI style of a step: its own when it was saved with one, else that of its props, else the
 * project's (steps saved before nodes kept their style).
 */
export function nodeSiStyle(
  node: { siStyle: SiStyle | null; layout: Layout | null },
  projectSi: SiStyle,
): SiStyle {
  return node.siStyle ?? (node.layout ? layoutSi(node.layout) : null) ?? projectSi
}

/** The same props in the same places (to the millimetre): an untouched copy of a layout. */
export function sameLayoutProps(a: Layout, b: Layout): boolean {
  if (a.items.length !== b.items.length) return false
  const byId = new Map(b.items.map((item) => [item.id, item]))
  return a.items.every((item) => {
    const other = byId.get(item.id)
    return (
      !!other &&
      other.assetId === item.assetId &&
      other.rotation === item.rotation &&
      Math.abs(other.cx - item.cx) <= 0.001 &&
      Math.abs(other.cz - item.cz) <= 0.001
    )
  })
}
