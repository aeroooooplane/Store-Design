import { toClockwise } from '../geometry/index.ts'
import { expect, it } from 'vitest'
import { SpaceSchema, normalizeSpace, validateSpace } from './space.ts'
const fixtures = [
  {
    schemaVersion: 1,
    boundary: [
      [3.0976744186046514, 0],
      [5.55, 0],
      [5.55, 4.115891472868218],
      [0, 4.115891472868218],
      [0, 2.2085271317829456],
      [0.9895348837209302, 2.2085271317829456],
      [1.348062015503876, 1.85],
      [1.348062015503876, 0.4158914728682171],
      [2.724806201550388, 0.4158914728682171],
    ],
    height: 3,
    obstacles: [
      {
        kind: 'fixed',
        polygon: [
          [1.7008564188850834, 1.8063074935400516],
          [2.724806201550388, 0.4158914728682171],
          [2.736249398556536, 0.4031279069767444],
          [2.7536317829457366, 0.4031279069767444],
          [2.7536317829457366, 1.8063074935400516],
        ],
        height: null,
        addedLater: true,
        label: '补标墙体 [PDF-096-WALL-2:1]',
      },
    ],
  },
  {
    schemaVersion: 1,
    boundary: [
      [1.2060480961923847, 1.4507535070140283],
      [1.2410060120240483, 2.953943887775551],
      [0.017478957915831664, 3.023859719438878],
      [0, 7.288725450901804],
      [0.9613426853707415, 7.218809619238478],
      [1.8178116232464931, 7.166372745490982],
      [2.6917595190380763, 7.166372745490982],
      [3.5482284569138276, 7.166372745490982],
      [4.911587174348698, 7.218809619238478],
      [6.1351142284569145, 7.341162324649299],
      [7.009062124248498, 7.306204408817635],
      [7.411078156312626, 7.25376753507014],
      [7.900488977955913, 6.991583166332665],
      [8.09275751503006, 6.624525050100201],
      [8.232589178356713, 6.10015631262525],
      [8.232589178356713, 5.768056112224449],
      [8.529731462925852, 1.6430220440881764],
      [8.652084168336675, 0.2796633266533066],
      [5.87292985971944, 0],
      [5.768056112224449, 1.3983166332665333],
    ],
    height: 3,
    obstacles: [
      {
        kind: 'fixed',
        polygon: [
          [0.0037871075484297305, 6.36467120908495],
          [0.017379615144267023, 3.04809935570065],
          [0.16546746826987263, 3.3344025384101537],
          [0.16546746826987263, 5.748829258517034],
          [0.005100253178111497, 7.288354523397942],
          [0.0037871075484297305, 7.288450024898282],
        ],
        height: null,
        addedLater: true,
        label: '补标墙体 [PDF-140-WALL-1:4]',
      },
    ],
  },
]
for (const [index, fixture] of fixtures.entries())
  it('保留斜边裁切墙体精度并保证重复保存幂等 ' + index, () => {
    const space = SpaceSchema.parse(fixture),
      before = structuredClone(space)
    expect(validateSpace(space).filter((i) => i.severity === 'error')).toEqual([])
    const normalized = normalizeSpace(space)
    expect(normalized.boundary).toEqual(toClockwise(space.boundary))
    expect(normalized.obstacles).toEqual(
      space.obstacles.map((o) => ({ ...o, polygon: toClockwise(o.polygon) })),
    )
    expect(validateSpace(normalized).filter((i) => i.severity === 'error')).toEqual([])
    expect(normalizeSpace(normalized)).toEqual(normalized)
    expect(space).toEqual(before)
  })
it('原本越界的墙继续报告错误', () => {
  const space = SpaceSchema.parse({
    schemaVersion: 1,
    boundary: [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 5],
    ],
    height: 3,
    obstacles: [
      {
        kind: 'fixed',
        polygon: [
          [4, 1],
          [6, 1],
          [6, 2],
          [4, 2],
        ],
      },
    ],
  })
  expect(
    validateSpace(normalizeSpace(space)).some((i) => i.code === 'obstacle_outside_boundary'),
  ).toBe(true)
})
