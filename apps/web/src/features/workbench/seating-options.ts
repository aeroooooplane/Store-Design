import type { SiStyle } from '@store/shared'

/** 名称与次序只用于添加模型，已有方案与目录原始记录继续保留。 */
export const SEATING_NAMES: Record<string, string> = {
  'asset-90000002': '培训坐凳',
  'asset-569180': '培训坐凳组合',
  'asset-90000005': '字母凳',
  'asset-15903874': '字母凳组合',
  'asset-3356837': '双人沙发',
}

const SEATING_ORDER: Record<SiStyle, readonly string[]> = {
  'SI1.0': ['asset-90000002', 'asset-569180', 'asset-3356837'],
  'SI2.0': ['asset-90000005', 'asset-15903874', 'asset-3356837'],
}

export function seatingOrder(id: string, si: SiStyle): number {
  const index = SEATING_ORDER[si].indexOf(id)
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

/** 实际GLB渲染，透明底沿用模型卡片底色；灰色仅作用于SI1缩略图。 */
export const SEATING_THUMBNAILS = import.meta.glob<string>('./seating-thumbnails/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
})
