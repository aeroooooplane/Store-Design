import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import type { Database } from '@store/database'
import type { AppConfig } from './config/env.ts'
import type { StorageRoots } from './lib/storage.ts'
import { assetRoutes } from './modules/assets/routes.ts'
import { fileRoutes } from './modules/files/routes.ts'
import { healthRoutes } from './modules/health/routes.ts'
import { projectRoutes } from './modules/projects/routes.ts'
import { installErrorHandling } from './plugins/errors.ts'
import { registerOpenApi } from './plugins/openapi.ts'
import { generateRequestId, installRequestContext } from './plugins/request-context.ts'
import { registerSecurity } from './plugins/security.ts'

export const API_PREFIX = '/api/v1'
const JSON_BODY_LIMIT_BYTES = 5 * 1024 * 1024

export interface AppDependencies {
  config: AppConfig
  db: Database
}

export async function buildApp({ config, db }: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.nodeEnv === 'test'
        ? false
        : { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    genReqId: generateRequestId,
  })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  installRequestContext(app)
  installErrorHandling(app)
  await registerSecurity(app, config)
  await registerOpenApi(app)

  const roots = storageRoots(config)
  await app.register(healthRoutes, { prefix: API_PREFIX, db })
  await app.register(projectRoutes, { prefix: API_PREFIX, db })
  await app.register(assetRoutes, { prefix: API_PREFIX, db })
  await app.register(fileRoutes, { prefix: API_PREFIX, db, roots })
  return app
}

export function storageRoots(config: AppConfig): StorageRoots {
  return { storage: config.storageRoot, resource: config.resourceRoot }
}
