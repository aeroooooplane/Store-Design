// 抠图：去掉产品照片的地面背景（含柔和阴影），输出与模型库其他效果图一致的透明 PNG
// （3840×2160 画布、产品居中、不留阴影）。
// 用法（仓库根目录）：
//   node tools/library/cutout-photo.mjs <输入图片> <输出.png>
//     [--keep "x,y x,y x,y …"]…  强制保留的多边形（原图像素坐标，可多个），用于与地面同色的白色台面
//     [--mask 掩膜.png] [--step 7] [--floor 238] [--shadow 120]
//
// 做法：从图片四边向内“漫水”，只走相邻像素颜色变化很小（--step）、亮度在阴影与地面之间
// （--shadow～--floor）且接近灰色的像素；走到的就是背景，其余是产品。白色台面与浅灰地面
// 亮度几乎相同时漫水会进入台面，此时用 --keep 描出台面轮廓（可先把图片拉高对比度再读坐标）。
// 结果须人工看一眼（--mask 输出黑白掩膜便于检查）。
import { writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const args = process.argv.slice(2)
const positional = []
const options = new Map()
for (let i = 0; i < args.length; i++) {
  const arg = args[i] ?? ''
  if (arg.startsWith('--')) {
    options.set(arg.slice(2), [...(options.get(arg.slice(2)) ?? []), args[i + 1] ?? ''])
    i++
  } else positional.push(arg)
}
const option = (name, fallback) => Number(options.get(name)?.[0] ?? fallback)
const [input, output] = positional
if (!input || !output) {
  console.error('用法：node tools/library/cutout-photo.mjs <输入图片> <输出.png> [--keep "x,y x,y …"]')
  process.exit(1)
}
const STEP = option('step', 7)
const FLOOR_MAX = option('floor', 238)
/** Shadows are darker floor, but never as dark as the product's dark parts. */
const SHADOW_MIN = option('shadow', 120)
const KEEP = (options.get('keep') ?? []).map((text) =>
  text
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number)),
)
const MASK_FILE = options.get('mask')?.[0] ?? null
/** Background is grey: a saturated pixel belongs to the product. */
const MAX_CHROMA = 24
const CANVAS = { width: 3840, height: 2160 }
const PRODUCT_HEIGHT = 1100

const { data, info } = await sharp(input)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })
const { width, height } = info
const at = (x, y) => (y * width + x) * 3
const luma = (i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
const chroma = (i) =>
  Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2])
const looksLikeFloor = (i) => {
  const y = luma(i)
  return y <= FLOOR_MAX && y >= SHADOW_MIN && chroma(i) <= MAX_CHROMA
}

// 1. Flood fill from the border.
const background = new Uint8Array(width * height)
const queue = new Int32Array(width * height)
let head = 0
let tail = 0
const seed = (x, y) => {
  const p = y * width + x
  if (!background[p] && looksLikeFloor(p * 3)) {
    background[p] = 1
    queue[tail++] = p
  }
}
for (let x = 0; x < width; x++) {
  seed(x, 0)
  seed(x, height - 1)
}
for (let y = 0; y < height; y++) {
  seed(0, y)
  seed(width - 1, y)
}
while (head < tail) {
  const p = queue[head++]
  const x = p % width
  const y = (p - x) / width
  const i = p * 3
  for (const [nx, ny] of [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ]) {
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
    const q = ny * width + nx
    if (background[q]) continue
    const j = at(nx, ny)
    const step = Math.max(
      Math.abs(data[i] - data[j]),
      Math.abs(data[i + 1] - data[j + 1]),
      Math.abs(data[i + 2] - data[j + 2]),
    )
    if (step <= STEP && looksLikeFloor(j)) {
      background[q] = 1
      queue[tail++] = q
    }
  }
}

// Traced outlines (e.g. a white table top the fill ran into) are product.
const inside = (polygon, x, y) => {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}
for (const polygon of KEEP) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inside(polygon, x + 0.5, y + 0.5)) background[y * width + x] = 0
    }
  }
}

// 2. Small specks (watermark strokes, noise) left inside the background become background.
const label = new Int32Array(width * height).fill(-1)
const keep = new Uint8Array(width * height)
let largest = 0
const components = []
for (let p = 0; p < width * height; p++) {
  if (background[p] || label[p] >= 0) continue
  const members = [p]
  label[p] = components.length
  for (let k = 0; k < members.length; k++) {
    const m = members[k]
    const x = m % width
    const y = (m - x) / width
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const q = ny * width + nx
      if (!background[q] && label[q] < 0) {
        label[q] = components.length
        members.push(q)
      }
    }
  }
  components.push(members)
  largest = Math.max(largest, members.length)
}
for (const members of components) {
  if (members.length >= largest * 0.02) for (const m of members) keep[m] = 255
}

if (MASK_FILE) {
  await sharp(Buffer.from(keep), { raw: { width, height, channels: 1 } }).png().toFile(MASK_FILE)
}

// 3. Soft 1 px edge, then crop to the product and centre it on the standard canvas.
const alpha = await sharp(Buffer.from(keep), { raw: { width, height, channels: 1 } })
  .blur(0.6)
  .extractChannel(0)
  .raw()
  .toBuffer()
const rgba = Buffer.alloc(width * height * 4)
let [minX, minY, maxX, maxY] = [width, height, 0, 0]
for (let p = 0; p < width * height; p++) {
  rgba[p * 4] = data[p * 3]
  rgba[p * 4 + 1] = data[p * 3 + 1]
  rgba[p * 4 + 2] = data[p * 3 + 2]
  rgba[p * 4 + 3] = alpha[p]
  if (keep[p]) {
    const x = p % width
    const y = (p - x) / width
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
}
const crop = { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
const scale = Math.min(PRODUCT_HEIGHT / crop.height, (CANVAS.width * 0.8) / crop.width)
const product = await sharp(rgba, { raw: { width, height, channels: 4 } })
  .extract(crop)
  .resize(Math.round(crop.width * scale), Math.round(crop.height * scale), { kernel: 'lanczos3' })
  .png()
  .toBuffer()
const { width: pw = 0, height: ph = 0 } = await sharp(product).metadata()
const result = await sharp({
  create: { ...CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([
    {
      input: product,
      left: Math.round((CANVAS.width - pw) / 2),
      top: Math.round((CANVAS.height - ph) / 2),
    },
  ])
  .png()
  .toBuffer()
await writeFile(output, result)
const removed = background.reduce((sum, v) => sum + v, 0) / (width * height)
console.log(`${output}：去掉背景 ${(removed * 100).toFixed(1)}%，产品 ${crop.width}×${crop.height} px，放大 ${scale.toFixed(2)} 倍`)
