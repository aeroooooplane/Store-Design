import {test,expect} from '@playwright/test'

for(const width of [390,768,1440]){
  test(`${width}px workspace keeps history, backup and design stages reachable`,async({page})=>{
    await page.setViewportSize({width,height:900})
    await page.goto('/')
    async function fits(){
      const size=await page.evaluate(()=>({content:document.documentElement.scrollWidth,screen:innerWidth}))
      expect(size.content).toBeLessThanOrEqual(size.screen+1)
    }
    await fits()
    const toggle=page.getByRole('button',{name:'历史与备份'})
    if(width<901){
      await expect(toggle).toBeVisible()
      await expect(page.getByRole('button',{name:'导出项目快照'})).toBeHidden()
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded','true')
    }
    await expect(page.getByRole('button',{name:'导出项目快照'})).toBeVisible()
    if(width<901)await toggle.click()
    await page.getByRole('button',{name:'生成四个平面方案'}).click()
    await fits()
    await page.locator('.plan-card').first().click()
    await fits()
    await page.getByRole('button',{name:'保存平面快照',exact:true}).click()
    if(width<901)await toggle.click()
    const download=page.waitForEvent('download')
    await page.getByRole('button',{name:'导出项目快照'}).click()
    expect((await download).suggestedFilename()).toBe('store-project.json')
    await page.locator('.branch-list button').filter({hasText:'平面快照'}).last().click()
    if(width<901)await expect(toggle).toHaveAttribute('aria-expanded','false')
    await page.screenshot({path:`test-results/workspace-${width}-editor.png`,fullPage:true})
    await page.getByRole('button',{name:'确认平面并生成白膜'}).click()
    await expect(page.getByRole('button',{name:'确认白膜，渲染八视角'})).toBeEnabled()
    await fits()
    await page.getByRole('button',{name:'确认白膜，渲染八视角'}).click()
    await expect(page.locator('.renders img')).toHaveCount(8)
    await fits()
    await page.screenshot({path:`test-results/workspace-${width}-render.png`,fullPage:true})
  })
}
