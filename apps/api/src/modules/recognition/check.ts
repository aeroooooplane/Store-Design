import {
  RECOGNITION_MIN_CONFIDENCE,
  distanceToBoundary,
  functionFor,
  isSimplePolygon,
  locatePoint,
  polygonArea,
} from '@store/shared'
import type { Asset, DraftItem, ItemFunction, RecognitionDraft } from '@store/shared'

/** No shop is smaller; a smaller "boundary" is a detail drawing or a wrong scale. */
const MIN_AREA_M2 = 5
const MAX_AREA_M2 = 5000
/** Props this close to the boundary (m) are on its wall (a screen on the wall face), not outside. */
export const WALL_REACH_M = 0.3

/** "1.2米配件柜" → 1.2; "1800mm" → 1.8; "2*1.2配件柜" → 1.2 (the width, after the count). */
export function sizeInLabel(label: string): number | null {
  const text = label.replace(/^\d{1,2}\s*[*×xX]\s*/, '')
  // "1700W980H内嵌灯箱", "W1700*H3000mm": the width in millimetres.
  const wh = /(\d{3,4})\s*W\s*\d{3,4}\s*H|\bW\s*(\d{3,4})/i.exec(text)
  const width = Number(wh?.[1] ?? wh?.[2])
  if (wh && width) return width / 1000
  // Heights ("H:900mm", "店铺天花高度：3494mm") and areas ("1.74m²") are not widths.
  if (/高|^H\s*[:：]|m²|㎡|平方/i.test(text)) return null
  const metres = /(\d+(?:\.\d+)?)\s*(?:米|m)(?![a-z])/i.exec(text)
  if (metres?.[1]) return Number(metres[1])
  const mm = /(\d{3,5})\s*mm/i.exec(text)
  if (mm?.[1]) return Number(mm[1]) / 1000
  // "1.2配件柜": a small number straight before the kind is metres (not 75寸, not 2个).
  const bare = /^(\d+(?:\.\d+)?)(?![寸个件台张层])(?=[\u4e00-\u9fff])/.exec(text)
  if (bare?.[1] && Number(bare[1]) <= 10) return Number(bare[1])
  return null
}

/** "边桌配件柜*2", "配件柜×2", "2*1.2配件柜", "中岛桌 2个" → 2. */
export function countInLabel(label: string): number {
  const trailing = /[*×xX]\s*(\d{1,2})\s*(?:个|件|台|张)?\s*$/.exec(label)
  if (trailing?.[1]) return Number(trailing[1])
  const leading = /^(\d{1,2})\s*[*×xX]\s*\d/.exec(label)
  if (leading?.[1]) return Number(leading[1])
  const words = /(\d{1,2})\s*(?:个|件|台|张)\s*$/.exec(label)
  if (words?.[1]) return Number(words[1])
  return 1
}

/** Text with the count, units and spacing stripped, so names compare evenly. */
export function normaliseLabel(label: string): string {
  return label
    .replace(/[*×xX]\s*\d{1,2}\s*(?:个|件|台|张)?\s*$/, '')
    .replace(/^\d{1,2}\s*[*×xX]\s*/, '')
    .replace(/\s+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/(\d+(?:\.\d+)?)\s*m(?![a-z])/gi, '$1米')
    .trim()
}

export interface CatalogMatch {
  asset: Asset | null
  function: ItemFunction
  confidence: number
  note: string | null
}

const usable = (a: Asset) => !a.retired && a.placeable

/**
 * Words naming a kind of sign or screen. A label with one means only models named with it too:
 * a light box is no logo, though both are signage of about the same size.
 */
const KIND_WORDS = ['灯箱', 'logo', '海报', '徕卡墙', '水牌', '广告机']

/** Screen size in inches ("75寸广告机", "55 inch") and which way it stands. */
function screenOf(label: string): { inches: number | null; way: '横' | '竖' | null } {
  const inches = /(\d{2,3})\s*(?:寸|吋|英寸|inch)/i.exec(label)?.[1]
  const way = /横|horizontal/i.test(label) ? '横' : /竖|vertical/i.test(label) ? '竖' : null
  return { inches: inches ? Number(inches) : null, way }
}

/** The words of a name without sizes, units and punctuation. */
const nameWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/\d+(?:\.\d+)?\s*(?:米|mm|m|寸)?/g, '')
    .replace(/[()（）·_\-+*:：\s]/g, '')

/**
 * How well a model's name fits the label: the label's characters it shares, less a little for
 * each of its own the label lacks ("开箱桌" is an 开箱桌 rather than an 开箱储物柜; plain "收银" is
 * the plain 收银台).
 */
