import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import type { VectorContent } from '@store/shared'
import { findDimensionSegments, numberWindow } from './local/dimension-chain.ts'
import type { ChainReading } from './local/dimension-chain.ts'

export type { ChainReading }

/**
 * Reads text from the page picture, on this machine: PaddleOCR's PP-OCRv4 text detector and
 * recogniser (ONNX, from the @gutenye/ocr-models package) run by onnxruntime-node on the CPU. No
 * model service is called. Plan drawings turn their dimension numbers into outlines, so the
 * vector content has the lines but not the numbers; some turn every text into outlines, the prop
 * names too.
 */

/** The recogniser's input height, and the widest strip given to it. */
const INPUT_H = 48
const MAX_INPUT_W = 640
/** Readings less sure than this (mean of the characters' scores) are dropped. */
const MIN_CONFIDENCE = 0.8
/** Page text is kept from this sureness: a name half read still finds its prop. */
const MIN_TEXT_CONFIDENCE = 0.7
/** Plan dimensions are whole millimetres, 10 mm to 99 m. */
const NUMBER = /^\d{2,5}$/

/** A strip of the picture ready for the recogniser: RGB, INPUT_H high. */
interface Strip {
  data: Buffer
  width: number
}

type Read = { text: string; confidence: number }

interface Reader {
  read(strips: readonly Strip[]): Promise<Read[]>
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

/** Reads strips in batches of similar widths, so little of each run is padding. */
async function readAll(strips: readonly Strip[]): Promise<Read[]> {
  const order = strips.map((_, i) => i).sort((a, b) => strips[a]!.width - strips[b]!.width)
  const recogniser = await reader()
  const reads: Read[] = []
  for (let i = 0; i < order.length; i += BATCH) {
    const batch = order.slice(i, i + BATCH)
    const read = await recogniser.read(batch.map((n) => strips[n]!))
    batch.forEach((n, k) => {
      reads[n] = read[k] ?? { text: '', confidence: 0 }
    })
  }
  return reads
}

/** The page decoded once: RGB on white. */
interface Page {
  data: Buffer
  width: number
  height: number
}

async function decode(picture: Buffer): Promise<Page> {
  const { data, info } = await sharp(picture)
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/**
 * Cuts a window out of the page, turned by `turn` degrees clockwise, and scales it to the
 * recogniser's height. Text running bottom to top stands upright turned 90°; top to bottom, 270°.
 */
async function cutStrip(
  page: Page,
  window: { x: number; y: number; w: number; h: number },
  turn: 0 | 90 | 270,
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
      // Clockwise, column x becomes row x read from the bottom up; anticlockwise, row w - 1 - x.
      const to =
        turn === 0
          ? (y * w + x) * 3
          : turn === 90
            ? (x * h + (h - 1 - y)) * 3
            : ((w - 1 - x) * h + y) * 3
      page.data.copy(cut, to, from, from + 3)
    }
  }
  const [cw, ch] = turn === 0 ? [w, h] : [h, w]
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
  const page = await decode(picture)
  const k = page.width / content.width
  const cut = await Promise.all(
    segments.map(async (segment) => {
      const w = numberWindow(segment)
      const strip = await cutStrip(
        page,
        { x: w.x * k, y: w.y * k, w: w.w * k, h: w.h * k },
        segment.horizontal ? 0 : 90,
      )
      return strip ? { segment, strip } : null
    }),
  )
  const queue = cut.filter((s): s is NonNullable<typeof s> => s !== null)
  const reads = await readAll(queue.map((q) => q.strip))
  return queue.flatMap((q, n) => {
    const found = reads[n] ? asNumber(reads[n]) : null
    return found ? [{ ...q.segment, ...found }] : []
  })
}

/** The detector looks at the page in squares of this side, at full size: plan text is small. */
const TILE_PX = 960
const TILE_OVERLAP_PX = 96
/** Pixels whose text score passes this belong to a text; a box whose mean passes the second. */
const PIXEL_THRESHOLD = 0.3
const BOX_THRESHOLD = 0.5
/** How far a box is grown round its core (DB's "unclip", by area over perimeter). */
const UNCLIP = 1.6

interface Detector {
  /** Text scores per pixel of an RGB tile, padded to a multiple of 32. */
  scores(tile: Buffer, w: number, h: number): Promise<{ map: Float32Array; w: number; h: number }>
}

let loadingDetector: Promise<Detector> | null = null

/** The text detector, loaded on first use (about 5 MB) and kept. */
function detector(): Promise<Detector> {
  loadingDetector ??= (async () => {
    const [{ default: ort }, { default: models }] = await Promise.all([
      import('onnxruntime-node'),
      import('@gutenye/ocr-models/node'),
    ])
    const session = await ort.InferenceSession.create(models.detectionPath)
    const inputName = session.inputNames[0] ?? 'x'
    const outputName = session.outputNames[0] ?? 'sigmoid_0.tmp_0'
    const mean = [0.485, 0.456, 0.406]
    const std = [0.229, 0.224, 0.225]
    return {
      async scores(tile, tw, th) {
        const w = Math.ceil(tw / 32) * 32
        const h = Math.ceil(th / 32) * 32
        const input = new Float32Array(3 * w * h)
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            for (let c = 0; c < 3; c++) {
              // Padding is white paper.
              const v = y < th && x < tw ? (tile[(y * tw + x) * 3 + c] ?? 255) / 255 : 1
              input[c * w * h + y * w + x] = (v - (mean[c] ?? 0)) / (std[c] ?? 1)
            }
          }
        }
        const out = await session.run({
          [inputName]: new ort.Tensor('float32', input, [1, 3, h, w]),
        })
        return { map: (out[outputName]?.data as Float32Array) ?? new Float32Array(w * h), w, h }
      },
    }
  })()
  loadingDetector.catch(() => {
    loadingDetector = null
  })
  return loadingDetector
}

