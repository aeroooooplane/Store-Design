import type { Market } from '@store/shared'

/** 用户确认的六款标识，同一型号按项目市场显示对应字标。 */
export const SIGNAGE_OPTIONS: Record<string, Record<Market, string>> = {
  'asset-90000111': { domestic: '徕卡墙组合 1200', overseas: '徕卡墙组合 1200' },
  'asset-90000112': { domestic: '徕卡墙组合 1990', overseas: '徕卡墙组合 1990' },
  'asset-90000113': { domestic: '徕卡墙组合 3000', overseas: '徕卡墙组合 3000' },
  'asset-20533337': { domestic: '影石 Insta360', overseas: 'Insta360' },
  'asset-33868330': {
    domestic: '影石 Insta360 始于敢想',
    overseas: 'Insta360 Think Bold',
  },
  'asset-11483499': { domestic: '影翎 ANTIGRAVITY', overseas: 'ANTIGRAVITY' },
}

export const SIGNAGE_ORDER = Object.keys(SIGNAGE_OPTIONS)

/** 白底正面缩略图取自对应市场实际 GLB；仅缩略图字标以深灰显示，模型材质不变。 */
export const SIGNAGE_THUMBNAILS = import.meta.glob<string>('./signage-thumbnails/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
})
