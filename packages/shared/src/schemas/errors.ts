import { z } from 'zod'

export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  BUDGET_EXCEEDED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  /** The resource exists but its state forbids the action (e.g. editing a project in the bin). */
  INVALID_STATE: 409,
  PAYLOAD_TOO_LARGE: 413,
  REVISION_REQUIRED: 428,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const

export type ErrorCode = keyof typeof ERROR_CODES

/** Every non-2xx API response uses this body. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
})
export type ApiError = z.infer<typeof ApiErrorSchema>
