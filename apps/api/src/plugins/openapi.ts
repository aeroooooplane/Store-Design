import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import type { FastifyInstance } from 'fastify'
import { jsonSchemaTransform } from 'fastify-type-provider-zod'

export const API_VERSION = '0.1.0'

/** The OpenAPI document is generated from the same zod schemas that validate requests. */
export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: '门店空间设计工作台 API',
        version: API_VERSION,
        description:
          '所有写接口需要 If-Match 版本号；错误统一返回 { error: { code, message, details?, requestId } }。当前无需登录（开发阶段）。',
      },
      tags: [
        { name: 'health', description: '运行状态' },
        { name: 'projects', description: '设计项目' },
        { name: 'assets', description: '模型目录（只读，由 pnpm catalog:import 导入）' },
        { name: 'files', description: '按编号读取已登记的文件' },
      ],
    },
    transform: jsonSchemaTransform,
  })
  await app.register(swaggerUi, { routePrefix: '/api/docs', staticCSP: true })
}
