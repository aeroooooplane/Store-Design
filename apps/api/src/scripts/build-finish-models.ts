import { buildFinishModel } from '../modules/assets/finish-models.ts'
import { FinishRecordSchema } from '../modules/assets/light-records.ts'
import { runLightBuild } from './light-build.ts'

// Builds the light material GLB next to every web model listed in the library manifest
// (资源库/04_模型库). Skips models whose finish.json already matches the current model.glb.
// Usage: [asset-id ...] (none = all; named models are rebuilt).
await runLightBuild({
  kind: 'finish',
  title: '材质轻量版',
  record: FinishRecordSchema,
  build: buildFinishModel,
  describe: (id, record, seconds) =>
    `${id}: 绘制 ${record.drawsBefore} → ${record.drawsAfter} 次，` +
    `${Math.round(record.sourceBytes / 1024)} → ${Math.round(record.bytes / 1024)} KB，` +
    `${record.trianglesBefore} → ${record.trianglesAfter} 面，碎片贴图 ${record.specks}，` +
    `正反面 ${record.pairedTriangles} 个三角形，` +
    `外形偏差 ${(record.driftM * 1000).toFixed(1)} mm，${seconds.toFixed(1)} 秒`,
})
