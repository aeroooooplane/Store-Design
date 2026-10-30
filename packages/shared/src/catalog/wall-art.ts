import type { Asset } from '../schemas/asset.ts'
import type { LayoutItem } from '../schemas/layout.ts'
import { nearestQuarter, turnPoint } from '../geometry/obb.ts'
import type { Point } from '../geometry/types.ts'
import { roundM } from '../units.ts'

/** 用户确认的标准灯箱：独立于旧灯箱型号，宽高可分别调整。 */
export const WALL_ART_ID = 'asset-90000003'
export const WALL_ART_DEPTH = 0.001

export const isWallArt = (item: { assetId?: string | null }) => item.assetId === WALL_ART_ID

export function wallArtAsset(): Asset {
  return {
    id: WALL_ART_ID,
    name: '灯箱墙贴',
    standardName: '灯箱墙贴',
    variant: '标准1500×850，可调尺寸',
    materialCategory: '灯箱',
    siFamily: '通用',
    category: '信息化物料',
    function: 'signage',
    installation: 'wall',
    footprint: { w: 1.5, d: WALL_ART_DEPTH, h: 0.85 },
    footprintSource: 'source',
    extent: null,
    front: '+Z',
    staffSide: null,
    facingConfidence: 'high',
    placeable: true,
    retired: false,
    judgment: '标准墙面画片；宽高独立调整，图库画面待接入',
    glb: null,
    whiteGlb: null,
    finishGlb: null,
    market: null,
    otherMarketGlb: null,
    preview: null,
    productImage: null,
    productImageMatch: null,
    planSymbol: null,
  }
}

/** 取回画片自身的宽、高、厚度，避免90°旋转后把厚度当成宽度。 */
export function wallArtSize(item: Pick<LayoutItem, 'w' | 'd' | 'h' | 'rotation'>) {
  const q = nearestQuarter(item.rotation)
  const swap = q === 90 || q === 270
  return { w: swap ? item.d : item.w, d: swap ? item.w : item.d, h: item.h }
}

const dimension = (value: number) => roundM(Math.max(0.001, Math.min(50, value)))

export function resizeWallArt(item: LayoutItem, width: number, height: number): LayoutItem {
  if (!isWallArt(item) || !Number.isFinite(width) || !Number.isFinite(height)) return item
  const q = nearestQuarter(item.rotation)
  const swap = q === 90 || q === 270
  const next = {
    ...item,
    w: swap ? WALL_ART_DEPTH : dimension(width),
    d: swap ? dimension(width) : WALL_ART_DEPTH,
    h: dimension(height),
    mount: 'wall' as const,
  }
  delete next.scale
  return next
}

/** 平面端点拖动：只改宽度，对端保持原位。 */
export function wallArtFromEnd(item: LayoutItem, end: -1 | 1, pointer: Point) {
  const size = wallArtSize(item)
  const [ux, uz] = turnPoint(1, 0, item.rotation)
  const anchor: Point = [item.cx - (ux * end * size.w) / 2, item.cz - (uz * end * size.w) / 2]
  const w = dimension(((pointer[0] - anchor[0]) * ux + (pointer[1] - anchor[1]) * uz) * end)
  return {
    w,
    h: item.h,
    cx: roundM(anchor[0] + (ux * end * w) / 2),
    cz: roundM(anchor[1] + (uz * end * w) / 2),
  }
}

/** 三维角点拖动：宽高分别跟随指针，对角保持原位。 */
export function wallArtFromCorner(
  item: LayoutItem,
  corner: { x: -1 | 1; y: -1 | 1 },
  pointer: { plan: Point; y: number },
) {
  const placed = wallArtFromEnd(item, corner.x, pointer.plan)
  const bottom = item.elevation ?? 0
  const anchorY = corner.y > 0 ? bottom : bottom + item.h
  const h = dimension((pointer.y - anchorY) * corner.y)
  return { ...placed, h, elevation: roundM(Math.max(0, corner.y > 0 ? anchorY : anchorY - h)) }
}
