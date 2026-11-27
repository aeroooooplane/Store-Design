import { z } from 'zod'
import { PointSchema } from './common.ts'

export const SI1_FACADE_PRESETS = ['steel', 'led'] as const
export const SI2_FACADE_PRESETS = ['aluminium', 'led', 'led_strip'] as const
export const SI1_FACADE_GRADES = ['S', 'A1', 'A2', 'B'] as const
export const SI2_FACADE_GRADES = ['S', 'A', 'B', 'C'] as const

/** Dimensions in metres. The façade span attaches to a single straight lease-line edge. */
export const FacadeSchema = z.object({
  a: PointSchema,
  b: PointSchema,
  openingWidth: z.number().min(0.1).max(200),
  clearHeight: z.number().min(0.1).max(20),
  fasciaHeight: z.number().min(0.05).max(5),
  screenWidth: z.number().min(0.05).max(200).optional(),
  screenInset: z.number().min(0).max(2),
  si1: z
    .object({
      grade: z.enum(SI1_FACADE_GRADES).optional(),
      preset: z.enum(SI1_FACADE_PRESETS).optional(),
    })
    .optional(),
  si2: z
    .object({
      grade: z.enum(SI2_FACADE_GRADES).optional(),
      preset: z.enum(SI2_FACADE_PRESETS).optional(),
    })
    .optional(),
})

const OpeningSlotSchema = z.object({
  /** Measured from the left when looking at the frontage from outside. */
  offset: z.number().min(0).max(200),
  width: z.number().min(0.1).max(200),
  clearHeight: z.number().min(0.1).max(20),
  screenWidth: z.number().min(0.05).max(200).optional(),
})

const LogoModeSchema = z.enum(['auto', 'single', 'double'])
export const FacadeFaceSchema = FacadeSchema.extend({
  logo: z.boolean(),
  openingOffset: OpeningSlotSchema.shape.offset.optional(),
})
export const CornerFacadeSchema = z.object({
  kind: z.literal('corner'),
  faces: z.tuple([FacadeFaceSchema, FacadeFaceSchema]),
})
export const DoubleFacadeSchema = FacadeSchema.omit({
  openingWidth: true,
  clearHeight: true,
  screenWidth: true,
}).extend({
  kind: z.literal('double'),
  joint: z.enum(['continuous', 'display', 'break']),
  fireBreak: z.boolean().optional(),
  primary: z.enum(['auto', 'a', 'b']).optional(),
  openings: z.tuple([OpeningSlotSchema, OpeningSlotSchema]),
  si1Logos: LogoModeSchema.optional(),
  si2Logos: LogoModeSchema.optional(),
})
const ManualLogoHeightSchema = z.number().min(0.05).max(2)
export const HangingFacadeSchema = z.object({
  kind: z.literal('island_hanging'),
  a: PointSchema,
  b: PointSchema,
  top: z.number().min(0.1).max(20),
  beamHeight: z.number().min(0.05).max(5),
  postWidth: z.number().min(0).max(2).optional(),
  face: z.enum(['outward', 'inward']),
  si1LogoHeight: ManualLogoHeightSchema.optional(),
  si1Drop: z.number().min(0).max(2).optional(),
  si2LogoHeight: ManualLogoHeightSchema.optional(),
  corridorRestricted: z.boolean().optional(),
  tiltInward: z.boolean().optional(),
})

export const FacadeConfigSchema = z.union([
  CornerFacadeSchema,
  DoubleFacadeSchema,
  HangingFacadeSchema,
  FacadeSchema,
])

export type Facade = z.output<typeof FacadeSchema>
export type FacadeFace = z.output<typeof FacadeFaceSchema>
export type CornerFacade = z.output<typeof CornerFacadeSchema>
export type DoubleFacade = z.output<typeof DoubleFacadeSchema>
export type HangingFacade = z.output<typeof HangingFacadeSchema>
export type FacadeConfig = z.output<typeof FacadeConfigSchema>
export type FacadeKind = 'straight' | Exclude<FacadeConfig, Facade>['kind']
export function facadeKind(facade: FacadeConfig): FacadeKind {
  return 'kind' in facade ? facade.kind : 'straight'
}
export function isStraightFacade(facade: FacadeConfig): facade is Facade {
  return !('kind' in facade)
}
export type FacadePreset = (typeof SI1_FACADE_PRESETS)[number] | (typeof SI2_FACADE_PRESETS)[number]
