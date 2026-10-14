import { createDatabase } from '@store/database'
import { storageRoots } from '../app.ts'
import { loadConfig } from '../config/env.ts'
import { importDisplayRules } from '../modules/displays/importer.ts'

// Imports the display rules (资源库/10_产品与陈列/展陈规则.xlsx). Safe to rerun.
const config = loadConfig()
const database = createDatabase(config.databaseUrl)
try {
  const report = await importDisplayRules(database.db, storageRoots(config))
  if (report.status === 'rejected') {
    console.error(`展陈规则未导入（版本 ${report.version ?? '未知'}），请先修改 Excel：`)
    for (const problem of report.problems) console.error(`  - ${problem}`)
    process.exitCode = 1
  } else if (report.status === 'unchanged') {
    console.log(`展陈规则 ${report.version} 与上次导入相同，没有变化。`)
  } else {
    console.log(`已导入展陈规则 ${report.version}：照片 ${report.photos} 张。`)
    if (report.changes.length) {
      console.log(`与上一版相比有 ${report.changes.length} 处变化：`)
      for (const change of report.changes) console.log(`  - ${change}`)
    }
  }
  for (const file of report.missingPhotos) console.warn(`  - 缺少照片 ${file}`)
} finally {
  await database.close()
}
