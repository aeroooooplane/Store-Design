import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { resolveActor } from '../context/actor.ts'
import type { RequestContext } from '../context/actor.ts'

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext
  }
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/

/** Keeps a caller-supplied request id when it is safe to log, otherwise creates one. */
export function generateRequestId(request: { headers: Record<string, unknown> }): string {
  const incoming = request.headers['x-request-id']
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID()
}

export function installRequestContext(app: FastifyInstance): void {
  app.decorateRequest('ctx', null as unknown as RequestContext)
  app.addHook('onRequest', async (request: FastifyRequest) => {
    request.ctx = { actor: resolveActor(request), requestId: request.id }
  })
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id)
  })
}
