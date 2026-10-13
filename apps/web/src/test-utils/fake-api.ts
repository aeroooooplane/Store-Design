import { vi } from 'vitest'

/** A JSON response as the API sends it. */
export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** The API's 404 error body. */
export function notFound(message = '接口不存在', requestId = 'r'): Response {
  return json(404, { error: { code: 'NOT_FOUND', message, requestId } })
}

/** One request the page made, as recorded by {@link stubFetch}. */
export interface RecordedCall {
  method: string
  path: string
  ifMatch: string | null
  body: unknown
}

/** What a fake route handler sees of a request. */
export interface FakeRequest {
  request: Request
  url: URL
  method: string
  path: string
  /** `${method} ${path}`, for matching a route in one comparison. */
  route: string
  body: unknown
  ifMatch: string | null
}

export interface StubFetchOptions {
  /** How the recorded body is read; by default non-GET bodies are parsed as JSON text. */
  readBody?: (request: Request) => unknown
}

/** Non-GET requests parsed as JSON; an empty body (or a GET) records `undefined`. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = request.method === 'GET' ? '' : await request.text()
  return text ? (JSON.parse(text) as unknown) : undefined
}

/**
 * Replaces the global `fetch` with a mock that records every request and answers through
 * `handle`. Undo it with `vi.unstubAllGlobals()`.
 */
export function stubFetch(
  handle: (request: FakeRequest) => Response | Promise<Response>,
  options: StubFetchOptions = {},
) {
  const readBody = options.readBody ?? readJsonBody
  const calls: RecordedCall[] = []
  const fetchMock = vi.fn(async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const body: unknown = await readBody(request)
    const ifMatch = request.headers.get('if-match')
    calls.push({ method: request.method, path: url.pathname, ifMatch, body })
    return handle({
      request,
      url,
      method: request.method,
      path: url.pathname,
      route: `${request.method} ${url.pathname}`,
      body,
      ifMatch,
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}
