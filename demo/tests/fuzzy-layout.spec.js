import {test,expect} from '@playwright/test'
import {generatePlans,issues} from '../src/layout.js'
import {parseProject} from '../src/project-import.js'
import {recommendLayout,tableRelativeRoom} from '../src/fuzzy-layout.js'
import {layoutCases} from '../src/layout-cases.js'
import {exportLayoutSvg} from '../src/plan-export.js'

// Catches the area-only planner ignoring the requested case-based strategy.
test('fuzzy plans expose sources, uncertainty and different shape-dependent arrangements',()=>{
  const plans=generatePlans({w:5.2,d:9.4,h:3.2,shopType:'边厅店'},{fuzzy:true})
  expect(plans[0].fuzzyAdvice?.method).toBe('table-relative-cases-v1')
  expect(plans[0].fuzzyAdvice.references.length).toBeGreaterThan(0)
  expect(plans.some(p=>p.items.filter(i=>i.type==='table').length===3)).toBeTruthy()
  const serial=plans.find(p=>p.fuzzyAdvice.pattern==='serial')
  expect(serial).toBeTruthy()
  const tables=serial.items.filter(i=>i.type==='table')
  expect(new Set(tables.map(i=>i.x)).size).toBe(1)
  expect(tables.every(i=>i.w>i.d)).toBeTruthy()
  for(const plan of plans)expect(issues(plan)).toEqual([])
})

test('wide shallow island uses a cross row without inventing a front internal aisle',()=>{
  const plans=generatePlans({w:6.7,d:2.4,h:3.2,shopType:'中岛店'},{fuzzy:true})
  expect(plans[0].fuzzyAdvice?.method).toBe('table-relative-cases-v1')
  expect(plans.some(p=>p.items.filter(i=>i.type==='table').length===2)).toBeTruthy()
  for(const plan of plans){
    if(plan.planning.placed)expect(issues(plan)).toEqual([])
    else expect(plan.fuzzyAdvice.warnings.some(w=>w.includes('未强塞'))).toBeTruthy()
  }
})

test('side-service island keeps two horizontal tables in depth and service on the side',()=>{
  const plans=generatePlans({w:5.94,d:3.96,h:3.2,shopType:'中岛店'},{fuzzy:true})
  const plan=plans[0],tables=plan.items.filter(i=>i.type==='table'),counter=plan.items.find(i=>i.type==='counter')
  expect(tables).toHaveLength(2)
  expect(counter.x).toBeGreaterThan(Math.max(...tables.map(t=>t.x+t.w)))
  expect(issues(plan)).toEqual([])
})

test('empty capacity candidates cannot masquerade as a usable plan',()=>{
  const plan=generatePlans({w:2.4,d:2.4,h:3.2,shopType:'边厅店'},{fuzzy:true})[0]
  expect(issues(plan).some(s=>s.includes('体验桌'))).toBeTruthy()
})

test('a single-table reference expanded to several tables reports its actual serial pattern',()=>{
  const p=generatePlans({w:5,d:6,h:3.2,shopType:'边厅店'},{fuzzy:true})[3]
  expect(p.items.filter(i=>i.type==='table')).toHaveLength(2)
  expect(p.fuzzyAdvice.pattern).toBe('serial')
})

test('fuzzy layouts keep constraints and provenance through backup roundtrip',()=>{
  const room={w:8,d:6,h:3.2,shopType:'边厅店',fuzzyBlock:'left'},layout=generatePlans(room,{fuzzy:true})[0]
  expect(layout.fuzzyAdvice?.references.length).toBeGreaterThan(0)
  expect(layout.items.some(i=>i.type==='structure')).toBeTruthy()
  expect(issues(layout)).toEqual([])
  const nodes=[{id:'r',name:'空间',kind:'root',room},{id:'p',name:'方案',kind:'plan',parent:'r',layout}]
  expect(parseProject(JSON.stringify({nodes})).nodes[1].layout.fuzzyAdvice).toEqual(layout.fuzzyAdvice)
})

test('oversized unseen shops disclose weak evidence instead of confident learned counts',()=>{
  const plan=generatePlans({w:30,d:30,h:3.2,shopType:'边厅店'},{fuzzy:true})[0]
  expect(plan.fuzzyAdvice?.support).toBe('outside-reference-range')
})

test('leave-one-out excludes identity before ranking and never uses quarantined references',()=>{
  for(const c of layoutCases){
    const a=recommendLayout({widthUnits:c.span[0],depthUnits:c.span[1],shopType:c.shopType,blocked:c.blocked},{excludeId:c.id})
    expect(a.references.some(r=>r.id===c.id||r.id==='PDF-239'||r.id==='PDF-071')).toBeFalsy()
  }
  expect(()=>tableRelativeRoom(NaN,3,3.2,'边厅店')).toThrow()
})

test('fuzzy export explicitly labels estimated dimensions rather than a surveyed plan',()=>{
  const room=tableRelativeRoom(3,5,3.2,'边厅店'),plan=generatePlans(room,{fuzzy:true})[0]
  const svg=exportLayoutSvg(plan)
  expect(svg).toContain('比例估算')
  expect(svg).toContain('案例启发')
})

test('invalid fuzzy advice cannot break imported UI or disable clearance checking',()=>{
  const room={w:8,d:6,h:3.2,shopType:'边厅店'},layout=generatePlans(room,{fuzzy:true})[0]
  layout.fuzzyAdvice.references='bad'
  expect(()=>parseProject(JSON.stringify({nodes:[{id:'r',name:'空间',kind:'root',room},{id:'p',name:'方案',kind:'plan',parent:'r',layout}]}))).toThrow(/案例/)
})

test('browser table-ruler input generates explainable plans and preserves them on reload',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'按桌长估比例',exact:true}).click()
  await page.getByLabel('宽约几张桌长').fill('3')
  await page.getByLabel('深约几张桌长').fill('5')
  await page.getByRole('button',{name:'生成四个平面方案'}).click()
  await expect(page.locator('.plan-card')).toHaveCount(4)
  await expect(page.getByText('案例启发 · 非实测布局',{exact:true}).first()).toBeVisible()
  await page.locator('.plan-card').first().click()
  await expect(page.getByTestId('fuzzy-advice')).toBeVisible()
  await page.reload()
  await page.locator('.branch-list button').filter({hasText:'方案 A'}).click()
  await expect(page.getByTestId('fuzzy-advice')).toBeVisible()
  await page.screenshot({path:'test-results/fuzzy-editor.png',fullPage:true})
})
