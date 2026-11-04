import test from 'node:test'
import assert from 'node:assert/strict'
import { expandEntrance, scoreEntrances } from './entrance-metrics.mjs'
const line = (...points) => ({ kind: 'polyline', points }),
  score = (a, b) => scoreEntrances(a, b, { coverage: 'complete' })
test('多个入口必须全部覆盖，不能只命中其中一个', () => {
  const a = [line([0, 0], [100, 0]), line([200, 0], [300, 0])]
  assert.equal(score(a, a).pass, true)
  assert.equal(score(a, [a[0]]).recall, 0.5)
  assert.equal(score(a, [a[0]]).pass, false)
})
test('折线拆成多段或反向不改变覆盖', () => {
  const a = [line([0, 0], [100, 0], [100, 100])],
    b = [line([100, 100], [100, 0]), line([100, 0], [0, 0])]
  assert.equal(score(a, b).pass, true)
})
test('穿过内部的对角线不会仅凭端点通过', () => {
  assert.equal(score([line([0, 0], [100, 0], [100, 100])], [line([0, 0], [100, 100])]).pass, false)
})
test('错侧、遗漏、额外、重复入口均不通过', () => {
  const a = [line([0, 0], [100, 0])]
  for (const b of [[], [line([0, 50], [100, 50])], [...a, line([200, 0], [300, 0])], [...a, ...a]])
    assert.equal(score(a, b).pass, false)
})
test('圆弧与沿圆弧折线一致', () => {
  const a = {
    kind: 'arc',
    points: [
      [0, 100],
      [100, 0],
      [200, 100],
    ],
  }
  assert.equal(score([a], [line(...expandEntrance(a))]).pass, true)
  assert.equal(score([a], [line([0, 100], [200, 100])]).pass, false)
})
test('部分旧入口不产生完整precision/recall/F1或通过状态', () => {
  const a = [line([0, 0], [100, 0])],
    r = scoreEntrances(a, a)
  assert.equal(r.knownReferenceCoverage, 1)
  for (const k of ['precision', 'recall', 'f1', 'pass']) assert.equal(r[k], null)
})
test('退化圆弧、非有限坐标和空完整参照拒绝', () => {
  assert.throws(() =>
    expandEntrance({
      kind: 'arc',
      points: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    }),
  )
  assert.throws(() => score([line([NaN, 0], [10, 0])], []))
  assert.throws(() => score([], []))
})
test('短路径按实际长度加权，不按入口数量平均', () => {
  const a = [line([0, 0], [100, 0]), line([200, 0], [210, 0])]
  assert.ok(Math.abs(score(a, [a[1]]).recall - 10 / 110) < 1e-9)
})
test('按1px短段拆分不误报重复入口', () => {
  assert.equal(
    score(
      [line([0, 0], [100, 0])],
      Array.from({ length: 100 }, (_, i) => line([i, 0], [i + 1, 0])),
    ).pass,
    true,
  )
})
