import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { inspectGeometry } from './cloud-compare-geometry.mjs'
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'))
const { results, out, proposal, localResults } = config
await fs.mkdir(out)
const json = async (p) => JSON.parse((await fs.readFile(p, 'utf8')).replace(/^\uFEFF/, ''))
const frozen = await json(results + '/responses-frozen.json'),
  reports = []
const ids = config.samples.map((s) => s.sourceId),
  names = config.samples.map((s) => s.name)
const crop = [100, 70],
  size = { width: 1770, height: 1415 }
for (let n = 1; n <= 3; n++) {
  const id = `case-${n}`,
    answer = await json(`${results}/${id}.answer.json`),
    status = frozen.statuses[n - 1]
  const response = await fs.readFile(`${results}/${id}.response.json`)
  if (createHash('sha256').update(response).digest('hex') !== status.responseSha256)
    throw Error('原响应变化')
  const review = config.reviews.find((r) => r.case === id)
  if (
    !review ||
    review.responseSha256 !== status.responseSha256 ||
    review.completeWithoutCorrection !== false
  )
    throw Error('本轮失败报告须有绑定当前响应的逐图检查，不能复用旧结论')
  const bytes = await fs.readFile(`${proposal}/${id}.png`)
  const data = bytes.toString('base64'),
    analysis = inspectGeometry(answer, size)
  const dest = path.join(out, id)
  await fs.mkdir(dest)
  await fs.writeFile(dest + '/analysis.json', JSON.stringify(analysis, null, 2))
  await fs.writeFile(dest + '/input.png', bytes)
  for (const type of ['answer', 'response', 'status'])
    await fs.copyFile(`${results}/${id}.${type}.json`, `${dest}/${type}.json`)
  const start = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.width} ${size.height}"><image href="data:image/png;base64,${data}" width="${size.width}" height="${size.height}"/>`
  const valid = (p) =>
    Array.isArray(p) &&
    p.length >= 2 &&
    p.every((v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite))
  const poly = (p, color, fill = 'none') =>
    !valid(p)
      ? ''
      : `<polygon points="${p.map((v) => v.join(',')).join(' ')}" fill="${fill}" stroke="${color}" stroke-width="4"/>`
  let raw = start,
    hypothesis = start
  for (const r of answer.regions ?? []) {
    if (!valid(r.points)) continue
    raw += poly(r.points, '#d32b20')
    hypothesis += poly(
      r.points.map((p) => [(p[0] * size.width) / 1000, (p[1] * size.height) / 1000]),
      '#d32b20',
    )
  }
  for (const e of answer.entrances ?? []) {
    if (!valid(e.path)) continue
    raw += `<polyline points="${e.path.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#e3a000" stroke-width="7"/>`
  }
  for (const o of answer.obstacles ?? []) {
    const p =
      o.points ??
      (o.bbox
        ? [
            [o.bbox[0], o.bbox[1]],
            [o.bbox[2], o.bbox[1]],
            [o.bbox[2], o.bbox[3]],
            [o.bbox[0], o.bbox[3]],
          ]
        : null)
    if (p) raw += poly(p, '#8a3fb1')
  }
  await fs.writeFile(dest + '/cloud-raw.svg', raw + '</svg>')
  await fs.writeFile(dest + '/coordinate-hypothesis.svg', hypothesis + '</svg>')
  const local = await json(`${localResults}/${ids[n - 1]}/raw.json`)
  await fs.writeFile(
    dest + '/local.svg',
    start +
      local.polygons
        .map((p) =>
          poly(
            p.points.map(([x, y]) => [x - crop[0], y - crop[1]]),
            '#d32b20',
          ),
        )
        .join('') +
      '</svg>',
  )
  reports.push({
    id,
    name: names[n - 1],
    sourceIdLocalOnly: ids[n - 1],
    ...analysis,
    status,
    review,
    estimatedListPriceCNY:
      (status.usage.prompt_tokens * config.inputPricePerMillion) / 1e6 +
      (status.usage.completion_tokens * config.outputPricePerMillion) / 1e6,
  })
}
const totals = {
  imageRequests: frozen.requestAttempts,
  successfulResponses: frozen.statuses.filter((s) => s.httpStatus === 200).length,
  automaticComplete: reports.filter(
    (r) => r.review.completeWithoutCorrection && r.geometryChecksPassed,
  ).length,
  promptTokens: reports.reduce((a, r) => a + r.status.usage.prompt_tokens, 0),
  completionTokens: reports.reduce((a, r) => a + r.status.usage.completion_tokens, 0),
  estimatedListPriceCNY: reports.reduce((a, r) => a + r.estimatedListPriceCNY, 0),
  priceSource: 'https://help.aliyun.com/zh/model-studio/model-pricing',
  billingConfirmed: false,
  priceObservedAt: config.priceObservedAt,
  productCloudEnabled: false,
}
await fs.writeFile(
  out + '/比较记录.json',
  JSON.stringify(
    {
      totals,
      reports,
      notes: [
        '按官方北京实时价估算，未读取账单，实际扣费可能受额度/优惠影响。',
        '本地为原整页、云端为已批准裁图，不能把结果差异单独归因为模型。',
        '归一化坐标图仅诊断假设，不是修正结果，不参与通过判断。',
      ],
    },
    null,
    2,
  ),
)
await fs.copyFile(config.approval, out + '/本轮授权记录.json')
await fs.copyFile(results + '/request-manifest.json', out + '/实际发送清单.json')
await fs.copyFile(results + '/responses-frozen.json', out + '/冻结响应清单.json')
console.log(
  JSON.stringify({
    out,
    totals,
    cases: reports.map((r) => ({
      id: r.id,
      errors: r.issues.map((i) => i.code),
      regionCount: r.regionCount,
      entranceCount: r.entranceCount,
    })),
  }),
)
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
const findings = reports.map((r) => r.review.finding)
const cards = reports
  .map(
    (r, i) =>
      `<article class="panel" id="${r.id}"><h2>${escape(r.name)} <small>${escape(r.sourceIdLocalOnly)}</small></h2><p><b class="badge">未通过</b> ${escape(findings[i])}</p><p class="muted">${r.regionCount}个范围候选 · ${r.entranceCount}条入口 · ${r.status.seconds.toFixed(1)}秒 · 标价估算¥${r.estimatedListPriceCNY.toFixed(5)}</p><p class="legend">红：范围　黄：入口　紫：障碍；按请求约定的原图像素坐标绘制，没有修正。</p><a href="${r.id}/cloud-raw.svg"><img src="${r.id}/cloud-raw.svg" alt="${escape(r.name)}云端原始坐标叠加" loading="lazy"></a><details><summary>与本地结果对照</summary><p>本地识别输入为整页，云端为裁图；此对照不能单独证明某个模型更好。</p><img src="${r.id}/local.svg" alt="同店本地候选"></details><details><summary>坐标约定诊断（不计作修正）</summary><p>假设输出用了0—1000坐标，再映射到原图；仍有范围错误。这只是检查假设，模型未声明该约定，不能自动采用。</p><img src="${r.id}/coordinate-hypothesis.svg" alt="仅诊断用的归一化坐标假设"></details><details><summary>拦截原因与原始返回</summary><ul>${r.issues.map((x) => `<li>${escape(x.message)}</li>`).join('')}</ul><p><a href="${r.id}/answer.json">模型答案</a> · <a href="${r.id}/response.json">完整API响应</a> · <a href="${r.id}/analysis.json">本地校验</a> · <a href="${r.id}/status.json">耗时与用量</a></p></details></article>`,
  )
  .join('')
