import { describe, expect, it } from 'vitest'
import { deploymentPath, mapFileLinks, mapGatewayPath, gatewayRequest } from './deployment'

describe('BoldSite deployment URLs', () => {
  it('derives the platform prefix from the entry path', () => {
    expect(deploymentPath('/svc/alpha/')).toBe('/svc/alpha')
    expect(deploymentPath('/svc/alpha')).toBe('/svc/alpha')
    expect(deploymentPath('/svc/alpha/index.html')).toBe('/svc/alpha')
    expect(deploymentPath('/')).toBe('')
    expect(deploymentPath('/svc/')).toBe('')
  })

  it('keeps API links same-origin under the service and preserves other URL formats', () => {
    expect(mapGatewayPath('/api/v1/projects', '/svc/alpha')).toBe(
      '/svc/alpha/workbench/v1/projects',
    )
    expect(
      mapFileLinks(
        {
          items: [{ url: '/api/v1/files/123?v=1' }, { imageUrl: 'https://other.invalid/a' }],
          existingUrl: '/svc/alpha/api/v1/files/456',
          note: '/api/v1/example',
        },
        '/svc/alpha',
      ),
    ).toEqual({
      items: [
        { url: '/svc/alpha/workbench/v1/files/123?v=1' },
        { imageUrl: 'https://other.invalid/a' },
      ],
      existingUrl: '/svc/alpha/workbench/v1/files/456',
      note: '/api/v1/example',
    })
  })

  it('maps health checks outside a service mount and preserves pre-mapped links', () => {
    expect(mapGatewayPath('/api/v1/health', '')).toBe('/workbench/v1/health')
    expect(mapGatewayPath('/svc/alpha/workbench/v1/files/ABC', '/svc/alpha')).toBe(
      '/svc/alpha/workbench/v1/files/ABC',
    )
  })

  it('keeps the request method, upload body, query string and revision header', async () => {
    const body = new Uint8Array([137, 80, 78, 71])
    const GatewayRequest = gatewayRequest('/svc/alpha')
    const mapped = new GatewayRequest('https://pilot.invalid/api/v1/projects/abc/uploads?page=2', {
      method: 'POST',
      body,
      headers: { 'content-type': 'image/png', 'if-match': '"7"' },
    })
    expect(mapped.url).toBe(
      'https://pilot.invalid/svc/alpha/workbench/v1/projects/abc/uploads?page=2',
    )
    expect(mapped.method).toBe('POST')
    expect(mapped.headers.get('content-type')).toBe('image/png')
    expect(mapped.headers.get('if-match')).toBe('"7"')
    expect(new Uint8Array(await mapped.arrayBuffer())).toEqual(body)
  })
})
