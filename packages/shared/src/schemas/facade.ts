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

export type Facade = z.output<typeof FacadeSchema>
export type FacadePreset = (typeof SI1_FACADE_PRESETS)[number] | (typeof SI2_FACADE_PRESETS)[number]
