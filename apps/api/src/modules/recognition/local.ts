/**
 * Reads a plan from the text and lines of a vector PDF page (no OCR, no model): the largest
 * closed rectangle is the boundary, dimension texts next to their lines give the scale, labels
 * inside boxes give the props. Anything it cannot settle it leaves to the user.
 */

export { recognizeVector } from './local/recognize.ts'
export { dimensionMm } from './local/scale.ts'
