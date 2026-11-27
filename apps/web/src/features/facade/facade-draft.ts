import {
  CornerFacadeSchema,
  DoubleFacadeSchema,
  HangingFacadeSchema,
  facadeCornerEdges,
  facadeEdgeSize,
  facadeRun,
  facadeSpan,
  islandFacadeEdges,
  islandFacadeRange,
  mToMm,
  mmToM,
  suggestedFacadeEdge,
} from '@store/shared'
import type {
  DoubleFacade,
  FacadeConfig,
  FacadeFace,
  FacadeKind,
  HangingFacade,
  Space,
} from '@store/shared'
import type { FacadeSettings } from './FacadeFields.tsx'

export const facadeMm = (value: number | undefined) =>
  value === undefined ? '' : String(mToMm(value))
const metres = (value: string) => (value.trim() === '' ? NaN : mmToM(Number(value)))
const optional = (value: string) => (value.trim() === '' ? undefined : metres(value))
type Span = { a: FacadeFace['a']; b: FacadeFace['b'] }

type SpanDraft = { edge: number; offset: string; width: string }
type FaceDraft = SpanDraft &
  FacadeSettings & {
    clearHeight: string
    fasciaHeight: string
    openingWidth: string
    openingOffset: string
    screenInset: string
    screenWidth: string
    logo: boolean
  }
type SlotDraft = { offset: string; width: string; clearHeight: string; screenWidth: string }
export type DoubleDraft = SpanDraft &
  FacadeSettings & {
    kind: 'double'
    openings: [SlotDraft, SlotDraft]
    joint: DoubleFacade['joint']
    fireBreak: boolean
    primary: NonNullable<DoubleFacade['primary']>
    si1Logos: NonNullable<DoubleFacade['si1Logos']>
    si2Logos: NonNullable<DoubleFacade['si2Logos']>
    fasciaHeight: string
    screenInset: string
  }
export type IslandDraft = SpanDraft & {
  kind: 'island_hanging'
  face: HangingFacade['face']
  top: string
  beamHeight: string
  postWidth: string
  si1LogoHeight: string
  si1Drop: string
  si2LogoHeight: string
  corridorRestricted: boolean
  tiltInward: boolean
}
export type FormsDraft =
  { kind: 'corner'; faces: [FaceDraft, FaceDraft] } | DoubleDraft | IslandDraft
export type { FaceDraft, SpanDraft }

function position(space: Space, edge: number, span?: Span, island = false): SpanDraft {
  const run = span && facadeRun(space.boundary, span)
  const range = island
    ? islandFacadeRange(space, edge)
    : { offset: 0, width: facadeEdgeSize(space, edge).length }
  return {
    edge: run?.edge ?? edge,
    offset: facadeMm(run?.offset ?? range?.offset),
    width: facadeMm(run?.width ?? range?.width),
  }
}

export function moveFacadeSpan(space: Space, edge: number, island = false) {
  return position(space, edge, undefined, island)
}

export function validFacadeEdges(space: Space) {
  return space.boundary.flatMap((_, edge) =>
    facadeEdgeSize(space, edge).length >= 0.1 ? [edge] : [],
  )
}

export function defaultCornerB(space: Space, edge: number) {
  return (
    facadeCornerEdges(space, edge).sort(
      (a, b) => facadeEdgeSize(space, b).length - facadeEdgeSize(space, a).length,
    )[0] ?? -1
  )
}

export function defaultDoubleOpenings(space: Space, width: number): DoubleDraft['openings'] {
  const mm = Math.round(width * 1000)
  const gap = Math.round(mm * 0.12)
  const entry = Math.floor((mm - gap) / 2)
  const clearHeight = facadeMm(Math.max(0.1, space.height - 0.6))
  return [
    { offset: '0', width: String(entry), clearHeight, screenWidth: '' },
    { offset: String(entry + gap), width: String(mm - gap - entry), clearHeight, screenWidth: '' },
  ]
}

export function placeFacadeFace(space: Space, edge: number): FaceDraft {
  return {
    ...position(space, edge),
    clearHeight: facadeMm(Math.max(0.1, space.height - 0.6)),
    fasciaHeight: '600',
    openingWidth: facadeMm(facadeEdgeSize(space, edge).openingWidth),
    openingOffset: '',
    screenInset: '50',
    screenWidth: '',
    logo: true,
  }
}

