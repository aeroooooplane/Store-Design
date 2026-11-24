import createClient from 'openapi-fetch'
import { ApiErrorSchema } from '@store/shared'
import type { paths } from './schema'
import { apiPrefix, prefixFileLinks } from './deployment'

/**
 * Typed client generated from apps/api/openapi.json (`pnpm api:openapi`). This is the only way
 * the browser reaches data; there is no direct database access and no secret in the bundle.
 */
export const api = createClient<paths>({
  baseUrl: window.location.origin + apiPrefix,
  // Resolve fetch per call so tests can stub it.
  fetch: async (request) => {
    const response = await globalThis.fetch(request)
    if (
      !apiPrefix ||
      !response.ok ||
      !response.headers.get('content-type')?.includes('application/json')
    )
      return response
    const data: unknown = await response
      .clone()
      .json()
      .catch(() => undefined)
    if (data === undefined) return response
    const headers = new Headers(response.headers)
    headers.delete('content-length')
    headers.delete('content-encoding')
    return new Response(JSON.stringify(prefixFileLinks(data, apiPrefix)), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
})

export class ApiRequestError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId: string | undefined
  readonly details: unknown

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
    details?: unknown,
  ) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.details = details
  }
}

/** Returns the data of a successful call or throws the API's structured error. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || result.data === undefined) {
    const parsed = ApiErrorSchema.safeParse(result.error)
    if (parsed.success) {
      const { code, message, requestId, details } = parsed.data.error
      throw new ApiRequestError(result.response.status, code, message, requestId, details)
    }
    throw new ApiRequestError(
      result.response.status,
      'UNKNOWN',
      `请求失败（HTTP ${result.response.status}）`,
    )
  }
  return result.data
}

export function ifMatch(revision: number): { 'if-match': string } {
  return { 'if-match': `"${revision}"` }
}
