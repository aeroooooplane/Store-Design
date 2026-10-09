import { createDatabase } from '@store/database'
import { buildApp } from './app.ts'
import { loadConfig } from './config/env.ts'

const config = loadConfig()
const database = createDatabase(config.databaseUrl)
const app = await buildApp({ config, db: database.db })

let closing = false
async function shutdown(signal: string): Promise<void> {
  if (closing) return
  closing = true
  app.log.info({ signal }, 'shutting down')
  await app.close()
  await database.close()
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ host: config.host, port: config.port })
  app.log.info(`API docs: http://${config.host}:${config.port}/api/docs`)
} catch (error) {
  app.log.error({ err: error }, 'failed to start')
  await database.close()
  process.exit(1)
}
