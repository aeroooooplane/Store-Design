// 默认仅准备，不发送。必须给出本轮范围确认文件，并显式 --execute。
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { ENDPOINT, MODEL, sha256, prepareRequests, extractAnswer } from './cloud-compare-core.mjs'

const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'))
const approvalBytes = await fs.readFile(config.approval)
const approval = JSON.parse(approvalBytes.toString('utf8').replace(/^\uFEFF/, ''))
const manifestBytes = await fs.readFile(path.join(config.proposal, '发送清单.json'))
const promptBytes = await fs.readFile(path.join(config.proposal, '拟发送提示词.txt'))
// 先限定固定文件名，绝不按不可信清单任意读取文件。
const images = await Promise.all(
  [1, 2, 3].map(async (n) => ({
    name: `case-${n}.png`,
    bytes: await fs.readFile(path.join(config.proposal, `case-${n}.png`)),
  })),
)
const plans = prepareRequests({ manifestBytes, promptBytes, approval, images })
const out = path.resolve(config.output)
await fs.mkdir(out, { recursive: false })
const receipt = {
  provider: approval.provider,
  region: 'cn-beijing',
  endpoint: ENDPOINT,
  model: MODEL,
  approvalSha256: sha256(approvalBytes),
  manifestSha256: sha256(manifestBytes),
  promptSha256: sha256(promptBytes),
  cases: plans.map(({ request, ...meta }) => meta),
  imagesSentAtPreparation: 0,
  productCloudEnabled: false,
  createdAt: new Date().toISOString(),
}
await fs.writeFile(path.join(out, 'request-manifest.json'), JSON.stringify(receipt, null, 2), {
  flag: 'wx',
})
if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ prepared: true, imagesSent: 0, cases: plans.length }))
  process.exit(0)
}
const credentials = config.envFile
  ? parseEnv(await fs.readFile(config.envFile, 'utf8'))
  : process.env
const apiKey = credentials.DASHSCOPE_API_KEY
if (!apiKey?.trim()) throw Error('缺少百炼凭据；尚未发送图片')
const statuses = []
for (const plan of plans) {
  const began = Date.now(),
    startedAt = new Date().toISOString()
  // 每张最多一次请求；失败也记录并继续其它样本，不暗中重试或换图。
  const status = {
    case: plan.caseId,
    startedAt,
    imageSha256: plan.imageSha256,
    attempts: 1,
    requestInitiated: true,
  }
  await fs.writeFile(
    path.join(out, `${plan.caseId}.started.json`),
    JSON.stringify(status, null, 2),
    { flag: 'wx' },
  )
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(plan.request),
      redirect: 'error',
      signal: AbortSignal.timeout(240000),
    })
    const responseText = await response.text()
    await fs.writeFile(path.join(out, `${plan.caseId}.response.json`), responseText, { flag: 'wx' })
    Object.assign(status, {
      httpStatus: response.status,
      seconds: (Date.now() - began) / 1000,
      responseSha256: sha256(responseText),
      requestId: response.headers.get('x-request-id'),
    })
    const data = JSON.parse(responseText)
    status.usage = data.usage ?? null
    status.returnedModel = data.model ?? null
    if (!response.ok) {
      status.errorCode = data.error?.code ?? data.code ?? 'http-error'
    } else {
      try {
        const answer = extractAnswer(data)
        await fs.writeFile(
          path.join(out, `${plan.caseId}.answer.json`),
          JSON.stringify(answer, null, 2),
          { flag: 'wx' },
        )
        status.answerParsed = true
      } catch (e) {
        status.answerParsed = false
        status.parseError = e.name
      }
    }
  } catch (e) {
    Object.assign(status, {
      seconds: (Date.now() - began) / 1000,
      errorType: e.name,
      errorCode: e.cause?.code ?? null,
      deliveryUnknown: true,
    })
  }
  await fs.writeFile(
    path.join(out, `${plan.caseId}.status.json`),
    JSON.stringify(status, null, 2),
    { flag: 'wx' },
  )
  statuses.push(status)
  console.log(
    JSON.stringify({
      case: plan.caseId,
      httpStatus: status.httpStatus,
      seconds: status.seconds,
      answerParsed: status.answerParsed,
      errorCode: status.errorCode,
    }),
  )
}
await fs.writeFile(
  path.join(out, 'responses-frozen.json'),
  JSON.stringify(
    {
      frozenBeforeVisualReview: true,
      statuses,
      requestAttempts: statuses.length,
      requestsAcknowledged: statuses.filter((s) => s.httpStatus !== undefined).length,
      productCloudEnabled: false,
    },
    null,
    2,
  ),
  { flag: 'wx' },
)