function likeness(label: string, asset: Asset): number {
  const want = nameWords(label)
  const own = nameWords(asset.standardName || asset.name)
  let shared = 0
  for (const ch of new Set(want)) if (own.includes(ch)) shared++
  const extra = [...own].filter((ch) => !want.includes(ch)).length
  return shared - extra * 0.1
}

/**
 * Which catalogue model a label on the plan means. An exact name (of the project's SI family
 * or 通用) wins; otherwise the function word plus a size (from the label or the drawn box)
 * narrows the family, and the name closest to the label goes first; a function word alone picks
 * the family's usual model and says so. Models without a web model stand in as placeholders
 * when the family has nothing else (screens).
 */
export function matchCatalog(
  label: string,
  catalog: readonly Asset[],
  drawnSize?: { w: number; d: number },
  siStyle?: string,
): CatalogMatch {
  const name = normaliseLabel(label)
  const fn = functionFor(name)
  // The project's own SI family first, then 通用; the other family only when nothing else fits.
  const rank = (a: Asset) => (a.siFamily === siStyle ? 0 : a.siFamily === '通用' ? 1 : 2)
  const exact = catalog
    .filter((a) => normaliseLabel(a.name) === name && !a.retired)
    .sort((a, b) => rank(a) - rank(b))[0]
  // A name of the other SI family stands for its own family's counterpart when there is one.
  const counterpart = (a: Asset) =>
    rank(a) === 2 && catalog.some((o) => o.function === a.function && usable(o) && rank(o) === 0)
  if (exact && !counterpart(exact)) {
    return { asset: exact, function: exact.function, confidence: 0.95, note: null }
  }

  if (fn === 'other') return { asset: null, function: 'other', confidence: 0.3, note: null }
  const lower = name.toLowerCase()
  // The kind named first: "75寸广告机上加logo" is a screen with a logo on it.
  const kind = KIND_WORDS.map((k) => ({ k, at: lower.indexOf(k) }))
    .filter((w) => w.at >= 0)
    .sort((p, q) => p.at - q.at)[0]?.k
  const ofKind = (a: Asset) => !kind || a.name.toLowerCase().includes(kind)
  const placeable = catalog.filter((a) => a.function === fn && usable(a) && ofKind(a))
  // Only screens stand in without a web model: a light box or a poster without one has its own
  // picture, which a drawing's label does not tell.
  const placeholders =
    fn === 'screen'
      ? catalog.filter((a) => a.function === fn && !a.retired && !a.placeable && ofKind(a))
      : []
  let family = placeable.length ? placeable : placeholders
  if (!family.length) {
    return {
      asset: null,
      function: fn,
      confidence: 0.5,
      note: '模型库中没有这类模型，已按占位处理',
    }
  }
  const placeholderNote = placeable.length ? '' : '（模型库中没有网页模型，按占位显示）'
  // Screens go by their inches and which way they stand.
  const screen = screenOf(name)
  const sized =
    screen.inches === null ? [] : family.filter((a) => a.name.includes(`${screen.inches}寸`))
  if (sized.length) family = sized
  // Screens stand landscape unless the label says otherwise.
  const turned = family.filter((a) => a.name.includes(`${screen.way ?? '横'}屏`))
  if (sized.length && turned.length) family = turned
  else if (screen.way && turned.length) family = turned
  const closer = (a: Asset, b: Asset) => likeness(name, b) - likeness(name, a)
  if (sized.length) {
    const chosen = [...family].sort((a, b) => rank(a) - rank(b) || closer(a, b))[0]
    if (chosen) {
      return {
        asset: chosen,
        function: fn,
        confidence: 0.8,
        note: `按名称与寸数对应到「${chosen.name}」${placeholderNote}`,
      }
    }
  }
  const longSide = (a: Asset) => Math.max(a.footprint.w, a.footprint.d)
  const shortSide = (a: Asset) => Math.min(a.footprint.w, a.footprint.d)
  // Same length: the depth drawn tells them apart (1.8 m side cabinets 531 or 721 deep).
  const drawnShort = drawnSize ? Math.min(drawnSize.w, drawnSize.d) : null
  const depthGap = (a: Asset) => (drawnShort === null ? 0 : Math.abs(shortSide(a) - drawnShort))
  const size = sizeInLabel(name) ?? (drawnSize ? Math.max(drawnSize.w, drawnSize.d) : null)
  if (size !== null) {
    const tolerance = sizeInLabel(name) !== null ? 0.15 : 0.25
    const gap = (a: Asset) => Math.abs(longSide(a) - size)
    const bySize = family
      .filter((a) => gap(a) <= tolerance)
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          Math.round(gap(a) * 10) - Math.round(gap(b) * 10) ||
          closer(a, b) ||
          gap(a) - gap(b) ||
          depthGap(a) - depthGap(b),
      )
    if (bySize[0]) {
      return {
        asset: bySize[0],
        function: fn,
        confidence: sizeInLabel(name) !== null ? 0.85 : 0.7,
        note: `按名称与尺寸对应到「${bySize[0].name}」${placeholderNote}`,
      }
    }
  }
  const sizes = new Set(family.map((a) => longSide(a).toFixed(1)))
  const preferred = [...family].sort((a, b) => rank(a) - rank(b) || closer(a, b))[0]
  if (sizes.size === 1 && preferred) {
    return {
      asset: preferred,
      function: fn,
      confidence: 0.65,
      note: `按名称对应到「${preferred.name}」，请确认${placeholderNote}`,
    }
  }
  return {
    asset: null,
    function: fn,
    confidence: 0.5,
    note: `「${label}」有多种尺寸（${[...sizes].sort().join(' / ')} 米），请选择型号`,
  }
}

