import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'
import { isolatedOutput, sha256, jsonSha256, checkedFile } from './pilot-contract.mjs'
import { inspectInput, readJson, safePath, need } from './pilot-input.mjs'
import { quality } from './pilot-quality.mjs'
import { catalogReader } from './pilot-assets.mjs'
import { renderPlan, svgOverlay, escape } from './pilot-render.mjs'
const toolRoot = path.dirname(fileURLToPath(import.meta.url))
const save = async (file, value) =>
  writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
export async function runFirstSix(args) {
  const required = [
    'manifest',
    'acceptance-index',
    'development-index',
    'repo',
    'resources',
    'bundle',
    'corrections',
    'out',
  ]
  for (const k of required) need(args[k], '必须指定 --' + k)
  const manifest = JSON.parse(await readFile(args.manifest, 'utf8'))
  const out = await isolatedOutput(args.out, [
    args.repo,
    path.resolve(toolRoot, '../..'),
    args.resources,
    args.bundle,
    args.corrections,
    ...['manifest', 'acceptance-index', 'development-index'].map((k) =>
      path.dirname(path.resolve(args[k])),
    ),
  ])
  await mkdir(out)
  // 始终先重新执行A检查，不信任旧报告中的通过标志。
  try {
    execFileSync(
      process.execPath,
      [
        path.join(toolRoot, 'pilot-check.mjs'),
        ...['manifest', 'acceptance-index', 'development-index', 'repo', 'resources'].flatMap(
          (k) => ['--' + k, args[k]],
        ),
        '--out',
        path.join(out, 'a-check'),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (e) {
    await save(path.join(out, 'blocked.json'), {
      stage: 'A',
      message: String(e.stderr ?? e.message),
      realCompleted: 0,
    })
    throw Error('A项检查未通过，未运行首6；见blocked.json')
  }
  const modelBytes = await readFile(path.join(args.resources, '04_模型库/manifest.json')),
    model = JSON.parse(modelBytes.toString().replace(/^\uFEFF/, '')),
    lock = JSON.parse(await readFile(path.join(args.repo, 'resources.lock.json'), 'utf8'))
  const bodyHash =
    lock.requiredFiles['04_模型库/body-footprint.json'] ?? args['body-footprint-sha256']
  need(
    typeof bodyHash === 'string' && /^[a-f0-9]{64}$/i.test(bodyHash),
    '资源锁未锁桌体尺寸时必须提供 --body-footprint-sha256 冻结指纹',
  )
  const bodyBytes = await checkedFile(
      args.resources,
      '04_模型库/body-footprint.json',
      bodyHash.toLowerCase(),
    ),
    bodies = JSON.parse(bodyBytes.toString().replace(/^\uFEFF/, '')).assets
  need(
    sha256(modelBytes) === lock.requiredFiles['04_模型库/manifest.json'].toLowerCase(),
    '模型目录在A检查后变化',
  )
  const catalog = catalogReader({ resources: args.resources, model, bodies, lock })
  await mkdir(path.join(out, 'review'))
  const rows = [],
    conflicts = []
  for (const s of manifest.samples.filter((s) => s.batch === 1)) {
    const dest = path.join(out, s.store_id)
    await mkdir(dest)
    const row = {
      store_id: s.store_id,
      name: s.name,
      status: 'blocked',
      generated: false,
      issues: [],
      trainingEligible: false,
      userSampled: false,
    }
    rows.push(row)
    try {
      const input = await inspectInput({
        bundle: args.bundle,
        resources: args.resources,
        sample: s,
        manifest,
      })
      for (const [p, bytes] of input.files) {
        await mkdir(path.dirname(path.join(dest, p)), { recursive: true })
        await writeFile(path.join(dest, p), bytes, { flag: 'wx' })
      }
      await copyFile(await safePath(input.root, 'handoff.json'), path.join(dest, 'handoff.json'))
      await save(path.join(dest, 'input-check.json'), {
        handoffSha256: input.handoffSha256,
        ...input.checks,
        missing: input.missing,
      })
      row.original = true
      const correctionRoot = await safePath(args.corrections, s.store_id),
        plan = await readJson(correctionRoot, 'plan.json'),
        bom = await readJson(correctionRoot, 'bom.json')
      const assets = await catalog.forLayout(plan.layout)
      const qa = quality(plan, bom, input, s, manifest, assets),
        { space, layout, ...record } = qa
      record.versions = {
        manifestSha256: jsonSha256(manifest),
        handoffSha256: input.handoffSha256,
        modelsVersion: manifest.modelsVersion,
        modelManifestSha256: sha256(modelBytes),
        bodyFootprintSha256: sha256(bodyBytes),
        conversionHashes: Object.fromEntries(
          [...catalog.snapshots].map(([p, b]) => [p, sha256(b)]),
        ),
      }
      row.status = qa.status
      row.issues = qa.issues
      await save(path.join(dest, 'plan.json'), plan)
      await save(path.join(dest, 'bom.json'), bom)
      await save(path.join(dest, 'qa.json'), record)
      row.checkFile = 'qa.json'
      for (const q of plan.unresolved ?? []) {
        const conflict = { store_id: s.store_id, ...q, crop: null }
        if (
          q.evidencePath === 'source/preview.png' &&
          q.regionPx?.length === 4 &&
          q.regionPx.every(Number.isFinite)
        ) {
          const [left, top, width, height] = q.regionPx.map(Math.round)
          if (
            left >= 0 &&
            top >= 0 &&
            width > 0 &&
            height > 0 &&
            left + width <= input.h.render.widthPx &&
            top + height <= input.h.render.heightPx
          ) {
            const name = `conflict-${conflicts.length + 1}.png`
            await writeFile(
              path.join(dest, name),
              await sharp(input.files.get('source/preview.png'))
                .extract({ left, top, width, height })
                .png()
                .toBuffer(),
            )
            conflict.crop = `${s.store_id}/${name}`
          }
        }
        conflicts.push(conflict)
      }
      // 语法/几何错误不能渲染成看似正常的平面；其余原图问题可画出来供审查，不自动挪动物件。
      if (
        space &&
        layout &&
        !qa.issues.some((i) =>
          ['boundary_not_simple', 'space_schema', 'layout_schema'].includes(i.code),
        )
      ) {
        const rendered = await renderPlan(
          { ...plan, space, layout },
          bom,
          `${s.store_id} · ${s.name}${manifest.synthetic ? ' · 合成演示' : ''}`,
        )
        await writeFile(path.join(dest, 'plan.svg'), rendered.svg)
        await writeFile(path.join(dest, 'plan.pdf'), rendered.pdf)
        await writeFile(path.join(dest, 'plan.png'), rendered.png)
        if (
          Number.isFinite(plan.transform?.mmPerPixel) &&
          plan.transform.mmPerPixel > 0 &&
          plan.transform.originPx?.length === 2 &&
          plan.transform.originPx.every(Number.isFinite)
        ) {
          const overlay = svgOverlay(rendered.scene, plan, input)
          await writeFile(path.join(dest, 'overlay.svg'), overlay)
          await writeFile(
            path.join(dest, 'overlay.png'),
            await sharp(Buffer.from(overlay)).png().toBuffer(),
          )
          row.overlay = true
        }
        row.generated = true
      }
    } catch (e) {
      row.status = 'blocked'
      row.checkFile = 'failure.json'
      row.issues.push({ severity: 'error', code: 'input_or_correction', message: e.message })
      await save(path.join(dest, 'failure.json'), { store_id: s.store_id, message: e.message })
    }
  }
  const report = {
    schemaVersion: 1,
    synthetic: Boolean(manifest.synthetic),
    manifestSha256: jsonSha256(manifest),
    scope: 'B-input-and-C-review-drawings',
    count: rows.length,
    generated: rows.filter((r) => r.generated).length,
    automaticChecksPassed: rows.filter((r) => r.status === 'needs_cross_check').length,
    realCompleted: 0,
    trainingEligible: false,
    rows,
    limitations: [
      '自动检查通过仍待源图交叉核对及用户抽审',
      '未执行隔离编辑器保存重载，不报告C完整验收通过',
      '缺项/失败保留6家分母；不运行识别、不修改源图道具',
    ],
  }
  await save(path.join(out, 'quality-report.json'), report)
  await save(path.join(out, 'conflicts.json'), conflicts)
  await writeFile(
    path.join(out, 'training-eligibility.csv'),
    'store_id,eligible,reason\n' +
      rows
        .map(
          (r) =>
            `${r.store_id},false,${r.status === 'blocked' ? '存在阻塞项' : '待交叉核对及完整验收'}`,
        )
        .join('\n') +
      '\n',
  )
  const cards = rows
    .map(
      (r) =>
        `<article id="${escape(r.store_id)}"><h2>${escape(r.store_id + ' · ' + r.name)}</h2><p class="state">${escape(r.status)} · 未完成用户抽审</p><div class="pair">${r.original ? `<figure><figcaption>原图</figcaption><a href="../${r.store_id}/source/plan.pdf">原页PDF</a><img src="../${r.store_id}/source/preview.png" alt="原图"/></figure>` : '<p>输入未通过，未展示为有效原图。</p>'}${r.generated ? `<figure><figcaption>生成平面（审核草稿）</figcaption><a href="../${r.store_id}/plan.pdf">PDF</a> · <a href="../${r.store_id}/plan.svg">SVG</a><img src="../${r.store_id}/plan.png" alt="生成平面"/></figure>` : '<p>未生成平面；见下列缺项。</p>'}</div>${r.overlay ? `<details><summary>查看原图叠加</summary><img src="../${r.store_id}/overlay.png" alt="原图与校正结果叠图"/></details>` : ''}<ul>${r.issues.map((i) => `<li>${escape(i.code + '：' + i.message)}</li>`).join('')}</ul><a href="../${r.store_id}/${r.checkFile}">检查记录</a></article>`,
    )
    .join('')
  const qs = conflicts
    .map(
      (q) =>
        `<article><h3>${escape(q.store_id + ' · ' + q.question)}</h3>${q.crop ? `<img class="crop" src="../${q.crop}" alt="歧义原图局部"/>` : '<p>缺有效局部证据，不可据此裁决。</p>'}<p>选项：${escape((q.options ?? []).join('；'))}</p><p>推荐：${escape(q.recommendation ?? '未提供')}</p></article>`,
    )
    .join('')
  await writeFile(
    path.join(out, 'review/index.html'),
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>首批6家原图与平面对照</title><style>body{font:16px/1.6 system-ui;background:#f5f6f7;color:#222;margin:24px auto;max-width:1500px;padding:0 20px}article{background:white;padding:24px;margin:24px 0;border-radius:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0}img{max-width:100%;height:auto}figcaption{font-weight:700}.state{color:#9b5c00}.crop{max-height:420px}a{color:#235fa8}@media(max-width:850px){.pair{grid-template-columns:1fr}}</style><h1>${manifest.synthetic ? '合成演示 · 非真实6家' : '首批6家'}：原图与生成平面对照</h1><p>生成 ${report.generated}/6；自动检查通过 ${report.automaticChecksPassed}/6；完整验收 0/6。自动通过不等于交叉检查、用户抽审或训练准入。</p><p><a href="../quality-report.json">质量总表</a> · <a href="#conflicts">集中歧义 ${conflicts.length} 项</a> · <a href="../conflicts.json">歧义JSON</a></p>${cards}<h2 id="conflicts">集中歧义</h2>${qs || '<p>当前没有已提交的歧义条目，不代表真实图纸没有歧义。</p>'}</html>`,
  )
  const names = [
      'pilot-contract.mjs',
      'pilot-check.mjs',
      'pilot-input.mjs',
      'pilot-assets.mjs',
      'pilot-quality.mjs',
      'pilot-render.mjs',
      'pilot-first6.mjs',
    ],
    toolHashes = {}
  for (const name of names) toolHashes[name] = sha256(await readFile(path.join(toolRoot, name)))
  const revision = execFileSync(
    'git',
    ['-C', path.resolve(toolRoot, '../..'), 'rev-parse', 'HEAD'],
    { encoding: 'utf8' },
  ).trim()
  const dirty = Boolean(
    execFileSync(
      'git',
      ['-C', path.resolve(toolRoot, '../..'), 'status', '--porcelain', '--', 'tools/recognition'],
      { encoding: 'utf8' },
    ).trim(),
  )
  await mkdir(path.join(out, 'provenance'))
  for (const name of names)
    await copyFile(path.join(toolRoot, name), path.join(out, 'provenance', name))
  await writeFile(path.join(out, 'provenance/model-manifest.json'), modelBytes)
  await writeFile(path.join(out, 'provenance/body-footprint.json'), bodyBytes)
  for (const [rel, bytes] of catalog.snapshots) {
    const p = path.join(out, 'provenance/catalog', rel)
    await mkdir(path.dirname(p), { recursive: true })
    await writeFile(p, bytes)
  }
  for (const key of ['manifest', 'acceptance-index', 'development-index'])
    await copyFile(args[key], path.join(out, 'provenance', key + '.json'))
  await copyFile(
    path.join(args.repo, 'resources.lock.json'),
    path.join(out, 'provenance/resources.lock.json'),
  )
  await save(path.join(out, 'provenance.json'), {
    codeRevision: revision,
    uncommittedToolChanges: dirty,
    toolHashes,
    node: process.version,
    resourceLockSha256: manifest.resourceLockSha256,
    modelsVersion: manifest.modelsVersion,
    modelManifestSha256: sha256(modelBytes),
    bodyFootprintSha256: sha256(bodyBytes),
    manifestSha256: report.manifestSha256,
  })
  const hashes = {}
  async function hashTree(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix + entry.name
      if (entry.isDirectory()) await hashTree(path.join(dir, entry.name), rel + '/')
      else hashes[rel] = sha256(await readFile(path.join(dir, entry.name)))
    }
  }
  await hashTree(out)
  await save(path.join(out, 'file-hashes.json'), hashes)
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = {},
    allowed = [
      'manifest',
      'acceptance-index',
      'development-index',
      'repo',
      'resources',
      'bundle',
      'corrections',
      'out',
      'body-footprint-sha256',
    ]
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i].slice(2)
    need(
      process.argv[i].startsWith('--') &&
        allowed.includes(key) &&
        !args[key] &&
        process.argv[i + 1] &&
        !process.argv[i + 1].startsWith('--'),
      '参数错误/重复：' + process.argv[i],
    )
    args[key] = process.argv[i + 1]
  }
  const r = await runFirstSix(args)
  console.log(
    JSON.stringify({
      count: r.count,
      generated: r.generated,
      automaticChecksPassed: r.automaticChecksPassed,
      realCompleted: 0,
    }),
  )
  if (r.automaticChecksPassed !== 6) process.exitCode = 1
}
