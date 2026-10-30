// 校验审核门槛和本机草稿行为；纯合成数据，不读任何门店标注。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const sample = { id: 'SYNTHETIC', image: { width: 500, height: 500 }, name: '合成测试' }
const dataset = { id: 'synthetic', fingerprint: 'synthetic', samples: [sample] }
const template = await readFile(new URL('./review-template.html', import.meta.url), 'utf8')
const code = template
  .match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/\/\*DATASET\*\/\s*null/, JSON.stringify(dataset))
const nodes = new Map()
const document = {
  querySelector(selector) {
    if (!nodes.has(selector))
      nodes.set(selector, {
        value: selector === '#filter' ? 'all' : '',
        style: {},
        addEventListener() {},
        setAttribute() {},
      })
    return nodes.get(selector)
  },
  querySelectorAll: () => [],
}
const context = vm.createContext({ document, localStorage: { getItem: () => null, setItem() {} } })
vm.runInContext(code + '\nglobalThis.api = {validate, safeRecord, scaleOf, fresh};', context)
const { validate, safeRecord, scaleOf, fresh } = context.api
const valid = {
  ...fresh(),
  boundary: [
    [20, 20],
    [220, 20],
    [220, 220],
    [20, 220],
  ],
  calibration: [
    [20, 20],
    [220, 20],
  ],
  lengthMm: 2000,
  entrance: [
    [50, 20],
    [100, 20],
  ],
  geometry: '直墙',
  pageType: 'vector-text',
  reviewer: '合成测试',
}
assert.equal(validate(valid, sample).length, 0)
assert.equal(scaleOf(valid), 10)
assert.ok(validate(fresh(), sample).length > 0)
assert.ok(
  validate(
    {
      ...valid,
      boundary: [
        [20, 20],
        [220, 220],
        [20, 220],
        [220, 20],
      ],
    },
    sample,
  ).some((s) => s.includes('自相交')),
)
assert.ok(
  validate(
    {
      ...valid,
      entrance: [
        [20, 20],
        [220, 220],
      ],
    },
    sample,
  ).some((s) => s.includes('同一段边界')),
)
assert.equal(scaleOf({ ...valid, lengthMm: Infinity }), null)
assert.throws(() => safeRecord({ ...valid, boundary: [[NaN, 20]] }, sample), /坐标无效/)
assert.throws(() => safeRecord({ ...valid, boundary: [['<script>', 20]] }, sample), /坐标无效/)
context.testRecord = valid
vm.runInContext(
  "current='SYNTHETIC'; records[current]={...testRecord,status:'reviewed',reviewedAt:'测试'}; mutate(); globalThis.changed=records[current];",
  context,
)
assert.equal(context.changed.status, 'pending')
assert.equal(context.changed.reviewedAt, undefined)
assert.equal(
  safeRecord({ ...valid, origin: 'recognizer', status: 'reviewed' }, sample).status,
  'pending',
)
assert.equal(
  safeRecord({ ...valid, origin: 'visual-correction', agentStatus: 'checked' }, sample).status,
  'pending',
)
assert.equal(
  safeRecord({ ...valid, origin: 'unknown', agentStatus: 'approved' }, sample).origin,
  'manual',
)
console.log('审核页校验通过：几何、量尺、入口、导入、修改撤回及机器草稿不冒充审核（12 项）')
