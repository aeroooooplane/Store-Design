import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '../config/env.ts'
import { AppError } from '../lib/app-error.ts'

export async function registerSecurity(app: FastifyInstance, config: AppConfig): Promise<void> {
  await app.register(helmet, {
    // Swagger UI serves its own assets; everything else is JSON and needs no relaxed policy.
    crossOriginResourcePolicy: { policy: 'same-origin' },
  })
  await app.register(cors, {
    origin: [config.webOrigin],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'if-match', 'x-request-id'],
    exposedHeaders: ['etag', 'x-request-id'],
  })
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: '1 minute',
    // The thrown error reaches the global handler, which writes the standard error body.
    errorResponseBuilder: () => new AppError('RATE_LIMITED', '请求过于频繁，请稍后再试'),
  })
}
