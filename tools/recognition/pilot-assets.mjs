import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { safePath, need } from './pilot-input.mjs'
import { sha256 } from './pilot-contract.mjs'
import { WALL_ART_ID, wallArtAsset } from '../../packages/shared/src/catalog/wall-art.ts'
import { roundM } from '../../packages/shared/src/units.ts'

// 与工作台一致优先取网页转换尺寸，不能用源SU外框替代实际GLB尺寸。
// 只读本次涉及的转换记录，冻结原字节。此检查不加载/验证GLB内容或替代编辑器验收。
export function catalogReader({ resources, model, bodies, lock }) {
  const cache = new Map(),
    snapshots = new Map()
  async function forLayout(layout) {
    const assets = new Map()
    for (const id of new Set((layout?.items ?? []).map((i) => i.assetId).filter(Boolean))) {
      if (cache.has(id)) {
        assets.set(id, cache.get(id))
        continue
      }
      if (id === WALL_ART_ID) {
        assets.set(id, wallArtAsset())
        continue
      }
      const a = model.assets.find((a) => a.asset_id === id)
      if (!a) continue
      const dims = a.tight_face_bounds_xyz_mm
      need(
        Array.isArray(dims) && dims.length === 3 && dims.every((v) => Number.isFinite(v) && v >= 0),
        '资产源尺寸无效：' + id,
      )
      let raw = { w: dims[0] / 1000, d: dims[1] / 1000, h: dims[2] / 1000 }
      if (a.web_model) {
        const rel = path.posix.join('04_模型库', a.web_model, 'conversion.json'),
          bytes = await readFile(await safePath(resources, rel))
        const expected = lock.requiredFiles[rel]
        need(!expected || sha256(bytes) === expected.toLowerCase(), '资产转换指纹不符：' + id)
        const c = JSON.parse(bytes.toString().replace(/^\uFEFF/, ''))
        need(
          c.id === id &&
            ['w', 'd', 'h'].every((k) => Number.isFinite(c.dimensions?.[k]) && c.dimensions[k] > 0),
          '资产转换尺寸无效：' + id,
        )
        raw = c.dimensions
        snapshots.set(rel, bytes)
      }
      const body = bodies[id]
      if (body)
        need(
          [body.w, body.d].every((v) => Number.isFinite(v) && v > 0) &&
            body.w <= raw.w + 0.01 &&
            body.d <= raw.d + 0.01 &&
            body.offset?.length === 2 &&
            body.offset.every(Number.isFinite),
          '桌体尺寸/偏移无效：' + id,
        )
      const asset = {
        id,
        footprint: {
          w: roundM(Math.max(body?.w ?? raw.w, 0.001)),
          d: roundM(Math.max(body?.d ?? raw.d, 0.001)),
          h: roundM(Math.max(raw.h, 0.001)),
        },
        placeable: Boolean(a.web_model),
        retired: Boolean(a.retired),
        extent: body
          ? {
              w: roundM(raw.w),
              d: roundM(raw.d),
              cx: roundM(-body.offset[0]),
              cz: roundM(-body.offset[1]),
            }
          : null,
      }
      assets.set(id, asset)
      cache.set(id, asset)
    }
    return assets
  }
  return { forLayout, snapshots }
}
