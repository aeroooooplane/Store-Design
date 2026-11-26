import createClient from 'openapi-fetch'
import { ApiErrorSchema } from '@store/shared'
import type { paths } from './schema'
import {
  apiHref,
  gatewayRequest,
  isBoldSite,
  isFullWorkbench,
  isProjectPilot,
  mapFileLinks,
  servicePrefix,
} from './deployment'

let writeToken: Promise<string> | undefined

function workbenchWriteToken() {
  writeToken ??= (async () => {
    const response = await fetch(apiHref('/api/v1/write-token'), { cache: 'no-store' })
    if (!response.ok) throw new Error('无法取得工作台写入令牌')
    const value: unknown = await response.json()
    if (
      !value ||
      typeof value !== 'object' ||
      !('token' in value) ||
      typeof value.token !== 'string'
    ) {
      throw new Error('工作台写入令牌无效')
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(value.token)) throw new Error('工作台写入令牌无效')
    return value.token
  })().catch((error: unknown) => {
    writeToken = undefined
    throw error
  })
  return writeToken
}

export async function fetchWorkbench(request: Request) {
  if (!isFullWorkbench || request.method !== 'POST') return globalThis.fetch(request)

  // The site retains Content-Type parameters but may omit original browser headers.
  const send = async (attempt: Request, token: string) => {
    const headers = new Headers(attempt.headers)
    const mediaType = headers.get('content-type') ?? 'application/octet-stream'
    headers.set('content-type', mediaType + '; workbench-token=' + token)
    return globalThis.fetch(new Request(attempt, { headers }))
  }

  const initial = workbenchWriteToken()
  const response = await send(request.clone(), await initial)
  if (response.status !== 403) return response
  const data: unknown = await response
    .clone()
    .json()
    .catch(() => undefined)
  const parsed = ApiErrorSchema.safeParse(data)
  const details = parsed.success ? parsed.data.error.details : null
  if (
    !details ||
    typeof details !== 'object' ||
    !('writeToken' in details) ||
    details.writeToken !== 'refresh'
  ) {
    return response
  }
  if (writeToken === initial) writeToken = undefined
  return send(request, await workbenchWriteToken())
}

/**
 * Typed client generated from apps/api/openapi.json (`pnpm api:openapi`). This is the only way
 * the browser reaches data; there is no direct database access and no secret in the bundle.
 */
export const api = createClient<paths>({
  baseUrl: window.location.origin,
  Request: isBoldSite
    ? gatewayRequest(
        servicePrefix,
        isProjectPilot ? 'pilot' : isFullWorkbench ? 'workbench' : 'standard',
      )
    : Request,
  // Resolve fetch per call so tests can stub it.
  fetch: async (request) => {
    const response = await fetchWorkbench(request)
    if (
      !isBoldSite ||
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
    return new Response(JSON.stringify(mapFileLinks(data, servicePrefix)), {
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
