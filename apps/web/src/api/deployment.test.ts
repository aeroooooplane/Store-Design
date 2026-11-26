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
    expect(mapGatewayPath('/workbench/v1/files/ABC', '/svc/alpha')).toBe(
      '/svc/alpha/workbench/v1/files/ABC',
    )
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

  it('tunnels full workbench writes without changing query values or upload bytes', async () => {
    const WorkbenchRequest = gatewayRequest('/svc/alpha', 'workbench')
    const upload = new Uint8Array([137, 80, 78, 71])
    const create = new WorkbenchRequest(
      'https://pilot.invalid/api/v1/display-tasks/abc/uploads?role=plan',
      {
        method: 'POST',
        headers: { 'if-match': '"7"', 'content-type': 'image/png' },
        body: upload,
      },
    )
    expect(create.method).toBe('POST')
    expect(new URL(create.url).searchParams.get('role')).toBe('plan')
    expect(new URL(create.url).searchParams.get('__workbench_if_match')).toBe('"7"')
    expect(create.headers.get('if-match')).toBeNull()
    expect(new Uint8Array(await create.arrayBuffer())).toEqual(upload)

    const save = new WorkbenchRequest('https://pilot.invalid/api/v1/nodes/abc/draft', {
      method: 'PUT',
      headers: { 'if-match': '"10"' },
      body: '{"name":"draft"}',
    })
    expect(save.method).toBe('POST')
    expect(new URL(save.url).pathname).toBe('/svc/alpha/workbench/v1/_write/put/nodes/abc/draft')
    expect(await save.text()).toBe('{"name":"draft"}')
  })

  it('carries project edits through the pilot POST routes without losing the version', async () => {
    const PilotRequest = gatewayRequest('/svc/alpha', 'pilot')
    const base = 'https://pilot.invalid/api/v1/projects/abc'
    const headers = { 'content-type': 'application/json', 'if-match': '"7"' }
    const body = '{"siStyle":"SI2.0"}'
    const save = new PilotRequest(base, { method: 'PATCH', headers, body })
    expect(save.method).toBe('POST')
    expect(save.url).toBe(
      'https://pilot.invalid/svc/alpha/workbench/v1/projects/abc/save?ifMatch=%227%22',
    )
    expect(save.headers.get('if-match')).toBeNull()
    expect(await save.text()).toBe(body)
    expect(new PilotRequest(base, { method: 'DELETE', headers }).url).toContain(
      '/abc/trash?ifMatch=%227%22',
    )
    expect(new PilotRequest(base + '/restore', { method: 'POST', headers }).url).toContain(
      '/abc/restore?ifMatch=%227%22',
    )
  })
})
