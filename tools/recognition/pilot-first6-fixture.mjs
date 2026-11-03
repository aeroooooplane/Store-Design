// 仅合成测试/演示。不得作为真实门店来源或计入试点完成数。
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sha256, jsonSha256 } from './pilot-contract.mjs'
import { openPdf, renderPdf } from './pilot-input.mjs'
import { runFirstSix } from './pilot-first6.mjs'
const PDFDocument = createRequire(new URL('../../apps/api/package.json', import.meta.url))('pdfkit')
const save = async (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n')
async function sourcePdf(id) {
  const d = new PDFDocument({ size: [600, 400], margin: 0 }),
    chunks = []
  d.font(
    await readFile(new URL('../../apps/api/assets/fonts/NotoSansSC-Regular.ttf', import.meta.url)),
  )
  const promise = new Promise((resolve, reject) => {
    d.on('data', (c) => chunks.push(c))
    d.on('end', () => resolve(Buffer.concat(chunks)))
    d.on('error', reject)
  })
  d.fontSize(12).text('SYNTHETIC SOURCE ONLY / ' + id, 30, 12)
  d.rect(50, 50, 500, 300).stroke()
  d.rect(75, 75, 40, 40).fillAndStroke('#ccc', '#444')
  d.rect(260, 170, 80, 60).fillAndStroke('#e5efff', '#357')
  d.moveTo(250, 350).lineTo(350, 350).lineWidth(4).stroke('#090')
  d.lineWidth(1)
    .fillColor('#333')
    .fontSize(10)
    .text('5000 mm', 260, 37)
    .text('3000 mm', 551, 200, { width: 48 })
  d.end()
  return promise
}
export async function makeSynthetic(root) {
  const input = path.join(root, 'inputs'),
    resources = path.join(root, 'resources'),
    repo = path.join(root, 'lock-only'),
    bundle = path.join(root, 'bundle'),
    corrections = path.join(root, 'corrections')
  for (const p of [
    input,
    resources,
    repo,
    bundle,
    corrections,
    path.join(resources, '01_各门店原图纸'),
    path.join(resources, '04_模型库'),
  ])
    await mkdir(p, { recursive: true })
  const model = {
      assets: [
        { asset_id: 'asset-1', tight_face_bounds_xyz_mm: [800, 600, 800], web_model: 'synthetic' },
      ],
    },
    body = { assets: {} }
  const mb = JSON.stringify(model),
    bb = JSON.stringify(body)
  await mkdir(path.join(resources, '04_模型库/synthetic'))
  const conversion = JSON.stringify({ id: 'asset-1', dimensions: { w: 0.8, d: 0.6, h: 0.8 } })
  await writeFile(path.join(resources, '04_模型库/synthetic/conversion.json'), conversion)
  await writeFile(path.join(resources, '04_模型库/manifest.json'), mb)
  await writeFile(path.join(resources, '04_模型库/body-footprint.json'), bb)
  const lock = {
    releaseVersions: { models: 'synthetic-only' },
    requiredFiles: {
      '04_模型库/manifest.json': sha256(mb),
      '04_模型库/body-footprint.json': sha256(bb),
    },
  }
  await save(path.join(repo, 'resources.lock.json'), lock)
  const ident = (prefix, n) => ({
    store_id: `${prefix}-${n}`,
    name: `${prefix}示例${n}`,
    aliases: [],
    sameStoreKeys: [`${prefix}-${n}`],
    sourceSha256s: [sha256(`${prefix}-${n}`)],
  })
  const a = {
      schemaVersion: 1,
      kind: 'acceptance',
      revision: 'synthetic',
      sourceManifestSha256: sha256('a'),
      stores: Array.from({ length: 45 }, (_, i) => ident('A', i)),
    },
    dev = {
      schemaVersion: 1,
      kind: 'development',
      revision: 'synthetic',
      sourceManifestSha256: sha256('d'),
      stores: Array.from({ length: 48 }, (_, i) => ident('D', i)),
    }
  const m = {
    schemaVersion: 1,
    contract: 'store-pilot/1',
    synthetic: true,
    pilotId: 'synthetic-first6-only',
    status: 'frozen',
    frozenAt: '2026-11-03T00:00:00Z',
    selectedBy: 'synthetic-generator',
    selectionBasis: 'source-stratified-before-recognition',
    coverageGaps: ['仅合成，不代表真实分层'],
    modelsVersion: 'synthetic-only',
    resourceLockSha256: jsonSha256(lock),
    exclusions: { acceptanceSha256: jsonSha256(a), developmentSha256: jsonSha256(dev) },
    samples: [],
  }
  const sourceBytes = []
  for (let n = 1; n <= 24; n++) {
    const id = `SYNTH-${String(n).padStart(2, '0')}`,
      pdf = await sourcePdf(id),
      rel = `01_各门店原图纸/${id}.pdf`
    sourceBytes.push(pdf)
    await writeFile(path.join(resources, rel), pdf)
    m.samples.push({
      ...ident('SYNTH', n),
      store_id: id,
      name: `合成样本${n}（非真实门店）`,
      sourceSha256s: [sha256(pdf)],
      batch: n <= 6 ? 1 : 2,
      selectionReason: '合成回归',
      mallGroupKey: 'synthetic',
      nearDuplicateGroupKeys: [],
      si: 'SI1.0',
      shopType: '边厅',
      pageType: 'vector-text',
      geometry: 'regular',
      missing: [],
      source: { path: rel, sha256: sha256(pdf), page: 1, pageCount: 1 },
    })
  }
  for (const [name, v] of [
    ['pilot-manifest', m],
    ['acceptance-index', a],
    ['development-index', dev],
  ])
    await save(path.join(input, name + '.json'), v)
  for (const [i, s] of m.samples.slice(0, 6).entries()) {
    const dir = path.join(bundle, s.store_id),
      cd = path.join(corrections, s.store_id)
    await mkdir(path.join(dir, 'source'), { recursive: true })
    await mkdir(path.join(dir, 'evidence'))
    await mkdir(cd)
    const doc = await openPdf(sourceBytes[i])
    let png
    try {
      png = (await renderPdf(doc, 1, 1200)).png
    } finally {
      await doc.destroy()
    }
    const material = {
      'source/plan.pdf': sourceBytes[i],
      'source/preview.png': png,
      'store.json': Buffer.from(JSON.stringify({ store_id: s.store_id, synthetic: true })),
      'evidence/index.json': Buffer.from(
        JSON.stringify({
          store_id: s.store_id,
          observations: [
            {
              id: 'source',
              kind: 'drawing',
              path: 'source/preview.png',
              note: '合成原图，含边界、入口、柱、桌体和尺寸',
            },
          ],
        }),
      ),
      'evidence/source-bom.json': Buffer.from(
        JSON.stringify({ synthetic: true, items: [{ label: '合成桌', quantity: 1 }] }),
      ),
    }
    for (const [p, b] of Object.entries(material)) await writeFile(path.join(dir, p), b)
    const h = {
      schemaVersion: 1,
      contract: 'store-pilot/1',
      store_id: s.store_id,
      manifestSha256: jsonSha256(m),
      status: 'draft',
      missing: [],
      producer: {
        name: 'synthetic',
        tool: 'pilot-first6-fixture.mjs',
        codeRevision: '0'.repeat(40),
        createdAt: '2026-11-03T00:00:00Z',
      },
      sourceSha256: s.source.sha256,
      sourcePage: 1,
      files: Object.entries(material).map(([p, b]) => ({ path: p, sha256: sha256(b) })),
      render: {
        pageSizePt: [600, 400],
        cropBoxPt: [0, 0, 600, 400],
        rotationCW: 0,
        widthPx: 1200,
        heightPx: 800,
        pageToPreview: [2, 0, 0, 2, 0, 0],
        renderer: 'pdfjs',
        rendererVersion: '5.7.284',
      },
      dimensions: [
        {
          id: 'width',
          role: 'calibration',
          pointsPx: [
            [100, 100],
            [1100, 100],
          ],
          lengthMm: 5000,
          label: '5000',
          evidencePath: 'source/preview.png',
        },
        {
          id: 'depth',
          role: 'independent-check',
          pointsPx: [
            [1100, 100],
            [1100, 700],
          ],
          lengthMm: 3000,
          label: '3000',
          evidencePath: 'source/preview.png',
        },
      ],
      bom: { status: 'present', path: 'evidence/source-bom.json' },
    }
    await save(path.join(dir, 'handoff.json'), h)
    const plan = {
      schemaVersion: 1,
      contract: 'store-pilot/1',
      store_id: s.store_id,
      manifestSha256: jsonSha256(m),
      handoffSha256: sha256(await readFile(path.join(dir, 'handoff.json'))),
      si: s.si,
      versions: { modelsVersion: m.modelsVersion, resourceLockSha256: m.resourceLockSha256 },
      transform: { originPx: [100, 100], mmPerPixel: 5, calibrationId: 'width' },
      space: {
        schemaVersion: 1,
        boundary: [
          [0, 0],
          [5, 0],
          [5, 3],
          [0, 3],
        ],
        height: 3,
        entrances: [{ kind: 'main', a: [2, 3], b: [3, 3] }],
        openEdges: [],
        obstacles: [
          {
            kind: 'column',
            polygon: [
              [0.25, 0.25],
              [0.65, 0.25],
              [0.65, 0.65],
              [0.25, 0.65],
            ],
            height: 3,
          },
        ],
      },
      layout: {
        schemaVersion: 3,
        items: [
          {
            id: 'table-1',
            assetId: i === 5 ? null : 'asset-1',
            function: 'island_table',
            name: '合成桌',
            cx: 2.5,
            cz: 1.5,
            w: 0.8,
            d: 0.6,
            h: 0.8,
            rotation: 0,
          },
        ],
      },
      evidence: {
        boundary: ['source'],
        entrances: ['source'],
        obstacles: ['source'],
        items: { 'table-1': ['source'] },
      },
      unresolved:
        i === 5
          ? [
              {
                id: 'unknown-model',
                question: '合成演示：此桌型号不清，如何处理？',
                options: ['保留未知并补型号证据', '确认具体型号后再映射'],
                recommendation: '保留未知，不强配',
                evidencePath: 'source/preview.png',
                regionPx: [480, 300, 240, 200],
              },
            ]
          : [],
      review: {
        status: 'agent_corrected',
        userSampled: false,
        history: [
          {
            status: 'agent_corrected',
            actor: 'synthetic-agent',
            role: 'agent',
            at: '2026-11-03T00:00:00Z',
            reason: '合成测试；不是真实审核',
          },
        ],
      },
    }
    await save(path.join(cd, 'plan.json'), plan)
    await save(path.join(cd, 'bom.json'), {
      store_id: s.store_id,
      rows: [
        {
          id: 'table',
          assetId: plan.layout.items[0].assetId,
          label: '合成桌',
          unit: '件',
          quantity: 1,
          itemIds: ['table-1'],
          sourceRefs: ['source'],
        },
      ],
    })
  }
  return {
    manifest: path.join(input, 'pilot-manifest.json'),
    'acceptance-index': path.join(input, 'acceptance-index.json'),
    'development-index': path.join(input, 'development-index.json'),
    repo,
    resources,
    bundle,
    corrections,
    out: path.join(root, 'output'),
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const i = process.argv.indexOf('--out')
  if (i < 0 || !process.argv[i + 1]) throw Error('必须指定worktree外的新 --out')
  const root = path.resolve(process.argv[i + 1])
  const { isolatedOutput } = await import('./pilot-contract.mjs')
  await isolatedOutput(root, [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')])
  await mkdir(root)
  const args = await makeSynthetic(root)
  const report = await runFirstSix(args)
  console.log(
    JSON.stringify({
      synthetic: true,
      output: args.out,
      generated: report.generated,
      automaticChecksPassed: report.automaticChecksPassed,
      realCompleted: 0,
    }),
  )
}
