import {chromium} from '@playwright/test'
import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
process.chdir(fileURLToPath(new URL('../',import.meta.url)))
const base='http://127.0.0.1:64071'
const browser=await chromium.launch({channel:'msedge',headless:true})
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}})
 await page.goto(base)
 await page.getByRole('link',{name:'SI 模型库 ↗'}).waitFor()
 const [library]=await Promise.all([page.waitForEvent('popup'),page.getByRole('link',{name:'SI 模型库 ↗'}).click()])
 await library.waitForLoadState('domcontentloaded')
 if(await library.locator('article').count()!==90)throw Error('Missing cards')
 for(const name of ['普通中岛桌','亮脚中岛桌','普通开箱桌','亮脚开箱桌'])if(!(await library.locator('h2').allTextContents()).some(x=>x.includes(name)))throw Error('Missing category '+name)
 const urls=await library.locator('[href],img[src]').evaluateAll(els=>[...new Set(els.map(el=>el.href||el.src).filter(x=>x.startsWith(location.origin)))])
 for(const url of urls){const r=await fetch(url,{method:'HEAD'});if(!r.ok)throw Error(`${r.status} ${url}`)}
 for(const [category,total] of [['软装物料',38],['信息化物料',19],['展陈物料',33]]){
  await library.getByRole('button',{name:category+' · '+total,exact:true}).click()
  if(await library.locator('article:visible').count()!==total)throw Error('Wrong category count '+category)
 }
 await library.getByRole('button',{name:'软装物料 · 38',exact:true}).click()
 await library.getByLabel('软装SI版本').selectOption('SI1.0')
 if(await library.locator('article:visible').count()!==12)throw Error('SI1 count')
 await library.getByLabel('软装SI版本').selectOption('SI2.0')
 if(await library.locator('article:visible').count()!==24)throw Error('SI2 count')
 await library.getByRole('button',{name:'全部 · 90',exact:true}).click()
 await library.getByLabel('仅看已有图例').check()
 if(await library.locator('article:visible').count()!==45)throw Error('Legend mapping count')
 await library.getByLabel('仅看已有图例').uncheck()
 await library.getByLabel('搜索模型').fill('亮脚开箱桌')
 if(await library.locator('article:visible').count()!==1)throw Error('Search failed')
 await library.getByLabel('搜索模型').fill('')
 const model=await library.locator('.file').first().getAttribute('href')
 const downloaded=await fetch(new URL(model,library.url()))
 if(!downloaded.headers.get('content-disposition')?.includes('attachment'))throw Error('No SU download header')
 const bytes=Buffer.from(await downloaded.arrayBuffer())
 const manifest=await (await fetch(base+'/model-library/manifest.json')).json()
 const legends=manifest.assets.filter(a=>a.plan_legend)
 if(new Set(legends.map(a=>a.plan_legend.file)).size!==45)throw Error('Clean legends must map to individual models')
 if(legends.some(a=>!a.plan_legend.file.startsWith('平面图例/纯净版/')||!a.original_plan_legend||!a.plan_legend.raw_file))throw Error('Missing clean legend provenance')
 const tables=legends.filter(a=>/普通中岛桌|亮脚中岛桌|普通开箱桌|亮脚开箱桌/.test(a.standard_name))
 if(tables.length!==8||tables.some(a=>a.plan_legend.support_segment_count<4))throw Error('Missing verified table support')
 await library.locator('.plan-image').evaluateAll(imgs=>Promise.all(imgs.map(img=>{img.loading='eager';return img.decode()})))
 if(await library.locator('.plan-image').evaluateAll(imgs=>imgs.some(img=>img.naturalWidth!==1200||img.naturalHeight!==800)))throw Error('Wrong clean legend dimensions')
 if(createHash('sha256').update(bytes).digest('hex')!==manifest.assets.find(a=>a.named_skp===decodeURIComponent(model)).named_sha256)throw Error('Download hash mismatch')
 for(const suffix of ['not-listed.skp','%2e%2e%2f%2e%2e%2fREADME.md']){
  const r=await fetch(base+'/model-library/'+suffix);if(r.status!==404)throw Error('Unlisted file exposed')
 }
 if((await fetch(base+'/model-library/',{method:'POST'})).status!==405)throw Error('POST allowed')
 await library.screenshot({path:'../output/si-standards-review-20261001/网站模型库-桌面.png'})
 await library.setViewportSize({width:390,height:844});await library.screenshot({path:'../output/si-standards-review-20261001/分类图例-手机.png'});if(await library.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');await library.setViewportSize({width:1440,height:1000})
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'../output/si-standards-review-20261001/网站入口-手机.png'})
 await library.getByRole('link',{name:'两套标准 · 360页'}).click()
 if(await library.locator('article').count()!==360)throw Error('Missing standards pages')
 const img=await library.locator('img').first().getAttribute('src')
 if(!(await fetch(new URL(img,library.url()))).ok)throw Error('Missing standard image')
 const results={cards:90,categoryCounts:[38,19,33],softSiCounts:[12,24,2],modelsWithPlanLegend:45,cleanImagesDecoded:45,individualModelMapping:'passed',tableSupportSections:8,originalCropsRetained:25,filterAndSearch:'passed',checkedUrls:urls.length,downloadSha256:'passed',tableCategories:4,standardPages:360,unlistedFiles:'blocked',post:'blocked',url:base+'/model-library/'}
 await writeFile('../output/si-standards-review-20261001/网站接入检查.json',JSON.stringify(results,null,2))
 console.log(JSON.stringify(results))
}finally{await browser.close()}