const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>三图云端对照 · 本轮结果</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f4ef;color:#171717;font:16px/1.65 system-ui,'Microsoft Yahei',sans-serif}header{padding:18px 25px;background:#171717;color:white}header b{color:#ffd400}main{max-width:1150px;margin:auto;padding:24px}.panel{background:white;border:1px solid #ddd8ce;border-radius:12px;padding:24px;margin-bottom:24px}h1{font-size:29px;margin:0 0 15px}h2{font-size:21px}small,.muted{color:#68645b}small{font-size:14px}.badge{background:#ffd400;padding:3px 8px;border-radius:4px}.notice{background:#fff2b1;border-left:5px solid #171717;padding:15px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.stat{background:#171717;color:white;padding:17px;border-radius:8px}.stat b{display:block;font-size:29px;color:#ffd400}a{color:#171717;text-underline-offset:4px}img{display:block;width:100%;height:auto;border:1px solid #ddd;margin:16px 0;border-radius:4px}details{margin:15px 0}summary{cursor:pointer;font-weight:600}.legend{font-size:14px}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;border-bottom:1px solid #ddd;padding:10px}pre{white-space:pre-wrap;word-break:break-all}@media(max-width:650px){main{padding:12px}.panel{padding:16px}.grid{grid-template-columns:1fr}h1{font-size:24px}}</style></head><body><header><b>门店设计工作台</b> · 已授权三图对照 / 2026-11-12</header><main><section class="panel"><h1>直接让视觉模型输出坐标，仍不可靠</h1><p>已按你的授权完成3张图的真实百炼调用。每张只发送一次；先冻结原始返回，再叠图和校验。没有发45家验收、48家开发或训练答案。</p><div class="grid"><div class="stat"><b>3 / 3</b>真实请求成功返回</div><div class="stat"><b>0 / 3</b>自动完整可用门店</div><div class="stat"><b>¥${totals.estimatedListPriceCNY.toFixed(5)}</b>按官方标价估算，未查实际账单</div></div><p class="notice">API调用成功、JSON能解析，都不等于图纸识别正确。三张均被几何与尺寸检查拦截，未导入错误门店，产品云端开关仍默认关闭。</p><p>服务：阿里云百炼北京接口；实际模型：qwen3-vl-plus。原拟快照已返回404，因此采用同系列可用别名；实际版本无法固定为快照。共${totals.promptTokens + totals.completionTokens} tokens，单张34.6—37.7秒。</p><p><a href="#case-1">合肥</a> · <a href="#case-2">武昌</a> · <a href="#case-3">武汉</a> · <a href="#next">结论与下一步</a></p></section>${cards}<section class="panel" id="next"><h2>这次对路线的判断</h2><p><b>不能把“看图、判断范围、精确描边、标尺寸”全部交给模型一次完成。</b>本轮只能证明这套单次调用方式失败，不能据3张图断言所有视觉模型都不可行。</p><ol><li>先固定坐标协议，并把图片里的线段、尺寸文字和区域候选由本地工具编号；保留它们的真实像素位置。</li><li>让视觉模型主要判断区域归属和构件类别，输出候选编号；精确线段由本地几何程序组合。这样可以减少模型编造坐标，但仍需真实验证。</li><li>组合结果必须过尺寸一致性、入口贴边和原图叠加检查，失败只进入审核；通过新样本后再用48家复评。</li></ol><p class="notice">本轮无需你重新描这3张图。模型提出的多数“疑问”来自明显误读，已保留原文作证据，不当成你的审核任务。后续真正的范围歧义仍集中列出。</p><p>家具识别在空间路线验证后另做；已有人工摆放和灯箱/广告机贴墙面的展示方式保留。45家继续只用于最终验收。</p></section><section class="panel"><h2>发送与结果记录</h2><p><a href="本轮授权记录.json">授权范围</a> · <a href="实际发送清单.json">实际发送指纹</a> · <a href="冻结响应清单.json">响应冻结记录</a> · <a href="比较记录.json">完整比较记录</a></p><p>请求只含已批准裁图、原提示词、匿名编号及图片宽高。没有重试、追加图纸、追加历史答案；产品设置未更改。</p><p>费用按本轮查询的北京实时输入¥1/百万tokens、输出¥10/百万tokens估算；不是账单实扣。<a href="https://help.aliyun.com/zh/model-studio/model-pricing" target="_blank" rel="noreferrer">官方价格</a> · <a href="https://help.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai" target="_blank" rel="noreferrer">官方地域接口说明</a></p><p class="muted">旧本地候选和审核包保持原样。本轮不计算IoU，不用人工修图后的结果冒充自动成功。</p></section></main></body></html>`
await fs.writeFile(out + '/审核页.html', page, { flag: 'wx' })
