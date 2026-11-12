#!/usr/bin/env node
/**
 * 由 apps/web/public/favicon.svg 生成网页图标的位图版本。品牌图形改动后运行一次，产物与源一起入库：
 *   favicon.ico（16/32/48）            浏览器标签、收藏夹，兼容不认 SVG 的地方
 *   icon-192.png、icon-512.png         网页“安装为应用”后的桌面、开始菜单、任务栏图标
 *   icon-maskable-512.png              系统把图标裁成圆形或其他形状时用，图形缩进中心安全区
 *   apple-touch-icon.png（180）        iPhone / iPad 添加到主屏幕，系统自己加圆角
 *
 * 用法（仓库根目录）：node tools/brand/build-icons.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const PUBLIC = fileURLToPath(new URL('../../apps/web/public/', import.meta.url))
const source = await readFile(`${PUBLIC}favicon.svg`, 'utf8')

// favicon.svg 的底板是 64×64、圆角 14 的方块，其余是图形。满底版本去掉圆角，并可把图形缩小。
const plate = /<rect width="64" height="64" rx="14" fill="(#[0-9a-fA-F]{3,8})"\s*\/>/
const fill = source.match(plate)?.[1]
if (!fill) throw new Error('favicon.svg 里找不到 64×64、圆角 14 的底板')
const fullBleed = (scale) =>
  source
    .replace(plate, `<rect width="64" height="64" fill="${fill}"/><g transform="translate(32 32) scale(${scale}) translate(-32 -32)">`)
    .replace('</svg>', '</g></svg>')

/** 按目标尺寸直接渲染 SVG（不先画大图再缩小），小尺寸更清楚。 */
function png(svg, size) {
  return sharp(Buffer.from(svg), { density: (72 * size) / 64 })
    .resize(size, size)
    .png()
    .toBuffer()
}

/** ICO：文件头 + 每个尺寸一条目录 + PNG 数据（Windows Vista 起支持 PNG 条目）。 */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i
    head.writeUInt8(size >= 256 ? 0 : size, at)
    head.writeUInt8(size >= 256 ? 0 : size, at + 1)
    head.writeUInt16LE(1, at + 4)
    head.writeUInt16LE(32, at + 6)
    head.writeUInt32LE(data.length, at + 8)
    head.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...images.map((image) => image.data)])
}

const icoImages = []
for (const size of [16, 32, 48]) icoImages.push({ size, data: await png(source, size) })
await writeFile(`${PUBLIC}favicon.ico`, ico(icoImages))
await writeFile(`${PUBLIC}icon-192.png`, await png(source, 192))
await writeFile(`${PUBLIC}icon-512.png`, await png(source, 512))
// 圆形裁切的安全区是直径 80% 的圆；墙角在 0.8 倍时刚好落在圆内。
await writeFile(`${PUBLIC}icon-maskable-512.png`, await png(fullBleed(0.8), 512))
await writeFile(`${PUBLIC}apple-touch-icon.png`, await png(fullBleed(1), 180))
console.log('已生成：favicon.ico、icon-192.png、icon-512.png、icon-maskable-512.png、apple-touch-icon.png')
