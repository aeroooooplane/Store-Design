import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {layoutCases} from '../src/layout-cases.js'
import {recommendLayout} from '../src/fuzzy-layout.js'
import {generatePlans,issues} from '../src/layout.js'
const root=fileURLToPath(new URL('../../',import.meta.url)),rows=[]
for(const c of layoutCases.filter(c=>c.eligible)){
  const advice=recommendLayout({widthUnits:c.span[0],depthUnits:c.span[1],shopType:c.shopType,blocked:c.blocked},{excludeId:c.id})
  const baseline=Math.max(1,Math.floor(((c.span[0]*c.tableLength)*(c.span[1]*c.tableLength)-16)/18)+1)
  const manifest=JSON.parse(await readFile(path.join(root,'素材库/03_training_candidates/batch01',c.id,'manifest.json'),'utf8'))
  const perturb=[]
  for(const x of [.9,1,1.1])for(const z of [.9,1,1.1]){
    const a=recommendLayout({widthUnits:c.span[0]*x,depthUnits:c.span[1]*z,shopType:c.shopType,blocked:c.blocked},{excludeId:c.id})
    perturb.push({scale:[x,z],suggested:a.suggested,range:a.range,covered:c.tableCount>=a.range[0]&&c.tableCount<=a.range[1]})
  }
  rows.push({id:c.id,source:c.source,page:c.page,sourceSha256:manifest.sourceSha256,actual:c.tableCount,predicted:advice.suggested,range:advice.range,baseline,
    actualPattern:c.pattern,predictedPattern:advice.pattern,neighbors:advice.references.map(r=>r.id),perturb})
}
const geometry={tested:0,usable:0,unusable:0,unexpected:[]}
for(const shopType of ['边厅店','中岛店'])for(const w of [2.4,4,6,8,12,30])for(const d of [2.4,4,6,9,15,30])for(const fuzzyBlock of ['none','left','right','center']){
  for(const p of generatePlans({w,d,h:3.2,shopType,fuzzyBlock},{fuzzy:true})){
    geometry.tested++;const all=issues(p);if(all.length)geometry.unusable++;else geometry.usable++
    const unexpected=all.filter(s=>!s.includes('无法容纳')&&!s.includes('服务柜未'))
    if(unexpected.length)geometry.unexpected.push({w,d,shopType,fuzzyBlock,unexpected})
  }
}
const report={generatedAt:new Date().toISOString(),scope:'Only explicitly labelled 1.8m experience-table shops; table depth .8/1m recorded separately; unknown depth is not fabricated.',
  method:'Exploratory leave-one-store-out on manually reviewed coarse features, not a blinded prospective evaluation. Topology rules were designed after seeing these pages.',
  excluded:layoutCases.filter(c=>!c.eligible).map(c=>({id:c.id,reason:c.standardTable?'conflicting store identity':'nonstandard 2.6m table'})),
  metrics:{stores:rows.length,exact:rows.filter(r=>r.predicted===r.actual).length,withinOne:rows.filter(r=>Math.abs(r.predicted-r.actual)<=1).length,
    rangeCovered:rows.filter(r=>r.actual>=r.range[0]&&r.actual<=r.range[1]).length,meanRangeWidth:rows.reduce((s,r)=>s+r.range[1]-r.range[0],0)/rows.length,
    mae:rows.reduce((s,r)=>s+Math.abs(r.predicted-r.actual),0)/rows.length,baselineMae:rows.reduce((s,r)=>s+Math.abs(r.baseline-r.actual),0)/rows.length,
    patternExact:rows.filter(r=>r.actualPattern===r.predictedPattern).length,perturbCovered:rows.flatMap(r=>r.perturb).filter(r=>r.covered).length,perturbTotal:rows.length*9},
  geometry,rows,limitations:['Quantity recommendation is not a complete valid layout.','Broad ranges can cover answers without identifying the best count.','Approximate bounding rectangles are not true irregular outlines.','Placement uses the available 1.8x1.0m SU model; .8m samples cannot be reproduced exactly by stretching it.','No independent external holdout; no claim of learned general design competence.']}
const dest=path.join(root,'output/web-qa/fuzzy-validation-20260928.json');await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({file:dest,metrics:report.metrics,geometry,excluded:report.excluded},null,2))
if(geometry.unexpected.length)process.exitCode=1
