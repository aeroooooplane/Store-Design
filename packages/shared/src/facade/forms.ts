import type { Market, ShopType, SiStyle } from '../enums.ts'
import { isClockwise } from '../geometry/index.ts'
import type { Point } from '../geometry/index.ts'
import type {
  CornerFacade,
  DoubleFacade,
  Facade,
  FacadeConfig,
  FacadeKind,
  HangingFacade,
} from '../schemas/facade.ts'
import { openingPieces } from '../schemas/space.ts'
import type { Space } from '../schemas/space.ts'
import { mToMm } from '../units.ts'
import { facadeGeometry, facadeRun } from './geometry.ts'
import { facadeWordmark, reviewFacade, reviewFacadeFrame } from './index.ts'

export const FACADE_KIND_LABELS: Record<FacadeKind, string> = {
  straight: '常规直边',
  corner: '转角门头',
  double: '双门头／长门头',
  island_hanging: '中岛悬吊门头',
}

export function supportsFacade(shop: ShopType, kind?: FacadeKind) {
  if (shop === 'zone') return false
  return kind === undefined || (shop === 'island') === (kind === 'island_hanging')
}

type Frame = NonNullable<ReturnType<typeof facadeGeometry>>
type Opening = { start: number; end: number; height: number }
type Screen = { start: number; width: number }
type Logo = { center: number; top: number; height: number; tilt?: number }
type Span = { a: Point; b: Point }

export interface FacadeSection {
  label: string
  frame: Frame
  fasciaBottom: number
  fasciaHeight: number
  openings: Opening[]
  screens: Screen[]
  screenInset: number
  lightStrip: boolean
  logos: Logo[]
  beamOnly?: boolean
  posts?: number
  display?: { start: number; width: number }
}

export function facadePoint(frame: Frame, distance: number): Point {
  return [
    frame.origin[0] + frame.direction[0] * distance,
    frame.origin[1] + frame.direction[1] * distance,
  ]
}

function frameSlice(frame: Frame, start: number, end: number): Frame {
  return { ...frame, origin: facadePoint(frame, start), width: end - start }
}

function cornerConnection(space: Space, a: number, b: number) {
  const { boundary } = space
  const n = boundary.length
  if (a === b || a < 0 || b < 0 || a >= n || b >= n) return null
  const distances = [a, b].map(
    (i) =>
      facadeRun(boundary, {
        a: boundary[i]!,
        b: boundary[(i + 1) % n]!,
      })?.length ?? 0,
  )
  function between(start: number, end: number) {
    const spans: Span[] = []
    const angles: number[] = []
    let length = 0
    for (let i = start; ; i = (i + 1) % n) {
      const a = boundary[i]!
      const b = boundary[(i + 1) % n]!
      angles.push(Math.atan2(b[1] - a[1], b[0] - a[0]))
      if (i === end) break
      if (i !== start) {
        length += Math.hypot(b[0] - a[0], b[1] - a[1])
        spans.push({ a, b })
      }
    }
    // A real curved/chamfered join turns consistently between the two straight faces.
    // Reject the opposite route around the shop and collinear sides.
    const turns = angles.slice(1).map((angle, i) => {
      const d = angle - angles[i]!
      return Math.atan2(Math.sin(d), Math.cos(d))
    })
    const turn = turns.reduce((sum, value) => sum + value, 0)
    if (
      Math.abs(turn) < 0.01 ||
      Math.abs(turn) >= Math.PI - 0.01 ||
      turns.some((value) => value * Math.sign(turn) < -0.01) ||
      length > Math.min(...distances)
    )
      return null
    return { spans, length }
  }
  const options = [between(a, b), between(b, a)].filter((route) => route !== null)
  return options.sort((x, y) => x.length - y.length)[0] ?? null
}

export function facadeCornerEdges(space: Space, edge: number) {
  return space.boundary.flatMap((_, other) => (cornerConnection(space, edge, other) ? [other] : []))
}

