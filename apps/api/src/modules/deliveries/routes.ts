import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Database } from '@store/database'
import {
  ApiErrorSchema,
  DeliveryCreateSchema,
  DeliveryListSchema,
  DeliverySchema,
} from '@store/shared'
import * as service from './service.ts'
import type { DeliveryDirs } from './service.ts'

const NodeParams = z.object({ nodeId: z.uuid() })
const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema }
/** The plan PNG travels as base64 inside the JSON body. */
const CREATE_BODY_LIMIT = 40 * 1024 * 1024

export const deliveryRoutes: FastifyPluginAsyncZod<{ db: Database } & DeliveryDirs> = async (
  app,
  { db, roots, archiveRoot },
) => {
  app.get(
    '/nodes/:nodeId/deliveries',
    {
      schema: {
        tags: ['deliveries'],
        summary: '渲染节点的历次交付（双 PDF 与 ZIP）',
        params: NodeParams,
        response: { 200: DeliveryListSchema, ...errors },
      },
    },
    (request) => service.listDeliveries(db, request.ctx, request.params.nodeId),
  )

  app.post(
    '/nodes/:nodeId/deliveries',
    {
      bodyLimit: CREATE_BODY_LIMIT,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['deliveries'],
        summary: '生成交付文件：完整版与展示版 PDF、交付目录 ZIP，并写入归档目录',
        params: NodeParams,
        body: DeliveryCreateSchema,
        response: { 201: DeliverySchema, ...errors, 413: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const delivery = await service.createDelivery(
        db,
        request.ctx,
        { roots, archiveRoot },
        request.params.nodeId,
        request.body,
      )
      return reply.code(201).send(delivery)
    },
  )
}
