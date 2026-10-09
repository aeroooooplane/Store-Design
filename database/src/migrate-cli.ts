import { createDatabase } from './index.ts'

const url = process.env['DATABASE_URL'] ?? 'pglite://./data/pglite'
const handle = createDatabase(url)
try {
  await handle.migrate()
  console.log(`Migrations applied (${handle.driver}).`)
} finally {
  await handle.close()
}