export function islandFacadeEdges(space: Space) {
  if (space.shopType === undefined) return space.boundary.map((_, edge) => edge)
  return [
    ...new Set(
      [...space.openEdges, ...space.entrances].flatMap((opening) =>
        (openingPieces(space, opening) ?? []).map((piece) => piece.edge),
      ),
    ),
  ]
}

function islandOpenRanges(space: Space, edge: number) {
  const a = space.boundary[edge]
  const b = space.boundary[(edge + 1) % space.boundary.length]
  if (!a || !b) return []
  const run = facadeRun(space.boundary, { a, b })
  if (!run) return []
  if (space.shopType === undefined) return [{ start: 0, end: run.length }]
  const coverage = [...space.openEdges, ...space.entrances]
    .flatMap((opening) =>
      (openingPieces(space, opening) ?? [])
        .filter((piece) => piece.edge === edge)
        .map((piece) => {
          const a = run.along(piece.a)
          const b = run.along(piece.b)
          return { start: Math.max(0, Math.min(a, b)), end: Math.min(run.length, Math.max(a, b)) }
        }),
    )
    .sort((a, b) => a.start - b.start)
  const ranges: typeof coverage = []
  for (const part of coverage) {
    const last = ranges.at(-1)
    if (last && part.start <= last.end + 0.003) last.end = Math.max(last.end, part.end)
    else ranges.push(part)
  }
  return ranges
}

export function islandFacadeRange(space: Space, edge: number) {
  const range = islandOpenRanges(space, edge).sort((a, b) => b.end - b.start - (a.end - a.start))[0]
  return range && { offset: range.start, width: range.end - range.start }
}

/** Check the actual selected span, including when an open side only covers part of a boundary edge. */
export function isIslandFacadeSpanOpen(space: Space, span: Span) {
  const run = facadeRun(space.boundary, span)
  return (
    !!run &&
    islandOpenRanges(space, run.edge).some(
      ({ start, end }) => run.offset >= start - 0.003 && run.offset + run.width <= end + 0.003,
    )
  )
}

function doubleOpenings(space: Space, config: DoubleFacade) {
  const frame = facadeGeometry(space, { ...config, openingWidth: 0 })
  if (!frame) return null
  const slots = config.openings
    .map((opening, i) => ({
      ...opening,
      key: i === 0 ? 'a' : 'b',
      label: i === 0 ? '开口 A' : '开口 B',
      end: opening.offset + opening.width,
    }))
    .sort((x, y) => x.offset - y.offset)
  const first = slots[0]!
  const second = slots[1]!
  if (second.end > frame.width + 0.001 || first.end > second.offset + 0.001) return null
  const gap = Math.max(0, second.offset - first.end)
  if (config.joint !== 'continuous' && gap < 0.02) return null
  return {
    frame,
    slots,
    gap,
    ranges: (config.joint === 'break'
      ? [
          [0, first.end],
          [second.offset, frame.width],
        ]
      : [[0, frame.width]]) as [number, number][],
  }
}

export function facadePlacementError(space: Space, config: FacadeConfig): string | undefined {
  if (!('kind' in config))
    return facadeRun(space.boundary, config) ? undefined : '门头需要重新定位到直边。'
  if (config.kind === 'corner') {
    const matches = config.faces.map((face) => facadeRun(space.boundary, face))
    if (!matches[0] || !matches[1] || !cornerConnection(space, matches[0].edge, matches[1].edge))
      return '请选择同一转角的两条直边。圆弧过渡沿用空间已有轮廓。'
    if (
      config.faces.some(
        (face, i) => (face.openingOffset ?? 0) + face.openingWidth > matches[i]!.width + 0.001,
      )
    )
      return '入口位置与净宽须在该面门头的总宽内。'
    return undefined
  }
  if (config.kind === 'double') {
    if (!doubleOpenings(space, config))
      return '同一立面的两个开口须在门头总宽内且不重叠。断开或中间布置展示位时，需留出至少 20 mm 间隔。'
    return undefined
  }
  if (!isIslandFacadeSpanOpen(space, config)) return '请将悬吊门头定位在地台开放段内。'
  if (config.beamHeight >= config.top) return '吊梁面高须小于门头顶部标高。'
  if ((config.postWidth ?? 0) * 2 >= facadeRun(space.boundary, config)!.width)
    return '两侧立柱不能占满悬吊段。'
  return undefined
}

