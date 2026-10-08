import {test,expect} from '@playwright/test';
import {generatePlans,issues} from '../src/layout.js';
test('experimental learned counts remain inside room with no overlap',()=>{
 for(const room of [{w:4,d:4,h:3},{w:8,d:6,h:3},{w:10,d:10,h:3}])for(const p of generatePlans(room,{learned:true})){expect(p.modelAdvice).toBeTruthy();expect(p.items.filter(i=>i.type==='table').length).toBe(p.modelAdvice.placed);expect(issues(p)).toEqual([])}
 expect(generatePlans({w:30,d:30,h:3},{learned:true})[0].modelAdvice.status).toBe('outside-training-range');
});
test('model is opt-in and generation records its provenance',async({page})=>{
 await page.goto('/');const toggle=page.getByLabel('实验：参考已训练的体验桌数量模型');await expect(toggle).not.toBeChecked();await toggle.check();await page.screenshot({path:'test-results/model-input.png',fullPage:true});await page.getByRole('button',{name:'生成四个平面方案'}).click();await expect(page.locator('.plan-card')).toHaveCount(4);const plans=await page.evaluate(async()=>JSON.parse((await (await import('/src/project-db.js')).readProjectRaw())).nodes.filter(n=>n.kind==='plan'));expect(plans.every(p=>p.layout.modelAdvice.modelVersion===1)).toBeTruthy();await page.screenshot({path:'test-results/model-plans.png',fullPage:true});
});