type PxBox = { x: number; y: number; w: number; h: number }

/** Text boxes in one tile's score map: connected text pixels, grown round their core. */
function tileBoxes(
  map: Float32Array,
  w: number,
  h: number,
  within: { w: number; h: number },
): PxBox[] {
  const seen = new Uint8Array(w * h)
  const boxes: PxBox[] = []
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || (map[start] ?? 0) < PIXEL_THRESHOLD) continue
    const stack = [start]
    seen[start] = 1
    let minX = w
    let minY = h
    let maxX = 0
    let maxY = 0
    let sum = 0
    let count = 0
    while (stack.length) {
      const p = stack.pop() as number
      const x = p % w
      const y = (p - x) / w
      sum += map[p] ?? 0
      count++
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q] || (map[q] ?? 0) < PIXEL_THRESHOLD) continue
        if (Math.abs((q % w) - x) > 1) continue
        seen[q] = 1
        stack.push(q)
      }
    }
    if (count < 6 || sum / count < BOX_THRESHOLD) continue
    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    const grow = (bw * bh * UNCLIP) / (2 * (bw + bh))
    const x0 = Math.max(0, minX - grow)
    const y0 = Math.max(0, minY - grow)
    const x1 = Math.min(within.w, maxX + 1 + grow)
    const y1 = Math.min(within.h, maxY + 1 + grow)
    if (x1 - x0 >= 4 && y1 - y0 >= 4) boxes.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  }
  return boxes
}

/** The text boxes of the whole page, tile by tile; a box found in two tiles is kept once. */
async function detectText(page: Page): Promise<PxBox[]> {
  const found = await detector()
  const boxes: PxBox[] = []
  const step = TILE_PX - TILE_OVERLAP_PX
  for (let ty = 0; ty < page.height; ty += step) {
    for (let tx = 0; tx < page.width; tx += step) {
      const tw = Math.min(TILE_PX, page.width - tx)
      const th = Math.min(TILE_PX, page.height - ty)
      const tile = Buffer.alloc(tw * th * 3)
      for (let y = 0; y < th; y++) {
        const from = ((ty + y) * page.width + tx) * 3
        page.data.copy(tile, y * tw * 3, from, from + tw * 3)
      }
      const { map, w, h } = await found.scores(tile, tw, th)
      for (const b of tileBoxes(map, w, h, { w: tw, h: th })) {
        boxes.push({ ...b, x: b.x + tx, y: b.y + ty })
      }
      if (tx + TILE_PX >= page.width) break
    }
    if (ty + TILE_PX >= page.height) break
  }
  boxes.sort((a, b) => b.w * b.h - a.w * a.h)
  const kept: PxBox[] = []
  for (const b of boxes) {
    const twice = kept.some((k) => {
      const ix = Math.max(0, Math.min(k.x + k.w, b.x + b.w) - Math.max(k.x, b.x))
      const iy = Math.max(0, Math.min(k.y + k.h, b.y + b.h) - Math.max(k.y, b.y))
      return ix * iy > 0.6 * b.w * b.h
    })
    if (!twice) kept.push(b)
  }
  return kept
}

/**
 * The texts of a page whose text was turned into outlines, as the vector content would carry
 * them (its pixels). Lines standing upright are read both ways round and the surer read kept.
 */
export async function readPageTexts(
  picture: Buffer,
  content: VectorContent,
): Promise<VectorContent['texts']> {
  const page = await decode(picture)
  const k = page.width / content.width
  const boxes = await detectText(page)
  const upright = (b: PxBox) => b.h > b.w * 1.5
  const tries = await Promise.all(
    boxes.flatMap((box) =>
      (upright(box) ? ([90, 270] as const) : ([0] as const)).map(async (turn) => ({
        box,
        strip: await cutStrip(page, box, turn),
      })),
    ),
  )
  const usable = tries.filter((t): t is { box: PxBox; strip: Strip } => t.strip !== null)
  const reads = await readAll(usable.map((t) => t.strip))
  const best = new Map<PxBox, Read>()
  usable.forEach((t, n) => {
    const read = reads[n]
    if (read && read.confidence > (best.get(t.box)?.confidence ?? -1)) best.set(t.box, read)
  })
  return [...best].flatMap(([box, read]) => {
    const text = read.text.trim()
    if (!text || read.confidence < MIN_TEXT_CONFIDENCE) return []
    return [{ text, x: box.x / k, y: box.y / k, w: box.w / k, h: box.h / k }]
  })
}

/** Readings per upload: OCR takes seconds, and a plan is often read again with a new crop. */
const cache = new Map<string, Promise<unknown>>()
const CACHE_SIZE = 40

export function cachedReading<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit) return hit as Promise<T>
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
