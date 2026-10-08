import {test,expect} from '@playwright/test'
import {realSample} from '../src/sample.js'
import {issues} from '../src/layout.js'
test('source sample provenance and model path',async({page})=>{
 expect(issues(realSample)).toEqual([])
 await page.goto('/');await page.getByRole('button',{name:'打开真实图纸样本 · 上海星光摄影城'}).click()
 await expect(page.locator('.drawing svg g')).toHaveCount(8)
 await expect(page.locator('.source-panel')).toContainText('23.7')
 await expect(page.locator('.source-images img')).toHaveCount(2)
 await page.screenshot({path:'test-results/real-sample.png',fullPage:true})
 await page.getByRole('button',{name:'确认平面并生成白膜'}).click()
 await expect(page.locator('.model canvas')).toBeVisible()
 await expect(page.getByRole('alert')).toHaveCount(0)
})
