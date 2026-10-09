import type { FastifyRequest } from 'fastify'

/**
 * Who is making the request. During development everyone is an anonymous `visitor`.
 * The account system adds the `user` variant and replaces `resolveActor` with session or
 * token verification; services already receive the actor, so they need no signature change.
 */
export type Actor = { kind: 'visitor' } | { kind: 'user'; userId: string }

export interface RequestContext {
  actor: Actor
  requestId: string
}

export function resolveActor(_request: FastifyRequest): Actor {
  return { kind: 'visitor' }
}

/** Context for work started by the server itself (migrations, scripts, background jobs). */
export function systemContext(requestId = 'system'): RequestContext {
  return { actor: { kind: 'visitor' }, requestId }
}
