import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { actorKind } from './enums.ts'

/**
 * Who changed what. Without accounts the actor is a `visitor`; the account system adds
 * an actor reference column through a migration.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    actorKind: actorKind('actor_kind').notNull(),
    requestId: text('request_id'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_events_entity_idx').on(t.entity, t.entityId, t.createdAt)],
)
