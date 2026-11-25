export const isBoldSite = import.meta.env.MODE === 'boldsite'
export const isProjectPilot = isBoldSite && import.meta.env.VITE_BOLDSITE_PROJECT_PILOT === '1'

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

export function gatewayRequest(prefix: string): typeof Request {
  return class extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (typeof input !== 'string') {
        super(input, init)
        return
      }
      const url = new URL(input)
      url.pathname = mapGatewayPath(url.pathname, prefix)
      super(url, init)
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
