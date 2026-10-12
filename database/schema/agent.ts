import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { storedFiles } from './files.ts'
import { designNodes, projects } from './projects.ts'

/** A conversation with the agent about one project; kept for good, visible to everyone. */
export const agentSessions = pgTable(
  'agent_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('agent_sessions_project_idx').on(t.projectId, t.updatedAt)],
)

/**
 * One turn: what the user said (with the node and selection it referred to, and the plan
 * picture sent along), what the model answered, or a tool result the model was shown.
 */
export const agentMessages = pgTable(
  'agent_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => agentSessions.id),
    role: text('role').notNull(),
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    imageFileId: uuid('image_file_id').references(() => storedFiles.id),
    provider: text('provider'),
    model: text('model'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costCny: numeric('cost_cny', { precision: 10, scale: 4, mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agent_messages_session_idx').on(t.sessionId, t.createdAt),
    check('agent_messages_role_known', sql`${t.role} IN ('user', 'assistant', 'tool')`),
  ],
)

/** A tool the model called while answering a message; a change makes a node, undo hides it. */
export const agentActions = pgTable(
  'agent_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => agentMessages.id),
    toolName: text('tool_name').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    status: text('status').notNull(),
    resultingNodeId: uuid('resulting_node_id').references(() => designNodes.id),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agent_actions_message_idx').on(t.messageId, t.createdAt),
    check('agent_actions_status_known', sql`${t.status} IN ('succeeded', 'failed')`),
  ],
)
