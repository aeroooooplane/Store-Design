import { z } from 'zod'
import { NameSchema } from './common.ts'

/** Roles of a conversation turn as stored: the user, the model, or a tool result it was shown. */
export const AGENT_ROLES = ['user', 'assistant', 'tool'] as const

export const AgentToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
})
export type AgentToolCall = z.infer<typeof AgentToolCallSchema>

/** What a message holds; which fields are set depends on the role. */
export const AgentContentSchema = z.object({
  text: z.string(),
  /** The node the user was looking at and the props selected, for a user message. */
  nodeId: z.uuid().nullable().optional(),
  selectedItemIds: z.array(z.string()).optional(),
  /** Calls an assistant message made. */
  toolCalls: z.array(AgentToolCallSchema).optional(),
  /** The call a tool message answers, and the tool's name. */
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
})
export type AgentContent = z.infer<typeof AgentContentSchema>

export const AgentActionSchema = z.object({
  id: z.uuid(),
  messageId: z.uuid(),
  toolName: z.string(),
  input: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()).nullable(),
  status: z.enum(['succeeded', 'failed']),
  /** The node the action created (a change); null for a read-only tool. */
  resultingNodeId: z.uuid().nullable(),
  undoneAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
})
export type AgentAction = z.infer<typeof AgentActionSchema>

export const AgentMessageSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  role: z.enum(AGENT_ROLES),
  content: AgentContentSchema,
  /** The plan picture sent with a user message. */
  imageUrl: z.string().nullable(),
  model: z.string().nullable(),
  tokensIn: z.int(),
  tokensOut: z.int(),
  costCny: z.number(),
  createdAt: z.iso.datetime({ offset: true }),
  actions: z.array(AgentActionSchema),
})
export type AgentMessage = z.infer<typeof AgentMessageSchema>

export const AgentSessionSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  title: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})
export type AgentSession = z.infer<typeof AgentSessionSchema>

export const AgentSessionCreateSchema = z.strictObject({ title: NameSchema.optional() })

export const AGENT_MAX_TEXT = 4000
/** The plan picture sent along (PNG, base64 without the data: prefix). */
export const AGENT_MAX_IMAGE_BASE64 = 4 * 1024 * 1024

export const AgentSendSchema = z.strictObject({
  text: z.string().trim().min(1).max(AGENT_MAX_TEXT),
  /** The node on screen; the agent's changes start from it. */
  nodeId: z.uuid().optional(),
  selectedItemIds: z.array(z.string().max(64)).max(50).optional(),
  planPng: z.string().min(16).max(AGENT_MAX_IMAGE_BASE64).optional(),
})
export type AgentSend = z.output<typeof AgentSendSchema>

/** The user's message as stored, the model's reply, and where the project stands now. */
export const AgentReplySchema = z.object({
  userMessage: AgentMessageSchema,
  reply: AgentMessageSchema,
  /** The node to show after the agent's changes (the last one it made), if any. */
  currentNodeId: z.uuid().nullable(),
})
export type AgentReply = z.infer<typeof AgentReplySchema>