export function initialFormDraft(space: Space, kind: Exclude<FacadeKind, 'straight'>): FormsDraft {
  const stored = space.facade && 'kind' in space.facade ? space.facade : undefined
  const edge = suggestedFacadeEdge(space)
  if (kind === 'corner') {
    const wrap = (face: FacadeFace): FaceDraft => ({
      ...position(space, -1, face),
      openingWidth: facadeMm(face.openingWidth),
      openingOffset: facadeMm(face.openingOffset),
      clearHeight: facadeMm(face.clearHeight),
      fasciaHeight: facadeMm(face.fasciaHeight),
      screenInset: facadeMm(face.screenInset),
      screenWidth: facadeMm(face.screenWidth),
      si1: face.si1,
      si2: face.si2,
      logo: face.logo,
    })
    if (stored?.kind === kind)
      return { kind, faces: [wrap(stored.faces[0]), wrap(stored.faces[1])] }
    return {
      kind,
      faces: [placeFacadeFace(space, edge), placeFacadeFace(space, defaultCornerB(space, edge))],
    }
  }
  if (kind === 'double') {
    const config = stored?.kind === kind ? stored : undefined
    const slots = config?.openings
    const wrap = (slot: NonNullable<typeof slots>[number]) => ({
      offset: facadeMm(slot.offset),
      width: facadeMm(slot.width),
      clearHeight: facadeMm(slot.clearHeight),
      screenWidth: facadeMm(slot.screenWidth),
    })
    return {
      kind,
      ...position(space, edge, config),
      openings: slots
        ? [wrap(slots[0]), wrap(slots[1])]
        : defaultDoubleOpenings(space, facadeEdgeSize(space, edge).length),
      joint: config?.joint ?? 'continuous',
      fireBreak: config?.fireBreak ?? false,
      primary: config?.primary ?? 'auto',
      si1Logos: config?.si1Logos ?? 'auto',
      si2Logos: config?.si2Logos ?? 'auto',
      fasciaHeight: facadeMm(config?.fasciaHeight ?? 0.6),
      screenInset: facadeMm(config?.screenInset ?? 0.05),
      si1: config?.si1,
      si2: config?.si2,
    }
  }
  const config = stored?.kind === kind ? stored : undefined
  const islandEdge =
    islandFacadeEdges(space).sort(
      (a, b) =>
        (islandFacadeRange(space, b)?.width ?? 0) - (islandFacadeRange(space, a)?.width ?? 0),
    )[0] ?? -1
  return {
    kind,
    ...position(space, islandEdge, config, true),
    top: facadeMm(config?.top ?? Math.min(space.height, 3.1)),
    beamHeight: facadeMm(config?.beamHeight ?? 0.25),
    postWidth: facadeMm(config?.postWidth ?? 0.09),
    face: config?.face ?? 'outward',
    si1LogoHeight: facadeMm(config?.si1LogoHeight),
    si1Drop: facadeMm(config?.si1Drop),
    si2LogoHeight: facadeMm(config?.si2LogoHeight),
    corridorRestricted: config?.corridorRestricted ?? false,
    tiltInward: config?.tiltInward ?? false,
  }
}

function settings(value: FacadeSettings) {
  return {
    ...(value.si1?.grade || value.si1?.preset ? { si1: value.si1 } : {}),
    ...(value.si2?.grade || value.si2?.preset ? { si2: value.si2 } : {}),
  }
}

export function parseFormDraft(space: Space, draft: FormsDraft): FacadeConfig | undefined {
  const span = (value: SpanDraft) =>
    facadeSpan(space.boundary, value.edge, metres(value.offset), metres(value.width))
  if (draft.kind === 'corner') {
    const result = CornerFacadeSchema.safeParse({
      kind: draft.kind,
      faces: draft.faces.map((face) => ({
        ...span(face),
        ...settings(face),
        openingWidth: metres(face.openingWidth),
        openingOffset: optional(face.openingOffset),
        clearHeight: metres(face.clearHeight),
        fasciaHeight: metres(face.fasciaHeight),
        screenWidth: optional(face.screenWidth),
        screenInset: metres(face.screenInset),
        logo: face.logo,
      })),
    })
    return result.data
  }
  if (draft.kind === 'double') {
    const result = DoubleFacadeSchema.safeParse({
      ...span(draft),
      ...settings(draft),
      kind: draft.kind,
      fasciaHeight: metres(draft.fasciaHeight),
      screenInset: metres(draft.screenInset),
      joint: draft.joint,
      fireBreak: draft.fireBreak,
      primary: draft.primary,
      si1Logos: draft.si1Logos,
      si2Logos: draft.si2Logos,
      openings: draft.openings.map((slot) => ({
        offset: metres(slot.offset),
        width: metres(slot.width),
        clearHeight: metres(slot.clearHeight),
        screenWidth: optional(slot.screenWidth),
      })),
    })
    return result.data
  }
  const result = HangingFacadeSchema.safeParse({
    kind: draft.kind,
    ...span(draft),
    top: metres(draft.top),
    beamHeight: metres(draft.beamHeight),
    postWidth: metres(draft.postWidth),
    face: draft.face,
    si1LogoHeight: optional(draft.si1LogoHeight),
    si1Drop: optional(draft.si1Drop),
    si2LogoHeight: optional(draft.si2LogoHeight),
    corridorRestricted: draft.corridorRestricted,
    tiltInward: draft.tiltInward,
  })
  return result.data
}
