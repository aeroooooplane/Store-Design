import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Database } from '@store/database'
import {
  AgentActionSchema,
  AgentMessageSchema,
  AgentReplySchema,
  AgentSendSchema,
  AgentSessionCreateSchema,
  AgentSessionSchema,
  ApiErrorSchema,
} from '@store/shared'
import type { AppConfig } from '../../config/env.ts'
import type { StorageRoots } from '../../lib/storage.ts'
import * as service from './service.ts'

const ProjectParams = z.object({ projectId: z.uuid() })
const SessionParams = z.object({ sessionId: z.uuid() })
const ActionParams = z.object({ actionId: z.uuid() })
const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema }
const writeLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } }

export const agentRoutes: FastifyPluginAsyncZod<{
  db: Database
  config: AppConfig
  roots: StorageRoots
}> = async (app, { db, config, roots }) => {
  app.post(
    '/projects/:projectId/agent/sessions',
    {
      config: writeLimit,
      schema: {
        tags: ['agent'],
        summary: '新建一段与设计助理的对话',
        params: ProjectParams,
        body: AgentSessionCreateSchema,
        response: { 201: AgentSessionSchema, ...errors },
      },
    },
    async (request, reply) => {
      const session = await service.createSession(db, request.ctx, request.params.projectId, {
        ...(request.body.title ? { title: request.body.title } : {}),
      })
      return reply.code(201).send(session)
    },
  )

  app.get(
    '/projects/:projectId/agent/sessions',
    {
      schema: {
        tags: ['agent'],
        summary: '项目的对话列表（最近的在前）',
        params: ProjectParams,
        response: { 200: z.array(AgentSessionSchema), ...errors },
      },
    },
    async (request) => service.listSessions(db, request.ctx, request.params.projectId),
  )

  app.get(
    '/agent/sessions/:sessionId/messages',
    {
      schema: {
        tags: ['agent'],
        summary: '一段对话的全部消息（含工具调用与动作）',
        params: SessionParams,
        response: { 200: z.array(AgentMessageSchema), ...errors },
      },
    },
    async (request) => service.listMessages(db, request.ctx, request.params.sessionId),
  )

  app.post(
    '/agent/sessions/:sessionId/messages',
    {
      config: writeLimit,
      schema: {
        tags: ['agent'],
        summary: '发一句话给设计助理；它可能调用工具修改项目，每次修改生成新节点',
        params: SessionParams,
        body: AgentSendSchema,
        response: { 200: AgentReplySchema, ...errors, 402: ApiErrorSchema, 502: ApiErrorSchema },
      },
    },
    async (request) =>
      service.sendMessage(db, request.ctx, config, roots, request.params.sessionId, request.body),
  )

  app.post(
    '/agent/actions/:actionId/undo',
    {
      config: writeLimit,
      schema: {
        tags: ['agent'],
        summary: '撤销助理的一次修改（隐藏它生成的节点）',
        params: ActionParams,
        response: { 200: AgentActionSchema, ...errors },
      },
    },
    async (request) => service.undoAction(db, request.ctx, request.params.actionId),
  )
}
