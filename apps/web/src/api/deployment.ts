export const isBoldSite = import.meta.env.MODE === 'boldsite'

export function deploymentPath(pathname: string): string {
  return /^\/svc\/[^/]+(?=\/|$)/.exec(pathname)?.[0] ?? ''
}

export function prefixApiPath(url: string, prefix: string): string {
  return url.startsWith('/api/v1/') ? prefix + url : url
}

export const apiPrefix = isBoldSite ? deploymentPath(window.location.pathname) : ''
export const apiHref = (url: string): string => prefixApiPath(url, apiPrefix)

/** Older API implementations return root-relative download and model URLs. */
export function prefixFileLinks(value: unknown, prefix: string): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => prefixFileLinks(item, prefix))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === 'string' && (key === 'url' || key.endsWith('Url'))
        ? prefixApiPath(item, prefix)
        : prefixFileLinks(item, prefix),
    ]),
  )
}
