import { z } from 'zod'

/** Plan coordinates are bounded so that a corrupt payload cannot produce absurd geometry. */
export const CoordinateSchema = z.number().finite().min(-1000).max(1000)

export const PointSchema = z.tuple([CoordinateSchema, CoordinateSchema])

export const Vec3Schema = z.tuple([CoordinateSchema, CoordinateSchema, CoordinateSchema])

export const SegmentSchema = z.object({ a: PointSchema, b: PointSchema })

/** Physical size of a prop or obstacle in metres. */
export const SizeSchema = z.number().finite().positive().max(50)

export const NameSchema = z.string().trim().min(1).max(100)
