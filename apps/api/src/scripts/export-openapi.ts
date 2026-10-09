import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createDatabase } from '@store/database'
import { buildApp } from '../app.ts'
import { loadConfig } from '../config/env.ts'

// Writes apps/api/openapi.json, the contract the web client types are generated from.
// No request is served, so an empty in-memory database is enough.
const target = fileURLToPath(new URL('../../openapi.json', import.meta.url))
const database = createDatabase('pglite://memory')
const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test' }), db: database.db })
try {
  await app.ready()
  await writeFile(target, `${JSON.stringify(app.swagger(), null, 2)}\n`)
  console.log(`OpenAPI document written to ${target}`)
} finally {
  await app.close()
  await database.close()
}