/** Overall confidence from what was found; the engine's own estimate can only lower it. */
export function scoreDraft(draft: RecognitionDraft): number {
  const spaceScore = draft.space ? 0.4 : 0
  const scaleScore = draft.scale ? (draft.scale.verified ? 0.4 : 0.25) : 0
  const items = draft.items.filter((i) => i.source !== 'outside')
  const itemScore = items.length
    ? (items.reduce((sum, i) => sum + i.confidence, 0) / items.length) * 0.2
    : 0.2
  return Math.round(Math.min(draft.confidence, spaceScore + scaleScore + itemScore) * 1000) / 1000
}

/**
 * Checks a draft against the geometry rules and fills in the open points: a boundary that is
 * not a simple polygon is dropped, props outside the boundary are marked so, and anything the
 * user has to settle lands in `pending`. Nothing is guessed.
 */
export function checkDraft(draft: RecognitionDraft): RecognitionDraft {
  const pending = new Set(draft.pending)
  let space = draft.space
  if (space) {
    if (!isSimplePolygon(space.boundary)) {
      pending.add('识别到的边界不闭合或自相交，请重新绘制边界')
      space = null
    } else {
      const area = polygonArea(space.boundary)
      if (area < MIN_AREA_M2 || area > MAX_AREA_M2) {
        pending.add(`识别到的面积为 ${area.toFixed(1)} ㎡，不像门店尺寸，请核对比例`)
      }
      if (space.height === null) pending.add('图上没有层高，请填写')
      if (!space.entrances.length) pending.add('未找到入口，请在边界上指定')
    }
  } else {
    pending.add(
      draft.scale && draft.items.length
        ? '未能识别门店边界（可能是异形门店）：比例与道具已识别，请手动绘制边界'
        : '未能识别门店边界，请手动绘制',
    )
  }
  if (!draft.scale) pending.add('比例无法标定：请在图上指定一段已知长度')
  else if (!draft.scale.verified)
    pending.add(`比例只有一处依据（${draft.scale.reference}），请核对`)

  const items: DraftItem[] = draft.items.map((item) => {
    if (!space || item.source === 'outside') return item
    const at: [number, number] = [item.cx, item.cz]
    const inside =
      locatePoint(at, space.boundary) !== 'outside' ||
      distanceToBoundary(at, space.boundary) <= WALL_REACH_M
    if (inside) return item
    return {
      ...item,
      source: 'outside',
      note: [item.note, '位置在边界之外，按区域外处理'].filter(Boolean).join('；'),
    }
  })
  for (const item of items) {
    if (item.source !== 'outside' && !item.assetId) {
      pending.add(`「${item.label}」${item.note ? `：${item.note}` : '未对应到模型库，请选择型号'}`)
    }
  }
  const checked: RecognitionDraft = { ...draft, space, items, pending: [...pending] }
  return { ...checked, confidence: scoreDraft(checked) }
}

/** Why a draft does not pass on its own, or null when it does (需求 4.2 的失败判定). */
export function failureReason(draft: RecognitionDraft): string | null {
  if (!draft.scale) return '比例无法标定'
  if (!draft.space) return '边界不闭合'
  const area = polygonArea(draft.space.boundary)
  if (area < MIN_AREA_M2 || area > MAX_AREA_M2) {
    return `比例不合理（边界面积 ${area.toFixed(1)} ㎡）`
  }
  if (draft.confidence < RECOGNITION_MIN_CONFIDENCE) {
    return `整体置信度 ${draft.confidence.toFixed(2)} 低于 ${RECOGNITION_MIN_CONFIDENCE}`
  }
  return null
}
