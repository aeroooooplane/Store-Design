import fs from 'node:fs/promises'
import path from 'node:path'
import { readPageTexts, readDimensionChains } from '../../apps/api/src/modules/recognition/ocr.ts'
import { recognizeVector } from '../../apps/api/src/modules/recognition/local.ts'
import { chainScale } from '../../apps/api/src/modules/recognition/local/dimension-chain.ts'
const out = path.resolve(process.argv[2])
const raw = JSON.parse(await fs.readFile(path.join(out, 'raw.json'), 'utf8'))
const content = { width: raw.width, height: raw.height, lines: raw.lines, rects: [], texts: [] }
const image = await fs.readFile(path.join(out, 'ocr-input.png'))
const started = performance.now()
const texts = await readPageTexts(image, content)
const chains = await readDimensionChains(image, content)
// 栅格轴线仅作为尺寸/文字对照，不拿旧矢量规则的默认1.5m入口当作识别成果。
const chain = chainScale(chains)
const legacy = recognizeVector({ ...content, texts }, { crop: null, calibration: null }, [])
const scales =
  chain && chain.used.length >= 2
    ? [
        {
          method: 'raster-dimension-chain',
          mmPerPixel: chain.mmPerPixel,
          readings: chain.used,
          verified: false,
        },
      ]
    : []
const result = {
  schemaVersion: 1,
  inputSha256: raw.inputSha256,
  texts,
  chains,
  scaleCandidates: scales,
  legacyScaleCandidate: legacy.scale,
  legacyNotes: legacy.notes,
  fields: {
    outline: 'candidate',
    scale: scales.length ? 'candidate' : 'unknown',
    entrances: 'unknown',
    columns: 'unknown',
    height: 'unknown',
    furniture: 'not-started',
  },
  completeAutomatically: false,
  labelsRead: false,
  cloudRequests: 0,
  seconds: (performance.now() - started) / 1000,
}
await fs.writeFile(path.join(out, 'reading.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(
  JSON.stringify({
    folder: path.basename(out),
    texts: texts.length,
    chains: chains.length,
    scaleCandidates: scales.length,
    legacyScale: legacy.scale,
    seconds: result.seconds,
  }),
)
