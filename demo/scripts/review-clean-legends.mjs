import {chromium} from '@playwright/test'
import {readFile,writeFile,access} from 'node:fs/promises'
import {fileURLToPath,pathToFileURL} from 'node:url'
import path from 'node:path'
const root=fileURLToPath(new URL('../../',import.meta.url))
const work=path.join(root,'tmp/clean-legends')
const manifest=JSON.parse(await readFile(path.join(root,'资源库/04_软装道具模型/单件模型/manifest.json'),'utf8'))
let cards=[]
for(const a of manifest.assets.filter(a=>a.plan_legend)){
 const file=path.join(work,a.asset_id+'-proof.png')
 try{await access(file)}catch{continue}
 cards.push(`<figure><figcaption>${a.n} · ${a.standard_name}</figcaption><img src="${pathToFileURL(file).href}"></figure>`)
}
const browser=await chromium.launch({channel:'msedge',headless:true})
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000},deviceScaleFactor:1})
 const html='<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#eee;display:grid;grid-template-columns:repeat(3,1fr);font:16px sans-serif}figure{margin:8px;padding:8px;background:white}img{width:100%;height:300px;object-fit:contain}</style>'+cards.join('')
 const file=path.join(work,'review.html');await writeFile(file,html)
 await page.goto(pathToFileURL(file).href);await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())))
 const count=await page.locator('figure').count()
 for(let i=0;i<Math.ceil(count/12);i++){
  await page.locator('figure').evaluateAll((els,page)=>els.forEach((e,j)=>e.style.display=Math.floor(j/12)===page?'':'none'),i)
  await page.screenshot({path:path.join(work,`review-${i+1}.png`),fullPage:true})
 }
 console.log(JSON.stringify({renderedCards:count}))
}finally{await browser.close()}