export function facadePlanSpans(space: Space, shop: ShopType): Span[] {
  const config = space.facade
  if (!config || !supportsFacade(shop, 'kind' in config ? config.kind : 'straight')) return []
  if (facadePlacementError(space, config)) return []
  if (!('kind' in config)) return [config]
  if (config.kind === 'corner') {
    const [a, b] = config.faces
    const route = cornerConnection(
      space,
      facadeRun(space.boundary, a)!.edge,
      facadeRun(space.boundary, b)!.edge,
    )!
    return [a, ...route.spans, b]
  }
  if (config.kind === 'double') {
    const { frame, ranges } = doubleOpenings(space, config)!
    return ranges.map(([start, end]) => ({
      a: facadePoint(frame, start),
      b: facadePoint(frame, end),
    }))
  }
  return [config]
}

function standardSection(space: Space, facade: Facade, si: SiStyle, market: Market, logo = true) {
  const review = reviewFacade(space, facade, si, market)
  if (!review) return null
  const { frame } = review
  return {
    review,
    section: {
      label: '正看门头',
      frame,
      fasciaBottom: facade.clearHeight,
      fasciaHeight: facade.fasciaHeight,
      openings: [{ start: frame.openingStart, end: frame.openingEnd, height: facade.clearHeight }],
      screens: review.usesLed
        ? [
            {
              start: (frame.width - review.previewScreenWidth) / 2,
              width: review.previewScreenWidth,
            },
          ]
        : [],
      screenInset: facade.screenInset,
      lightStrip: review.preset === 'led_strip',
      logos: logo
        ? [
            {
              center: frame.width / 2,
              height: review.logoHeight,
              top: facade.clearHeight + review.logoOffset + review.logoHeight,
            },
          ]
        : [],
    } satisfies FacadeSection,
  }
}

function reviewCorner(space: Space, config: CornerFacade, si: SiStyle, market: Market) {
  const sections: FacadeSection[] = []
  const issues: string[] = []
  if (si === 'SI1.0') issues.push('SI1.0 双面字标沿用新加坡店案例，请逐面复核项目做法。')
  const [a, b] = config.faces
  const ar = facadeRun(space.boundary, a)!
  const br = facadeRun(space.boundary, b)!
  for (const [i, face] of config.faces.entries()) {
    const result = standardSection(space, face, si, market, face.logo)!
    const label = i === 0 ? '面 A' : '面 B'
    sections.push({ ...result.section, label })
    issues.push(
      ...result.review.issues
        .filter(
          ({ code }) => !code.startsWith('entry-') && (face.logo || !code.startsWith('logo-')),
        )
        .map(({ message }) => label + ' · ' + message),
    )
  }
  const { spans } = cornerConnection(space, ar.edge, br.edge)!
  const edgesTouch = (p: Point, face: Span) =>
    [face.a, face.b].some((end) => Math.hypot(p[0] - end[0], p[1] - end[1]) < 0.004)
  const aligned =
    spans.length > 0
      ? config.faces.every((face) =>
          spans.some((span) => edgesTouch(span.a, face) || edgesTouch(span.b, face)),
        )
      : edgesTouch(a.a, b) || edgesTouch(a.b, b)
  if (!aligned) issues.push('两个门头面与转角过渡之间有留空，请核对定位。')
  const top = Math.min(a.clearHeight + a.fasciaHeight, b.clearHeight + b.fasciaHeight)
  const bottom = Math.max(a.clearHeight, b.clearHeight)
  if (
    a.clearHeight + a.fasciaHeight > space.height + 0.001 ||
    b.clearHeight + b.fasciaHeight > space.height + 0.001
  )
    issues.push('门楣高于空间层高，请核对。')
  if (top <= bottom || a.clearHeight !== b.clearHeight || a.fasciaHeight !== b.fasciaHeight)
    issues.push('两个面的门楣标高不同，请复核转角收口。')
  if (top > bottom) {
    const clockwise = isClockwise(space.boundary)
    for (const span of spans) {
      const origin = clockwise ? span.b : span.a
      const end = clockwise ? span.a : span.b
      const width = Math.hypot(end[0] - origin[0], end[1] - origin[1])
      if (width < 0.001) continue
      const direction: Point = [(end[0] - origin[0]) / width, (end[1] - origin[1]) / width]
      const frame: Frame = {
        origin,
        direction,
        outward: [-direction[1], direction[0]],
        width,
        entryWidth: 0,
        openingStart: 0,
        openingEnd: 0,
      }
      sections.push({
        label: '弧形过渡',
        frame,
        fasciaBottom: bottom,
        fasciaHeight: top - bottom,
        openings: [],
        screens: [],
        logos: [],
        screenInset: 0,
        lightStrip: false,
        beamOnly: true,
      })
    }
  }
  return { sections, issues }
}

