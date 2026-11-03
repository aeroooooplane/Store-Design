import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { checkedFile, jsonSha256, relativeFile, sha256 } from './pilot-contract.mjs'
const req = createRequire(new URL('../../apps/web/package.json', import.meta.url))
const pdfPath = req.resolve('pdfjs-dist/legacy/build/pdf.mjs')
const pdfjs = await import(pathToFileURL(pdfPath).href)
const { createCanvas } = createRequire(pdfPath)('@napi-rs/canvas')
export const need = (ok, msg) => assert.ok(ok, msg)
export async function safePath(root, relative) {
  need(relativeFile(relative), '无效相对路径')
  const base = await realpath(root),
    file = await realpath(path.join(base, relative))
  need(file.startsWith(base + path.sep), '链接越出输入目录')
  return file
}
export async function readJson(root, relative) {
  return JSON.parse(await readFile(await safePath(root, relative), 'utf8'))
}
export async function openPdf(bytes) {
  return pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise
}
export async function renderPdf(doc, pageNumber, width = 1500, rotation = 0) {
  const page = await doc.getPage(pageNumber),
    v = page.getViewport({ scale: 1, rotation }),
    viewport = page.getViewport({ scale: width / v.width, rotation })
  need(
    Number.isFinite(viewport.width) &&
      Number.isFinite(viewport.height) &&
      viewport.width > 0 &&
      viewport.height > 0 &&
      viewport.width * viewport.height <= 32000000,
    'PDF渲染尺寸过大或无效',
  )
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise
  return {
    png: canvas.toBuffer('image/png'),
    widthPt: v.width,
    heightPt: v.height,
    widthPx: canvas.width,
    heightPx: canvas.height,
  }
}
async function imageDifference(a, b) {
  const buffers = await Promise.all(
    [a, b].map((bytes) =>
      sharp(bytes)
        .flatten({ background: '#fff' })
        .resize(1000, 1000, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer(),
    ),
  )
  let error = 0
  for (let i = 0; i < buffers[0].length; i++) error += Math.abs(buffers[0][i] - buffers[1][i])
  return error / (255 * buffers[0].length)
}
export function validateRender(r) {
  need(
    r && r.pageSizePt?.length === 2 && r.pageSizePt.every((x) => Number.isFinite(x) && x > 0),
    '缺原页尺寸',
  )
  need(r.cropBoxPt?.length === 4 && r.cropBoxPt.every(Number.isFinite), '裁切范围错误')
  const [x, y, w, h] = r.cropBoxPt
  need(
    x >= 0 &&
      y >= 0 &&
      w > 0 &&
      h > 0 &&
      x + w <= r.pageSizePt[0] + 0.01 &&
      y + h <= r.pageSizePt[1] + 0.01,
    '裁切越界',
  )
  need(
    [0, 90, 180, 270].includes(r.rotationCW) &&
      [r.widthPx, r.heightPx].every((v) => Number.isInteger(v) && v > 0 && v <= 16000),
    '预览旋转/尺寸错误',
  )
  need(r.pageToPreview?.length === 6 && r.pageToPreview.every(Number.isFinite), '缺变换矩阵')
  const [a, b, c, d, e, f] = r.pageToPreview,
    s1 = Math.hypot(a, b),
    s2 = Math.hypot(c, d)
  need(
    s1 > 0 &&
      Math.abs(s1 / s2 - 1) < 0.001 &&
      Math.abs(a * c + b * d) < s1 * s2 * 0.001 &&
      a * d - b * c > 0,
    '禁止不可逆/镜像/非等比变换',
  )
  const corners = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    targets = [
      [0, 0],
      [r.widthPx, 0],
      [r.widthPx, r.heightPx],
      [0, r.heightPx],
    ]
  need(
    corners.every(([u, v], i) => {
      const t = targets[(i + r.rotationCW / 90) % 4]
      return Math.hypot(a * u + c * v + e - t[0], b * u + d * v + f - t[1]) <= 1.5
    }),
    '矩阵与裁切/旋转/预览尺寸不一致',
  )
}
export function validateHandoff(h, s, manifest) {
  need(
    h.schemaVersion === 1 &&
      h.contract === 'store-pilot/1' &&
      h.store_id === s.store_id &&
      h.manifestSha256 === jsonSha256(manifest),
    '交接身份/名单版本不符',
  )
  need(['draft', 'blocked'].includes(h.status) && Array.isArray(h.missing), '输入不能冒充已审核')
  need(h.sourceSha256 === s.source.sha256 && h.sourcePage === s.source.page, '交接原页不符')
  need(
    h.producer?.name &&
      h.producer?.tool &&
      /^[a-f0-9]{40}$/.test(h.producer?.codeRevision) &&
      Number.isFinite(Date.parse(h.producer?.createdAt)),
    '生成来源不完整',
  )
  need(
    Array.isArray(h.files) && new Set(h.files.map((f) => f.path)).size === h.files.length,
    '文件清单缺失/重复',
  )
  need(
    h.files.every((f) => relativeFile(f.path) && /^[a-f0-9]{64}$/.test(f.sha256)),
    '文件路径/指纹错误',
  )
  need(
    h.files.every(
      (f) =>
        f.path === 'store.json' || f.path.startsWith('source/') || f.path.startsWith('evidence/'),
    ),
    '输入文件须放在source/、evidence/或store.json，不能覆盖派生产物',
  )
  for (const p of ['source/plan.pdf', 'source/preview.png', 'store.json', 'evidence/index.json'])
    need(
      h.files.some((f) => f.path === p),
      '缺少文件 ' + p,
    )
  validateRender(h.render)
  need(
    Array.isArray(h.dimensions) &&
      new Set(h.dimensions.map((v) => v.id)).size === h.dimensions.length,
    '尺寸证据缺失/重复',
  )
  for (const d of h.dimensions) {
    need(
      d.id &&
        ['calibration', 'independent-check'].includes(d.role) &&
        d.label &&
        Number.isFinite(d.lengthMm) &&
        d.lengthMm > 0,
      '尺寸值/来源错误',
    )
    need(
      d.pointsPx?.length === 2 &&
        d.pointsPx.every(
          (p) =>
            p.length === 2 &&
            p.every(Number.isFinite) &&
            p[0] >= 0 &&
            p[1] >= 0 &&
            p[0] <= h.render.widthPx &&
            p[1] <= h.render.heightPx,
        ),
      '尺寸端点越界',
    )
    need(
      Math.hypot(d.pointsPx[1][0] - d.pointsPx[0][0], d.pointsPx[1][1] - d.pointsPx[0][1]) > 1,
      '尺寸端点重合',
    )
    need(
      h.files.some((f) => f.path === d.evidencePath),
      '尺寸证据未登记哈希',
    )
  }
  need(['present', 'missing', 'unreadable'].includes(h.bom?.status), '缺BOM来源状态')
  if (h.bom.status === 'present')
    need(
      h.files.some((f) => f.path === h.bom.path),
      'BOM未列入文件清单',
    )
  else need(h.bom.reason, 'BOM缺失必须说明')
}
export async function inspectInput({ bundle, resources, sample: s, manifest }) {
  const root = await safePath(bundle, s.store_id),
    hb = await readFile(await safePath(root, 'handoff.json')),
    h = JSON.parse(hb)
  validateHandoff(h, s, manifest)
  const files = new Map()
  for (const f of h.files) files.set(f.path, await checkedFile(root, f.path, f.sha256))
  const info = await sharp(files.get('source/preview.png')).metadata()
  need(
    info.format === 'png' && info.width === h.render.widthPx && info.height === h.render.heightPx,
    '预览PNG实际尺寸不符',
  )
  const store = JSON.parse(files.get('store.json')),
    evidence = JSON.parse(files.get('evidence/index.json'))
  need(store.store_id === s.store_id && evidence.store_id === s.store_id, '原档案/证据门店号不符')
  need(
    Array.isArray(evidence.observations) &&
      new Set(evidence.observations.map((e) => e.id)).size === evidence.observations.length,
    '证据索引缺失/重复',
  )
  for (const e of evidence.observations)
    need(e.id && e.kind && e.note && files.has(e.path), '证据索引字段/文件不符')
  const src = await openPdf(await checkedFile(resources, s.source.path, s.source.sha256)),
    extracted = await openPdf(files.get('source/plan.pdf'))
  let pageDiff, previewDiff
  try {
    need(src.numPages === s.source.pageCount && extracted.numPages === 1, '原PDF页数或提页页数不符')
    // 与交付预览使用同一页像素密度；低分辨率渲染后放大会改变细线/字体栅格，
    // 不能把这种采样差异误报成源页内容变化。旋转前宽度由矩阵尺度确定。
    const renderWidth = Math.ceil(
      h.render.pageSizePt[0] * Math.hypot(h.render.pageToPreview[0], h.render.pageToPreview[1]),
    )
    const original = await renderPdf(src, s.source.page, renderWidth),
      selected = await renderPdf(extracted, 1, renderWidth)
    need(
      Math.abs(original.widthPt - h.render.pageSizePt[0]) < 0.1 &&
        Math.abs(original.heightPt - h.render.pageSizePt[1]) < 0.1,
      '原页尺寸声明错误',
    )
    need(
      Math.abs(original.widthPt - selected.widthPt) < 0.1 &&
        Math.abs(original.heightPt - selected.heightPt) < 0.1,
      '提取页尺寸改变',
    )
    pageDiff = await imageDifference(original.png, selected.png)
    need(pageDiff <= 0.02, '提页与选定原页渲染不一致，需人工核对')
    const [x, y, w, ht] = h.render.cropBoxPt,
      scale = original.widthPx / original.widthPt
    const crop = {
      left: Math.round(x * scale),
      top: Math.round(y * scale),
      width: Math.round(w * scale),
      height: Math.round(ht * scale),
    }
    crop.width = Math.min(crop.width, original.widthPx - crop.left)
    crop.height = Math.min(crop.height, original.heightPx - crop.top)
    // 分成两个管线，避免sharp将旋转提前，导致纵向原页按横向尺寸裁切越界。
    const cropped = await sharp(original.png).extract(crop).png().toBuffer()
    const expected = await sharp(cropped)
      .rotate(h.render.rotationCW)
      .resize(h.render.widthPx, h.render.heightPx)
      .png()
      .toBuffer()
    previewDiff = await imageDifference(expected, files.get('source/preview.png'))
    need(previewDiff <= 0.03, '预览与声明裁切/旋转不一致，需人工核对；均差=' + previewDiff)
  } finally {
    await src.destroy()
    await extracted.destroy()
  }
  return {
    root,
    h,
    files,
    evidence,
    handoffSha256: sha256(hb),
    checks: {
      sourcePageDifference: pageDiff,
      previewDifference: previewDiff,
      visualReviewRequired: true,
    },
    missing: [
      ...s.missing,
      ...h.missing,
      ...(h.bom.status === 'present' ? [] : ['原BOM缺失或不可读']),
      ...(!h.dimensions.some((d) => d.role === 'calibration') ? ['缺量尺依据'] : []),
      ...(h.status === 'blocked' ? ['生产者标记blocked'] : []),
    ],
  }
}
