import { crc32, deflateSync } from 'node:zlib'
import type { FastifyInstance } from 'fastify'
import { createDatabase } from '@store/database'
import type { DatabaseHandle } from '@store/database'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config/env.ts'

export interface TestApp {
  app: FastifyInstance
  database: DatabaseHandle
  close(): Promise<void>
}

/** A real Fastify app over a fresh in-memory PostgreSQL with all migrations applied. */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const database = createDatabase('pglite://memory')
  await database.migrate()
  const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test', ...env }), db: database.db })
  await app.ready()
  return {
    app,
    database,
    async close() {
      await app.close()
      await database.close()
    },
  }
}

/** A real, tiny grey PNG. */
export function png(width: number, height: number, shade = 200): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.writeUInt8(8, 8) // bit depth
  header.writeUInt8(0, 9) // greyscale
  const rows = Buffer.alloc((width + 1) * height, shade)
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0 // filter: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
