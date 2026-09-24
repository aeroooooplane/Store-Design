import {test,expect} from '@playwright/test'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
test('offline labels and filters',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(pathToFileURL(path.resolve('../素材库/01_catalog/classification/index.html')).href)
 await expect(page.locator('tbody tr')).toHaveCount(418)
 await page.locator('#si').selectOption('SI2.0');await page.locator('#type').selectOption('中岛店');await expect(page.locator('tbody tr')).toHaveCount(5)
 await page.locator('#si').selectOption('');await page.locator('#type').selectOption('');await page.locator('#status').selectOption('conflict');await expect(page.locator('tbody tr')).toHaveCount(6)
 await page.screenshot({path:'test-results/catalog-conflicts.png',fullPage:true});expect(errors).toEqual([])
})
