import path from 'node:path'
import { z } from 'zod'

/**
 * Records of the light model copies (`white.json`, `finish.json`) next to each `model.glb`.
 * Kept apart from the builders so that the catalogue import does not load the glTF tooling.
 */
const LightRecordSchema = z.object({
  tool: z.string(),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.int().positive(),
  sourceBytes: z.int().positive(),
  trianglesBefore: z.int().min(0),
  trianglesAfter: z.int().min(0),
  driftM: z.number().min(0),
})

export const WhiteRecordSchema = LightRecordSchema
export type WhiteRecord = z.infer<typeof WhiteRecordSchema>

export const FinishRecordSchema = LightRecordSchema.extend({
  drawsBefore: z.int().min(0),
  drawsAfter: z.int().min(0),
  /** Textured patches turned into plain colours. */
  specks: z.int().min(0),
  /** Triangles that are one side of a two-sided SketchUp face. */
  pairedTriangles: z.int().min(0),
})
export type FinishRecord = z.infer<typeof FinishRecordSchema>

export type LightKind = 'white' | 'finish'

/** Where a light model and its record live, next to `model.glb`. */
export function lightPaths(modelDir: string, kind: LightKind) {
  return {
    source: path.join(modelDir, 'model.glb'),
    glb: path.join(modelDir, `${kind}.glb`),
    record: path.join(modelDir, `${kind}.json`),
  }
}
