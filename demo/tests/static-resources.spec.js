import {test, expect} from '@playwright/test'
import {readFileSync, readdirSync, existsSync} from 'node:fs'
import {resolve} from 'node:path'

test('reference paths in source exist and return actual images, not SPA fallback', async ({request}) => {
  const root = resolve('src'), paths = new Set()
  for (const name of readdirSync(root, {recursive:true})) {
    if (!/\.(jsx?|json)$/.test(name)) continue
    for (const match of readFileSync(resolve(root, name), 'utf8').matchAll(/["'](\/references\/[^"']+)["']/g)) paths.add(match[1])
  }
  expect(paths.size).toBeGreaterThan(0)
  for (const path of paths) {
    expect(existsSync(resolve('public', path.slice(1))), path).toBe(true)
    const response = await request.get(path)
    expect(response.status(), path).toBe(200)
    expect(response.headers()['content-type'], path).toMatch(/^image\//)
  }
})

test('entry page declares a valid favicon and sample references load without errors', async ({page, request}) => {
  const failures = []
  page.on('response', r => { if(r.status() >= 400) failures.push(`${r.status()} ${r.url()}`) })
  await page.goto('/')
  const icon = page.locator('link[rel="icon"]')
  await expect(icon).toHaveAttribute('href', '/favicon.svg')
  const response = await request.get(await icon.getAttribute('href'))
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('image/svg+xml')
  await page.getByRole('button', {name:'打开真实图纸样本'}).click()
  await expect(page.locator('.source-images img')).toHaveCount(2)
  await expect.poll(() => page.locator('.source-images img').evaluateAll(images => images.every(i => i.complete && i.naturalWidth > 0))).toBe(true)
  expect(failures).toEqual([])
})