function reviewDouble(space: Space, config: DoubleFacade, si: SiStyle, market: Market) {
  const { frame, slots, ranges, gap } = doubleOpenings(space, config)!
  const main =
    slots.find((slot) => slot.key === config.primary) ??
    (slots[0]!.width >= slots[1]!.width ? slots[0]! : slots[1]!)
  const secondary = slots.find((slot) => slot !== main)!
  const broken = config.joint === 'break'
  const display = config.joint === 'display'
  const fire = broken && config.fireBreak
  const mode = (si === 'SI1.0' ? config.si1Logos : config.si2Logos) ?? 'auto'
  const fasciaBottom = Math.max(...slots.map((slot) => slot.clearHeight))
  const bare = { ...config, clearHeight: fasciaBottom, openingWidth: main.width }
  const review = reviewFacadeFrame(bare, frame, si, market)
  const sections: FacadeSection[] = []
  const issues = review.issues
    .filter(
      ({ code }) =>
        !['entry-link', 'entry-width', 'long', 'logo-sides', 'screen-minimum', 'si1-copy'].includes(
          code,
        ),
    )
    .map(({ message }) => message)
  if (si === 'SI1.0')
    issues.push('SI1.0 双独立 LED／双字标为成都万象城案例，字标数量和方案需按项目复核。')
  if (fasciaBottom + config.fasciaHeight > space.height + 0.001)
    issues.push('门楣高于空间层高，请核对。')
  // Separate the usable host widths even if the metal fascia is continuous.
  const divider = slots[0]!.end + gap / 2
  const autoDouble =
    si === 'SI1.0' || (!broken && !display && mToMm(frame.width) > 10000) || Boolean(fire)
  const wantsTwo = mode === 'double' || (mode === 'auto' && autoDouble)
  const singleOverall = !wantsTwo && !broken && si === 'SI2.0' && (!display || !review.usesLed)
  const fullScreen = si === 'SI2.0' && review.usesLed && !broken && (display || singleOverall)
  if (si === 'SI2.0' && !broken && mode !== 'auto' && wantsTwo !== autoDouble)
    issues.push(
      display
        ? '字标选择与 SI2.0 B03 中间展示位建议不同，请复核。'
        : '字标选择与 SI2.0 B02 的 10 m 总宽建议不同，请复核。',
    )
  if (fullScreen && slots.some((slot) => slot.screenWidth !== undefined))
    issues.push('当前 SI2.0 通长 LED 预览使用门头总宽，已录入的独立屏宽保留供分段使用。')
  if (fullScreen && review.minScreenWidth !== null && mToMm(frame.width) < review.minScreenWidth)
    issues.push('通长 LED 屏宽低于 B06 本档最小屏宽 ' + review.minScreenWidth + ' mm。')
  if (si === 'SI2.0' && broken && !fire) issues.push('门楣已断开，请按项目核对两段字标数量。')
  for (const [start, end] of ranges) {
    const sectionSlots = slots.filter(
      (slot) => slot.offset >= start - 0.001 && slot.end <= end + 0.001,
    )
    const section: FacadeSection = {
      label: '正看门头',
      frame: frameSlice(frame, start, end),
      fasciaBottom,
      fasciaHeight: config.fasciaHeight,
      openings: sectionSlots.map((slot) => ({
        start: slot.offset - start,
        end: slot.end - start,
        height: slot.clearHeight,
      })),
      screens: fullScreen ? [{ start: 0, width: end - start }] : [],
      logos: [],
      screenInset: config.screenInset,
      lightStrip: review.preset === 'led_strip',
      ...(display ? { display: { start: slots[0]!.end, width: gap } } : {}),
    }
    for (const slot of sectionSlots) {
      const hostStart = broken || slot === slots[0] ? start : divider
      const hostEnd = broken || slot === slots[1] ? end : divider
      const center = slot.offset + slot.width / 2
      const hostWidth = 2 * Math.min(center - hostStart, hostEnd - center)
      let available = fullScreen ? 2 * Math.min(center - start, end - center) : hostWidth
      if (review.usesLed && !fullScreen) {
        const requested = slot.screenWidth ?? hostWidth
        const screen = Math.min(requested, hostWidth)
        if (requested > hostWidth + 0.001)
          issues.push(slot.label + ' · 屏宽超出可用区间，预览按可用宽度裁切。')
        if (review.minScreenWidth !== null && mToMm(screen) < review.minScreenWidth) {
          issues.push(
            slot.label +
              ' · 可用屏宽 ' +
              mToMm(screen) +
              ' mm，低于 B06 最小屏宽 ' +
              review.minScreenWidth +
              ' mm。',
          )
        }
        const showScreen = !(
          si === 'SI2.0' &&
          fire &&
          slot === secondary &&
          (mToMm(slot.width) <= 3000 ||
            review.minScreenWidth === null ||
            mToMm(screen) < review.minScreenWidth)
        )
        if (!showScreen && mToMm(slot.width) <= 3000)
          issues.push(slot.label + ' · 消防断开次入口净宽须大于 3000 mm，暂不预览次入口 LED。')
        if (showScreen && screen > 0.001) {
          section.screens.push({ start: center - start - screen / 2, width: screen })
          available = screen
        } else if (!showScreen && review.minScreenWidth === null)
          issues.push(slot.label + ' · 面高未落入 B06 分档，暂不预览次入口 LED。')
      }
      if (singleOverall || (!wantsTwo && slot !== main)) continue
      if (
        si === 'SI2.0' &&
        fire &&
        slot === secondary &&
        (mToMm(slot.width) <= 3000 || available + 0.001 < review.logoWidth * 1.5)
      ) {
        issues.push(
          slot.label +
            ' · 消防断开次入口须净宽大于 3000 mm，且字标左右各留 1/4 字标总宽，暂不放置次字标。',
        )
        continue
      }
      if (available + 0.001 < review.logoWidth * 1.5)
        issues.push(slot.label + ' · 字标左右各需留 1/4 字标总宽，请复核。')
      section.logos.push({
        center: center - start,
        height: review.logoHeight,
        top: fasciaBottom + review.logoOffset + review.logoHeight,
      })
    }
    if (singleOverall) {
      section.logos.push({
        center: frame.width / 2,
        height: review.logoHeight,
        top: fasciaBottom + review.logoOffset + review.logoHeight,
      })
      if (frame.width + 0.001 < review.logoWidth * 1.5)
        issues.push('整幅居中 LOGO 左右各需留 1/4 字标总宽，请复核。')
    }
    sections.push(section)
  }
  return { sections, issues }
}

