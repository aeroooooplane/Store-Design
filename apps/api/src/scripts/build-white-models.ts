import { buildWhiteModel } from '../modules/assets/white-models.ts'
import { WhiteRecordSchema } from '../modules/assets/light-records.ts'
import { runLightBuild } from './light-build.ts'

// Builds the light white-model GLB next to every web model listed in the library manifest
// (资源库/04_模型库). Skips models whose white.json already matches the current model.glb.
// Usage: [asset-id ...] (none = all).
await runLightBuild({
  kind: 'white',
  title: '白模轻量版',
  record: WhiteRecordSchema,
  build: buildWhiteModel,
  describe: (id, record) =>
    `${id}: ${record.trianglesBefore} → ${record.trianglesAfter} 面，` +
    `${Math.round(record.sourceBytes / 1024)} → ${Math.round(record.bytes / 1024)} KB，` +
    `外形偏差 ${(record.driftM * 1000).toFixed(1)} mm`,
})
