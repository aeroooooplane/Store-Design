import { createDatabase } from '@store/database'
import { storageRoots } from '../app.ts'
import { loadConfig } from '../config/env.ts'
import { importCatalog } from '../modules/assets/importer.ts'

// Imports or refreshes the model catalogue from RESOURCE_ROOT (资源库). Safe to rerun.
const config = loadConfig()
const database = createDatabase(config.databaseUrl)
try {
  const report = await importCatalog(database.db, storageRoots(config))
  console.log(
    `资产 ${report.assets} 件：有网页模型 ${report.withGlb}（白模轻量版 ${report.withWhite}），可摆放 ${report.placeable}，有预览图 ${report.withPreview}，效果图 ${report.withProductImage}，平面图 ${report.withPlanSymbol}`,
  )
  for (const problem of report.problems) console.warn(`  - ${problem}`)
} finally {
  await database.close()
}
