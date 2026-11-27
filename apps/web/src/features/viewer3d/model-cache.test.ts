import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('limits concurrent loads, shares queued URLs and releases a failed slot for retry', async () => {
  vi.resetModules()
  const pending = new Map<string, { resolve: (r: Response) => void; reject: (e: Error) => void }>()
  let active = 0
  let peak = 0
  const fetch = vi.fn((input: Request) => {
    const url = input.url
    active++
    peak = Math.max(peak, active)
    return new Promise<Response>((resolve, reject) => {
      pending.set(url, {
        resolve: (r) => {
          active--
          resolve(r)
        },
        reject: (e) => {
          active--
          reject(e)
        },
      })
    })
  })
  vi.stubGlobal('fetch', fetch)
  const { loadSource } = await import('./model-cache.ts')
  const urls = ['a', 'b', 'c', 'd'].map((n) => `http://queue.test/${n}.gltf`)
  const loads = urls.map(loadSource)
  expect(loadSource(urls[2]!)).toBe(loads[2])
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  const failed = expect(loads[0]).rejects.toThrow('offline')
  pending.get(urls[0]!)!.reject(new Error('offline'))
  await failed
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
  const retry = loadSource(urls[0]!)
  expect(retry).not.toBe(loads[0])
  const complete = (url: string) =>
    pending.get(url)!.resolve(
      new Response(
        JSON.stringify({
          asset: { version: '2.0' },
          scene: 0,
          scenes: [{ nodes: [] }],
        }),
      ),
    )
  complete(urls[1]!)
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
  complete(urls[2]!)
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(5))
  complete(urls[3]!)
  complete(urls[0]!)
  await Promise.all([...loads.slice(1), retry])
  expect(peak).toBe(2)
  expect(loadSource(urls[0]!)).toBe(retry)
  expect(fetch).toHaveBeenCalledTimes(5)
})
