import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isSimplePolygon } from '../../packages/shared/src/index.ts'
const read = async (name) =>
  JSON.parse(await readFile(new URL('../../docs/' + name, import.meta.url), 'utf8'))
const frozen = await read('recognition-development-20261029-v1.json')
const refs = await read('recognition-development-20261030-reference-drafts.json')
assert.equal(refs.datasetFingerprint, frozen.fingerprint)
assert.equal(refs.humanReviewed, false)
assert.equal(refs.samples.length, frozen.samples.length)
assert.equal(new Set(refs.samples.map((s) => s.id)).size, frozen.samples.length)
for (const r of refs.samples) {
  const sample = frozen.samples.find((s) => s.id === r.id)
  assert.ok(sample, r.id + ' 不在固定清单中')
  assert.equal(r.sourceSha256, sample.sourceSha256)
  assert.equal(r.imageSha256, sample.image.sha256)
  assert.equal(r.humanReviewed, false)
  assert.equal(r.referenceKind, 'agent_visual_draft')
  assert.ok(isSimplePolygon(r.boundary), r.id + ' 非简单多边形')
  for (const p of [...r.boundary, ...r.calibration, ...r.entrance])
    assert.ok(
      p.length === 2 &&
        p.every(Number.isFinite) &&
        p[0] >= 0 &&
        p[0] <= sample.image.width &&
        p[1] >= 0 &&
        p[1] <= sample.image.height,
      r.id + ' 坐标越界',
    )
  assert.equal(r.calibration.length, 2)
  assert.ok(Number.isFinite(r.lengthMm) && r.lengthMm > 0)
  assert.ok(
    Math.hypot(
      r.calibration[1][0] - r.calibration[0][0],
      r.calibration[1][1] - r.calibration[0][1],
    ) > 5,
  )
  assert.ok(
    r.acceptedEntranceEdges.every((i) => Number.isInteger(i) && i >= 0 && i < r.boundary.length),
  )
  for (const value of Object.values(r.componentReview)) assert.equal(typeof value, 'boolean')
  if (r.agentStatus === 'checked')
    assert.ok(!r.question && Object.values(r.componentReview).every(Boolean))
  else assert.ok(r.question && r.agentStatus === 'needs_decision')
}
console.log('固定开发集参照校验通过：48 家身份/原图指纹、几何、量尺、入口边、草稿与歧义状态一致')
