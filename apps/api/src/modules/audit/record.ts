import { schema } from '@store/database'
import type { Database } from '@store/database'
import type { ActorKind } from '@store/shared'
import type { Actor, RequestContext } from '../../context/actor.ts'

const actorKinds: Record<Actor['kind'], ActorKind> = { visitor: 'visitor', user: 'user' }

export interface AuditEntry {
  entity: string
  entityId: string
  action: string
  detail?: Record<string, unknown>
}

/** Call inside the same transaction as the change it describes. */
export async function recordAudit(
  db: Database,
  ctx: RequestContext,
  entry: AuditEntry,
): Promise<void> {
  await db.insert(schema.auditEvents).values({
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    actorKind: actorKinds[ctx.actor.kind],
    requestId: ctx.requestId,
    detail: entry.detail ?? {},
  })
}
