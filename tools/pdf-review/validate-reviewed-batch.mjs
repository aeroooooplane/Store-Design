import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../demo/node_modules/@playwright/test/index.mjs';
const root=new URL('../../素材库/03_training_candidates/batch01/',import.meta.url);
const rows=JSON.parse(await fs.readFile(new URL('manifest.json',root),'utf8'));
assert.equal(rows.length,12);
assert.equal(rows.flatMap(r=>r.assets).filter(a=>a.role==='render').length,22);
assert.equal(rows.filter(r=>r.assets.some(a=>a.role==='render')).length,11);
const ignored=JSON.parse(await fs.readFile(new URL('../../01_catalog/classification/ignored-conflicts.json',root),'utf8'));
assert.equal(ignored.length,6);
for(const r of rows){assert.equal(r.trainingEligible,false);assert.match(r.sourceSha256,/^[a-f0-9]{64}$/);assert(!ignored.some(i=>i.id===r.id));for(const a of r.assets){for(const f of [a.file,a.fullPage]){const b=await fs.readFile(new URL(r.id+'/'+f,root));assert.equal(b.subarray(1,4).toString(),'PNG');}}}
const browser=await chromium.launch({channel:'msedge',headless:true});
try{const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(new URL('index.html',root).href);assert.equal(await page.locator('article').count(),12);await page.locator('#filter').selectOption('SI2.0 中岛店');assert.equal(await page.locator('article:visible').count(),3);await page.locator('#filter').selectOption('');await page.locator('img').evaluateAll(imgs=>imgs.forEach(i=>i.loading='eager'));await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));assert.equal(await page.locator('img').count(),34);assert.deepEqual(errors,[]);await page.screenshot({path:fileURLToPath(new URL('gallery-preview.png',root))});console.log('PASS: 12 stores, 34 selected images, 6 exclusions; all images load; filter 3/12; no page errors');}finally{await browser.close()}