export function hangingLogoSuggestion(top: number): number | undefined {
  const mm = mToMm(top)
  if (mm < 2400 || mm >= 3200) return undefined
  return mm < 2800 ? 0.2 : mm < 3000 ? 0.25 : 0.3
}

function reviewHanging(space: Space, config: HangingFacade, si: SiStyle, market: Market) {
  const raw = facadeGeometry(space, { ...config, openingWidth: 0 })!
  const flip = (point: Point): Point => [-point[0], -point[1]]
  const frame =
    config.face === 'outward'
      ? raw
      : {
          ...raw,
          origin: facadePoint(raw, raw.width),
          direction: flip(raw.direction),
          outward: flip(raw.outward),
        }
  const manual = si === 'SI1.0'
  const suggestion = hangingLogoSuggestion(config.top)
  const height = manual ? config.si1LogoHeight : (config.si2LogoHeight ?? suggestion)
  const drop = manual ? config.si1Drop : 0.05
  const tilts =
    !manual && config.tiltInward && config.corridorRestricted && mToMm(config.top) > 3000
  const tilt = tilts ? ((config.face === 'outward' ? 1 : -1) * Math.PI) / 12 : 0
  const logoTop = config.top - config.beamHeight - (drop ?? 0)
  const clearance =
    height === undefined || drop === undefined
      ? undefined
      : logoTop - height * Math.cos(tilt) - Math.max(0, 0.025 * Math.sin(tilt))
  const issues: string[] = []
  if (manual)
    issues.push('SI1.0 手填预览 · 手册第 125 页只适用于专区且字高图文冲突，中岛方案待复核。')
  if (!manual && !suggestion) issues.push('顶部标高超出 SI2.0 第 13 页字高分档，请手填字高并复核。')
  if (
    !manual &&
    suggestion !== undefined &&
    config.si2LogoHeight !== undefined &&
    config.si2LogoHeight !== suggestion
  )
    issues.push('手填字高不同于 SI2.0 建议值，请复核。')
  if (!manual && config.tiltInward && !tilts)
    issues.push('仅在走廊受限且顶部标高高于 3000 mm 时可内倾 15°。')
  if (config.top > space.height + 0.001) issues.push('顶部标高高于空间层高，请核对。')
  if (clearance !== undefined && clearance <= 0)
    issues.push('字标最低点落到完成地面，请检查标高、字高和吊距。')
  const mark = facadeWordmark(market)
  if (height !== undefined && (height * mark.width) / mark.height > frame.width)
    issues.push('字标宽度超过悬吊段，请复核。')
  const section: FacadeSection = {
    label: '正看门头',
    frame,
    fasciaBottom: config.top - config.beamHeight,
    fasciaHeight: config.beamHeight,
    openings: [],
    screens: [],
    screenInset: 0,
    lightStrip: false,
    beamOnly: true,
    posts: config.postWidth ?? Math.min(0.09, frame.width / 4),
    logos:
      height !== undefined && clearance !== undefined && clearance > 0
        ? [{ center: frame.width / 2, top: logoTop, height, tilt }]
        : [],
  }
  return { sections: [section], issues, clearance, suggestion: manual ? undefined : suggestion }
}

export function reviewFacadeConfig(
  space: Space,
  config: FacadeConfig,
  si: SiStyle,
  market: Market,
): {
  sections: FacadeSection[]
  issues: string[]
  clearance?: number | undefined
  suggestion?: number | undefined
} | null {
  if (facadePlacementError(space, config)) return null
  if (!('kind' in config)) {
    const result = standardSection(space, config, si, market)
    return (
      result && {
        sections: [result.section],
        issues: result.review.issues.map(({ message }) => message),
      }
    )
  }
  if (config.kind === 'corner') return reviewCorner(space, config, si, market)
  if (config.kind === 'double') return reviewDouble(space, config, si, market)
  return reviewHanging(space, config, si, market)
}
