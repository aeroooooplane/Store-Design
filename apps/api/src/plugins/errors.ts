import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod'
import type { ApiError, ErrorCode } from '@store/shared'
import { ERROR_CODES } from '@store/shared'
import { AppError } from '../lib/app-error.ts'

function send(
  reply: FastifyReply,
  request: FastifyRequest,
  code: ErrorCode,
  message: string,
  details?: unknown,
): FastifyReply {
  const body: ApiError = { error: { code, message, requestId: request.id } }
  if (details !== undefined) body.error.details = details
  return reply.code(ERROR_CODES[code]).type('application/json; charset=utf-8').send(body)
}

const LOCATION_LABELS: Record<string, string> = {
  body: '请求体',
  querystring: '查询参数',
  params: '路径参数',
  headers: '请求头',
}

/** Every failure leaves the API in the same `{ error: { code, message, requestId } }` shape. */
export function installErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => send(reply, request, 'NOT_FOUND', '接口不存在'))

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const location = LOCATION_LABELS[error.validationContext ?? ''] ?? '请求'
      const details = error.validation.map((issue) => ({
        location: error.validationContext,
        path: issue.instancePath,
        message: issue.message,
      }))
      return send(reply, request, 'VALIDATION_FAILED', `${location}校验失败`, details)
    }
    if (isResponseSerializationError(error)) {
      request.log.error(
        { err: error, issues: error.cause.issues },
        'response does not match schema',
      )
      return send(reply, request, 'INTERNAL', '服务器内部错误')
    }
    if (error instanceof AppError) {
      return send(reply, request, error.code, error.message, error.details)
    }
    switch (error.statusCode) {
      case 400:
        return send(
          reply,
          request,
          'VALIDATION_FAILED',
          '请求格式无效（请检查 JSON 与 Content-Type）',
        )
      case 413:
        return send(reply, request, 'PAYLOAD_TOO_LARGE', '请求体超过大小限制')
      case 415:
        return send(reply, request, 'VALIDATION_FAILED', '不支持的 Content-Type')
      case 429:
        return send(reply, request, 'RATE_LIMITED', '请求过于频繁，请稍后再试')
      default:
        request.log.error({ err: error }, 'unhandled error')
        return send(reply, request, 'INTERNAL', '服务器内部错误')
    }
  })
}
