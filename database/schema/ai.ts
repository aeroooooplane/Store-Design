import { sql } from 'drizzle-orm'
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Site-wide settings such as the selected AI models. When accounts arrive, a user_settings
 * table overrides these defaults per user.
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Every model call is booked here; the daily budget is the sum for one Beijing-time day. */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    day: date('day', { mode: 'string' }).notNull(),
    purpose: text('purpose').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costCny: numeric('cost_cny', { precision: 10, scale: 4, mode: 'number' }).notNull(),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_usage_day_idx').on(t.day),
    check('ai_usage_purpose_known', sql`${t.purpose} IN ('agent', 'recognition')`),
    check('ai_usage_cost_non_negative', sql`${t.costCny} >= 0`),
  ],
)
