import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ENDPOINT, MODEL, sha256, prepareRequests, extractAnswer } from './cloud-compare-core.mjs'

function fixture() {
  const images = [1, 2, 3].map((n) => {
    const bytes = Buffer.alloc(24, n)
    Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes)
    bytes.writeUInt32BE(1770, 16)
    bytes.writeUInt32BE(1415, 20)
    return { name: `case-${n}.png`, bytes }
  })
  const files = images.map((i, n) => ({
    case: `case-${n + 1}`,
    file: i.name,
    sha256: sha256(i.bytes),
    size: [1770, 1415],
    sourceIdLocalOnly: 'NEVER-SEND-THIS',
  }))
  const manifestBytes = Buffer.from(JSON.stringify({ files })),
    promptBytes = Buffer.from('输出JSON，只读取本图。')
  const approval = {
    approved: true,
    region: 'cn-beijing',
    endpoint: ENDPOINT,
    model: MODEL,
    manifestSha256: sha256(manifestBytes),
    promptSha256: sha256(promptBytes),
    files: files.map((f) => ({ case: f.case, sha256: f.sha256 })),
  }
  return { images, manifestBytes, promptBytes, approval }
}
test('未批准、域名地域模型不符时不准备请求', () => {
  for (const patch of [
    { approved: false },
    { region: 'sg' },
    { endpoint: 'https://example.invalid' },
    { model: 'other' },
  ]) {
    const f = fixture()
    assert.throws(() => prepareRequests({ ...f, approval: { ...f.approval, ...patch } }))
  }
})
test('提示词、清单、图片被改动或新增第四张即拒绝', () => {
  for (const mutate of [
    (f) => (f.promptBytes = Buffer.from('new')),
    (f) => (f.manifestBytes = Buffer.from('{}')),
    (f) => f.images[0].bytes[23]++,
    (f) => f.images.push(f.images[0]),
  ]) {
    const f = fixture()
    mutate(f)
    assert.throws(() => prepareRequests(f))
  }
})
test('请求只有获准图片和提示词，不带来源编号、审核答案或本地路径', () => {
  const f = fixture(),
    requests = prepareRequests(f)
  assert.equal(requests.length, 3)
  const payload = JSON.stringify(requests.map((r) => r.request))
  assert.ok(!payload.includes('NEVER-SEND-THIS'))
  assert.equal(requests[0].request.messages.length, 1)
  assert.equal(requests[0].request.messages[0].content.length, 2)
  assert.equal(requests[0].request.model, MODEL)
  assert.equal(requests[0].requestSha256, sha256(JSON.stringify(requests[0].request)))
})
test('截断、缺失或无效JSON响应保留为失败，不修补成成功', () => {
  const r = { choices: [{ finish_reason: 'stop', message: { content: '{"regions":[]}' } }] }
  assert.deepEqual(extractAnswer(r), { regions: [] })
  for (const bad of [
    { choices: [] },
    { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '```json\n{}\n```' } }] },
  ])
    assert.throws(() => extractAnswer(bad))
})
