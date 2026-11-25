import sharp from 'sharp'
import { buildDisplayPresentation } from './deck-template.ts'
import type { DeckImage, DisplayDeckInput } from './deck-template.ts'

export type { DeckImage, DeckMark, DisplayDeckInput, InnerTrayImages } from './deck-template.ts'

/** Shrinks a PNG/JPEG for embedding (JPEG, longest side ≤ maxSide) and reads its size. */
export async function deckImage(data: Buffer, maxSide = 1600): Promise<DeckImage> {
  const { data: jpeg, info } = await sharp(data)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true })
  return {
    data: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    width: info.width,
    height: info.height,
  }
}

export async function buildDisplayDeck(input: DisplayDeckInput): Promise<Buffer> {
  return (await buildDisplayPresentation(input).write({ outputType: 'nodebuffer' })) as Buffer
}
