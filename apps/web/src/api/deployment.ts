export const isBoldSite = import.meta.env.MODE === 'boldsite'
export const isProjectPilot = isBoldSite && import.meta.env.VITE_BOLDSITE_PROJECT_PILOT === '1'
export const isFullWorkbench = isBoldSite && import.meta.env.VITE_BOLDSITE_FULL_WORKBENCH === '1'

const contractPath = '/api/v1/'
const gatewayPath = '/workbench/v1/'

export function deploymentPath(pathname: string): string {
  return /^\/svc\/[^/]+(?=\/|$)/.exec(pathname)?.[0] ?? ''
}

/** Preserve the contract path in callers and translate it at the Bold Site boundary. */
export function mapGatewayPath(url: string, prefix: string): string {
  if (url.startsWith(gatewayPath)) return prefix + url
  const contractUrl = url.startsWith(prefix + contractPath) ? url.slice(prefix.length) : url
  return contractUrl.startsWith(contractPath)
    ? prefix + gatewayPath + contractUrl.slice(contractPath.length)
    : url
}

const tunneledMethods = new Set(['PATCH', 'PUT', 'DELETE'])

export function gatewayRequest(
  prefix: string,
  mode: 'standard' | 'pilot' | 'workbench' = 'standard',
): typeof Request {
  return class extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (typeof input !== 'string') {
        super(input, init)
        return
      }
      const url = new URL(input)
      const project = /^\/api\/v1\/projects\/[^/]+(\/restore)?$/.exec(url.pathname)
      let options = init
      const method = init?.method?.toUpperCase()
      if (mode === 'workbench' && method && url.pathname.startsWith(contractPath)) {
        const headers = new Headers(init?.headers)
        const revision = headers.get('if-match')
        if (tunneledMethods.has(method)) {
          url.pathname =
            contractPath +
            '_write/' +
            method.toLowerCase() +
            '/' +
            url.pathname.slice(contractPath.length)
          options = { ...init, method: 'POST', headers }
        }
        if (revision !== null && (method === 'POST' || tunneledMethods.has(method))) {
          url.searchParams.set('__workbench_if_match', revision)
          headers.delete('if-match')
          options = { ...options, headers }
        }
      }
      if (mode === 'pilot' && project) {
        const action = !project[1] && method === 'PATCH' ? '/save' : ''
        const trash = !project[1] && method === 'DELETE'
        if (action || trash || (project[1] && method === 'POST')) {
          const headers = new Headers(init?.headers)
          const revision = headers.get('if-match')
          if (revision !== null) url.searchParams.set('ifMatch', revision)
          headers.delete('if-match')
          url.pathname += trash ? '/trash' : action
          options = { ...init, method: 'POST', headers }
        }
      }
      url.pathname = mapGatewayPath(url.pathname, prefix)
      super(url, options)
    }
  }
}

export const servicePrefix = isBoldSite ? deploymentPath(window.location.pathname) : ''
export const apiHref = (url: string): string =>
  isBoldSite ? mapGatewayPath(url, servicePrefix) : url

/** Fastify returns contract links; FastAPI returns links under the gateway path. */
export function mapFileLinks(value: unknown, prefix: string): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => mapFileLinks(item, prefix))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === 'string' && (key === 'url' || key.endsWith('Url'))
        ? mapGatewayPath(item, prefix)
        : mapFileLinks(item, prefix),
    ]),
  )
}
