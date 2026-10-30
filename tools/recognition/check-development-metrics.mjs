import assert from 'node:assert/strict'
import { iou, intersectionArea, entranceMatches } from './development-metrics.mjs'
const a = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  b = [
    [5, 0],
    [15, 0],
    [15, 10],
    [5, 10],
  ],
  l = [
    [0, 0],
    [10, 0],
    [10, 4],
    [4, 4],
    [4, 10],
    [0, 10],
  ]
assert.equal(iou(a, a), 1)
assert.equal(intersectionArea(a, b), 50)
assert.equal(iou(a, b), 1 / 3)
assert.equal(
  iou(a, [
    [20, 0],
    [30, 0],
    [30, 10],
    [20, 10],
  ]),
  0,
)
assert.equal(intersectionArea(a, l), 64)
assert.equal(
  intersectionArea(a, [
    [0, 0],
    [10, 10],
    [0, 10],
  ]),
  50,
)
assert.equal(iou(l, [...l].reverse()), 1)
assert.equal(
  entranceMatches(
    a,
    [2],
    [
      [
        [3, 10],
        [7, 10],
      ],
    ],
    1,
  ),
  true,
)
assert.equal(
  entranceMatches(
    a,
    [2],
    [
      [
        [3, 0],
        [7, 0],
      ],
    ],
    1,
  ),
  false,
)
assert.equal(
  entranceMatches(
    a,
    [2],
    [
      [
        [3, 25],
        [7, 25],
      ],
    ],
    1,
  ),
  false,
)
assert.equal(iou([], a), 0)
console.log('开发集指标校验通过：相同、平移、分离、凹形、斜线、反向、入口边与距离、空结果（11 项）')
