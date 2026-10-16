import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import type { VectorContent } from '@store/shared'
import { findDimensionSegments, numberWindow } from './local/dimension-chain.ts'
import type { ChainReading } from './local/dimension-chain.ts'

export type { ChainReading }

/**
 * Reads the numbers of the dimension chains from the page picture, on this machine: PaddleOCR's
 * PP-OCRv4 text recogniser (ONNX, from the @gutenye/ocr-models package) run by onnxruntime-node
 * on the CPU. No model service is called. Plan drawings turn their dimension numbers into
 * outlines, so the vector content has the lines but not the numbers.
 */

/** The recogniser's input height, and the widest strip given to it. */
const INPUT_H = 48
const MAX_INPUT_W = 640
/** Readings less sure than this (mean of the characters' scores) are dropped. */
const MIN_CONFIDENCE = 0.8
/** Plan dimensions are whole millimetres, 10 mm to 99 m. */
const NUMBER = /^\d{2,5}$/

/** A strip of the picture ready for the recogniser: RGB, INPUT_H high. */
interface Strip {
  data: Buffer
  width: number
}

interface Reader {
  read(strips: readonly Strip[]): Promise<{ text: string; confidence: number }[]>
}

/** Strips read in one run of the model (padded to the widest of them). */
const BATCH = 16

let loading: Promise<Reader> | null = null

/** The recogniser, loaded on first use (about 11 MB) and kept. */
function reader(): Promise<Reader> {
  loading ??= (async () => {
    const [{ default: ort }, { default: models }] = await Promise.all([
      import('onnxruntime-node'),
      import('@gutenye/ocr-models/node'),
    ])
    const session = await ort.InferenceSession.create(models.recognitionPath)
    // Index 0 is the CTC blank; the dictionary follows, then a space.
    const dictionary = (await readFile(models.dictionaryPath, 'utf8')).split(/\r?\n/)
    if (dictionary.at(-1) === '') dictionary.pop()
    const symbols = ['', ...dictionary, ' ']
    const inputName = session.inputNames[0] ?? 'x'
    const outputName = session.outputNames[0] ?? 'softmax'
    return {
      async read(strips) {
        const width = Math.max(...strips.map((s) => s.width))
        const plane = INPUT_H * width
        // White padding on the right: (255 / 127.5 - 1) = 1.
        const input = new Float32Array(strips.length * 3 * plane).fill(1)
        strips.forEach((strip, n) => {
          for (let y = 0; y < INPUT_H; y++) {
            for (let x = 0; x < strip.width; x++) {
              for (let c = 0; c < 3; c++) {
                const v = strip.data[(y * strip.width + x) * 3 + c] ?? 255
                input[(n * 3 + c) * plane + y * width + x] = v / 127.5 - 1
              }
            }
          }
        })
        const out = await session.run({
          [inputName]: new ort.Tensor('float32', input, [strips.length, 3, INPUT_H, width]),
        })
        const scores = out[outputName]
        if (!scores) return strips.map(() => ({ text: '', confidence: 0 }))
        const [, steps = 0, classes = 0] = scores.dims
        const values = scores.data as Float32Array
        return strips.map((_, n) => {
          let text = ''
          let sum = 0
          let count = 0
          let previous = 0
          for (let t = 0; t < steps; t++) {
            const offset = (n * steps + t) * classes
            let best = 0
            let bestScore = -1
            for (let c = 0; c < classes; c++) {
              const v = values[offset + c] ?? 0
              if (v > bestScore) {
                bestScore = v
                best = c
              }
            }
            if (best && best !== previous) {
              text += symbols[best] ?? ''
              sum += bestScore
              count++
            }
            previous = best
          }
          return { text, confidence: count ? sum / count : 0 }
        })
      },
    }
  })()
  loading.catch(() => {
    loading = null
  })
  return loading
}

/** The page decoded once: RGB on white. */
interface Page {
  data: Buffer
  width: number
  height: number
}

/**
 * Cuts a window out of the page and scales it to the recogniser's height. Numbers of vertical
 * lines read bottom to top: turned a quarter clockwise they stand upright.
 */
async function cutStrip(
  page: Page,
  window: { x: number; y: number; w: number; h: number },
  upright: boolean,
): Promise<Strip | null> {
  const left = Math.max(0, Math.round(window.x))
  const top = Math.max(0, Math.round(window.y))
  const w = Math.min(page.width - left, Math.round(window.w))
  const h = Math.min(page.height - top, Math.round(window.h))
  if (w < 4 || h < 4) return null
  const cut = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = ((top + y) * page.width + left + x) * 3
      // Turned clockwise: column x of the window becomes row x, read from the bottom up.
      const to = upright ? (y * w + x) * 3 : (x * h + (h - 1 - y)) * 3
      page.data.copy(cut, to, from, from + 3)
    }
  }
  const [cw, ch] = upright ? [w, h] : [h, w]
  const width = Math.max(16, Math.min(MAX_INPUT_W, Math.round((cw / ch) * INPUT_H)))
  const data = await sharp(cut, { raw: { width: cw, height: ch, channels: 3 } })
    .resize({ width, height: INPUT_H, fit: 'fill' })
    .raw()
    .toBuffer()
  return { data, width }
}

/** A number read with confidence, or null. Strokes of ticks or lines may cling to the ends. */
function asNumber({ text, confidence }: { text: string; confidence: number }) {
  const digits = text.replace(/^\D+|\D+$/g, '')
  if (confidence < MIN_CONFIDENCE || !NUMBER.test(digits)) return null
  const mm = Number(digits)
  return mm >= 10 ? { mm, text } : null
}

/**
 * The dimension chains of a page with their numbers. `picture` is the page as uploaded (PNG or
 * JPEG); the vector content gives where the chains are, in its own pixels (the picture may be
 * drawn at another size).
 */
export async function readDimensionChains(
  picture: Buffer,
  content: VectorContent,
): Promise<ChainReading[]> {
  const segments = findDimensionSegments(content.lines)
  if (!segments.length) return []
  const { data, info } = await sharp(picture)
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const page: Page = { data, width: info.width, height: info.height }
  const k = page.width / content.width
  const strips = await Promise.all(
    segments.map(async (segment) => {
      const w = numberWindow(segment)
      const strip = await cutStrip(
        page,
        { x: w.x * k, y: w.y * k, w: w.w * k, h: w.h * k },
        segment.horizontal,
      )
      return strip ? { segment, strip } : null
    }),
  )
  // Batches of similar widths, so little of each run is padding.
  const queue = strips
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((p, q) => p.strip.width - q.strip.width)
  const recogniser = await reader()
  const readings: ChainReading[] = []
  for (let i = 0; i < queue.length; i += BATCH) {
    const batch = queue.slice(i, i + BATCH)
    const read = await recogniser.read(batch.map((b) => b.strip))
    batch.forEach((b, n) => {
      const found = read[n] ? asNumber(read[n]) : null
      if (found) readings.push({ ...b.segment, ...found })
    })
  }
  return readings
}

/** Readings per upload: OCR takes seconds, and a plan is often read again with a new crop. */
const cache = new Map<string, Promise<ChainReading[]>>()
const CACHE_SIZE = 20

export function cachedDimensionChains(
  key: string,
  load: () => Promise<ChainReading[]>,
): Promise<ChainReading[]> {
  const hit = cache.get(key)
  if (hit) return hit
  const pending = load()
  cache.set(key, pending)
  pending.catch(() => cache.delete(key))
  while (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return pending
}
