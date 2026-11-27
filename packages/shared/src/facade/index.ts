import type { Market, SiStyle } from '../enums.ts'
import type { Facade, FacadePreset } from '../schemas/facade.ts'
import type { Space } from '../schemas/space.ts'
import { mToMm } from '../units.ts'
import { facadeGeometry } from './geometry.ts'
import logoArt from './logo-art.json' with { type: 'json' }

export {
  facadeRun,
  facadeSpan,
  facadeEdgeSize,
  suggestedFacadeEdge,
  facadeGeometry,
} from './geometry.ts'

export const FACADE_PRESET_LABELS: Record<FacadePreset, string> = {
  steel: '不锈钢＋LOGO',
  aluminium: '星空灰铝板＋LOGO',
  led: 'LED 屏＋LOGO',
  led_strip: 'LED 屏＋灯带＋LOGO',
}

export function facadeWordmark(market: Market) {
  return logoArt[market]
}

function recommendPreset(facade: Facade, si: SiStyle): FacadePreset {
  if (si === 'SI1.0') {
    return mToMm(facade.fasciaHeight) > 600 &&
      facade.si1?.grade !== 'A2' &&
      facade.si1?.grade !== 'B'
      ? 'led'
      : 'steel'
  }
  if (facade.si2?.grade === 'S') return 'led_strip'
  if (facade.si2?.grade === 'A') return 'led'
  return 'aluminium'
}

export interface FacadeReviewIssue {
  code: string
  message: string
}

const LED_SI2_WIDTHS = [3520, 4800, 5440] as const

/** SI1 PDF pp.120–125, SI2 PDF pp.8–17 and 141/147–148. Dimensions are measured from the lease line. */
export function reviewFacade(space: Space, facade: Facade, si: SiStyle, market: Market) {
  const frame = facadeGeometry(space, facade)
  if (!frame) return null
  const recommended = recommendPreset(facade, si)
  const preset = (si === 'SI1.0' ? facade.si1?.preset : facade.si2?.preset) ?? recommended
  const usesLed = preset === 'led' || preset === 'led_strip'
  const height = mToMm(facade.fasciaHeight)
  const width = mToMm(frame.width)
  const tier = height < 600 ? 0 : height < 800 ? 1 : 2
  const logoHeight = ([300, 400, 450] as const)[tier] / 1000
  const mark = facadeWordmark(market)
  const logoWidth = (logoHeight * mark.width) / mark.height
  // SI2 aligns the foot of the wordmark with its lower frame. The visual frame is 40 mm.
  const logoOffset = usesLed
    ? si === 'SI1.0'
      ? 0
      : preset === 'led_strip'
        ? 0.04
        : 0.02
    : (facade.fasciaHeight - logoHeight) / 2
  const screenWidth = facade.screenWidth ?? frame.width
  const previewScreenWidth = Math.min(frame.width, screenWidth)
  const minScreenWidth =
    si === 'SI2.0' && usesLed && height >= 550 && height < 1000 ? LED_SI2_WIDTHS[tier] : null
  const issues: FacadeReviewIssue[] = []
  const add = (code: string, message: string) => issues.push({ code, message })
  if (si === 'SI1.0') {
    if (height < 400 || height >= 1000)
      add('height-si1', '门楣面高在常规字高分档之外，需核对手册及现场。')
    if (height === 600)
      add('si1-selection', '正好 600 mm 时，不锈钢和 LED 两个选型范围重叠，需复核。')
    if (usesLed && height < 600)
      add('si1-led-height', 'SI1.0 选型图中 LED 门楣面高从 600 mm 起，需复核。')
    if (height >= 600 && width === 8000 && (usesLed || recommended === 'led'))
      add('si1-copy-edge', '门头总宽正好 8000 mm，手册正文和示意标注的副标边界不同。')
    if (usesLed && height >= 600 && width > 8000)
      add('si1-copy', '可做 LED 且门头大于 8000 mm，手册要求复核右下方品牌副标。')
    if (usesLed && (facade.si1?.grade === 'A2' || facade.si1?.grade === 'B'))
      add('grade', '当前 SI1.0 分级以不锈钢或冷板为主，请复核 LED 选型。')
  } else {
    if (usesLed && (height < 550 || height >= 1000))
      add('si2-led-height', 'SI2.0 LED 常规尺寸分档为 550–999 mm，当前面高需复核。')
    if (!usesLed && height < 400)
      add(
        'si2-low',
        height < 300
          ? '面高小于 300 mm，手册指向特殊悬吊形式。'
          : '300–399 mm 可选铝板基底，手册另建议悬吊 LOGO，请复核。',
      )
    if (!usesLed && height >= 1000)
      add('si2-plate-height', '门楣面高超出常规铝板 LOGO 字高分档，需复核。')
    if (facade.si2?.grade && preset !== recommended)
      add('grade', '当前款式与录入的 SI2.0 门店等级建议不同，请复核。')
    if (width > 10000) add('long', '门头超过 10 m，手册建议结合入口评估双 LOGO。')
  }
  if (usesLed && mToMm(screenWidth) > width)
    add('screen-fit', `屏宽 ${mToMm(screenWidth)} mm 超过门头总宽 ${width} mm。`)
  if (minScreenWidth !== null && mToMm(previewScreenWidth) < minScreenWidth)
    add(
      'screen-minimum',
      `可用屏宽 ${mToMm(previewScreenWidth)} mm，低于 SI2.0 本档最小屏宽 ${minScreenWidth} mm，差 ${minScreenWidth - mToMm(previewScreenWidth)} mm。`,
    )
  const logoHostWidth = usesLed ? previewScreenWidth : frame.width
  if (logoHostWidth + 0.001 < logoWidth * 1.5)
    add('logo-sides', 'LOGO 左右各应至少留出字标总宽的 1/4，当前可用宽度不足。')
  if (usesLed) {
    if (mToMm(facade.fasciaHeight - logoOffset - logoHeight) < 150)
      add('logo-top', 'LED 款 LOGO 上方应至少留出 150 mm。')
  } else if (mToMm(logoOffset) < 80) {
    add(
      'logo-top-bottom',
      `板面居中的 ${mToMm(logoHeight)} mm LOGO，上下各只有 ${Math.max(0, mToMm(logoOffset))} mm，要求各至少 80 mm。`,
    )
  }
  if (!frame.entryWidth) {
    add('entry-link', '所选门头段没有覆盖主入口，请核对位置及现场入口。')
  } else if (Math.abs(frame.entryWidth - facade.openingWidth) > 0.02) {
    add(
      'entry-width',
      `当前门头净宽与平面主入口重叠段宽度（${mToMm(frame.entryWidth)} mm）不同，请核对。`,
    )
  }
  return {
    frame,
    preset,
    usesLed,
    logoHeight,
    logoWidth,
    logoOffset,
    previewScreenWidth,
    minScreenWidth,
    issues,
  }
}
