import { describe, expect, it } from 'vitest'
import { deploymentPath, prefixApiPath, prefixFileLinks } from './deployment'

describe('BoldSite deployment URLs', () => {
  it('derives the platform prefix from the entry path', () => {
    expect(deploymentPath('/svc/alpha/')).toBe('/svc/alpha')
    expect(deploymentPath('/svc/alpha')).toBe('/svc/alpha')
    expect(deploymentPath('/svc/alpha/index.html')).toBe('/svc/alpha')
    expect(deploymentPath('/')).toBe('')
    expect(deploymentPath('/svc/')).toBe('')
  })

  it('keeps API links same-origin under the service and preserves other URL formats', () => {
    expect(prefixApiPath('/api/v1/projects', '/svc/alpha')).toBe('/svc/alpha/api/v1/projects')
    expect(
      prefixFileLinks(
        {
          items: [{ url: '/api/v1/files/123?v=1' }, { imageUrl: 'https://other.invalid/a' }],
          existingUrl: '/svc/alpha/api/v1/files/456',
          note: '/api/v1/example',
        },
        '/svc/alpha',
      ),
    ).toEqual({
      items: [{ url: '/svc/alpha/api/v1/files/123?v=1' }, { imageUrl: 'https://other.invalid/a' }],
      existingUrl: '/svc/alpha/api/v1/files/456',
      note: '/api/v1/example',
    })
  })
})
