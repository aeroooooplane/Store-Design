import { ERROR_CODES } from '@store/shared'
import type { ErrorCode } from '@store/shared'

/** An expected failure with a stable code; the error handler turns it into the API error body. */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly statusCode: number
  readonly details: unknown

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.statusCode = ERROR_CODES[code]
    this.details = details
  }
}

export function notFound(what: string): AppError {
  return new AppError('NOT_FOUND', `${what}不存在`)
}
