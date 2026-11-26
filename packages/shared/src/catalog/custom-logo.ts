import { z } from 'zod'
import type { Asset } from '../schemas/asset.ts'
import type { LayoutItem } from '../schemas/layout.ts'
import { nearestQuarter } from '../geometry/obb.ts'
import { roundM } from '../units.ts'
import metrics from './logo-metrics.json' with { type: 'json' }

export const CUSTOM_LOGO_ID = 'asset-90000004'
export const DEFAULT_LOGO_TEXT = 'LOGO'
export const MAX_LOGO_CHARACTERS = 40
export const isCustomLogo = (item: { assetId?: string | null }) => item.assetId === CUSTOM_LOGO_ID

export function customLogoProblem(text: string): string | null {
  if (!text.trim()) return '请输入 LOGO 文字'
  if ([...text].length > MAX_LOGO_CHARACTERS) return `最多输入 ${MAX_LOGO_CHARACTERS} 个字符`
  const unsupported = [...new Set([...text].filter((ch) => !Object.hasOwn(metrics, ch)))]
  if (unsupported.length) return `暂不支持这些字符：${unsupported.join('')}`
  try {
    logoTextBounds(text)
  } catch {
    return '请输入可见的 LOGO 文字'
  }
  return null
}

export const CustomLogoTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_LOGO_CHARACTERS)
  .refine((text) => customLogoProblem(text) === null, {
    message: 'LOGO 文字须为字体支持的中英文、数字或标点，最多 40 字',
  })

/** Actual outline bounds, using exactly the same glyph advances as Three FontLoader (no kerning). */
export function logoTextBounds(text: string) {
  let x = 0,
    minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const ch of text) {
    const glyph = (metrics as Record<string, number[]>)[ch]
    if (!glyph) throw new Error('不支持的 LOGO 字符')
    const [advance, left, bottom, right, top] = glyph as [number, number, number, number, number]
    if (right > left && top > bottom) {
      minX = Math.min(minX, x + left)
      maxX = Math.max(maxX, x + right)
      minY = Math.min(minY, bottom)
      maxY = Math.max(maxY, top)
    }
    x += advance
  }
  if (!Number.isFinite(minX)) throw new Error('LOGO 文字没有可见字形')
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

/** Default visible letter height 300 mm, depth 30 mm. Long text keeps this height. */
export function customLogoFootprint(text = DEFAULT_LOGO_TEXT) {
  const bounds = logoTextBounds(text)
  return { w: roundM((0.3 * bounds.w) / bounds.h), d: 0.03, h: 0.3 }
}

export function customLogoSize(text: string, scale = 1, rotation = 0) {
  const f = customLogoFootprint(text)
  const q = nearestQuarter(rotation),
    swap = q === 90 || q === 270
  return {
    w: roundM((swap ? f.d : f.w) * scale),
    d: roundM((swap ? f.w : f.d) * scale),
    h: roundM(f.h * scale),
  }
}

export function customLogoAsset(text = DEFAULT_LOGO_TEXT): Asset {
  return {
    id: CUSTOM_LOGO_ID,
    name: '自定义LOGO',
    standardName: '自定义LOGO',
    variant: '可编辑文字与大小',
    materialCategory: '标识',
    siFamily: '通用',
    category: '品牌标识',
    function: 'signage',
    installation: 'wall',
    footprint: customLogoFootprint(text),
    footprintSource: 'source',
    extent: null,
    front: '+Z',
    staffSide: null,
    facingConfidence: 'high',
    placeable: true,
    retired: false,
    judgment: '思源黑体风格，白色立体字，文字和大小可编辑',
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

export function changeLogoText(item: LayoutItem, text: string): LayoutItem {
  text = text.trim()
  if (!isCustomLogo(item) || item.locked || customLogoProblem(text)) return item
  return { ...item, logoText: text, ...customLogoSize(text, item.scale ?? 1, item.rotation) }
}
