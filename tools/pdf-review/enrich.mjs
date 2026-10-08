import fs from 'node:fs/promises';const dir='../../素材库/01_catalog/classification';const rows=JSON.parse(await fs.readFile(dir+'/stores.json','utf8'));
for(const r of rows){let d;try{d=JSON.parse(await fs.readFile(dir+'/page-index/'+r.file+'.json','utf8'))}catch{continue}
 r.planPages=[];r.constructionPages=[];r.imagePages=[];r.typeEvidence=[];
 for(const p of d.pages){const t=p.text.replace(/\s+/g,'');const cover=/平面图.*效果图.*施工图/.test(t),toc=/图纸目录/.test(t);
 if(!cover&&!toc&&/家具定位|平面布置|原始结构图|原始平面|FURNISHINGPLAN|FLOORPLAN/i.test(t))r.planPages.push(p.page);
 if(!cover&&!toc&&/立面图|天花|节点图|配电|铺装|施工说明|物料表|大样图/.test(t))r.constructionPages.push(p.page);
 if(t.length<40)r.imagePages.push(p.page);
 if(p.page<=3){const side=/边厅店|SIDEHALLSTORE/i.test(t),island=/中岛店|ISLANDSTORE/i.test(t);if(side||island)r.typeEvidence.push({page:p.page,labels:[...(side?['边厅店']:[]),...(island?['中岛店']:[])],excerpt:p.text.slice(0,200)})}}
 const types=[...new Set(r.typeEvidence.flatMap(e=>e.labels))];r.documentTypeHint=types.length===1?types[0]:null;
 const evidence=[];for(const p of d.pages){const matches=[...p.text.matchAll(/.{0,35}SI\s*([12])[.．]\s*0.{0,100}/ig)];for(const m of matches)evidence.push({page:p.page,label:`SI${m[1]}.0`,excerpt:m[0]})}
 r.siEvidence=evidence;r.siCandidate=[...new Set(evidence.map(e=>e.label))].length===1?evidence[0].label:null;r.candidateBasis=evidence.length?'PDF明确SI文字；可能为道具表，待核对数量及图纸版本':null;
 const type=r.documentTypeHint||r.filenameTypeHint;r.provisionalTag=r.siCandidate&&type?`${r.siCandidate} ${type}（候选）`:null;
 if(r.file==='上海星光摄影城照材专卖店.pdf'){r.shopType='边厅店';r.typeSource={kind:'PDF图框标题',page:1,text:'上海星光摄影器材城边厅照材店'};r.status='铺型图纸明示；SI待总表'}
}
await fs.writeFile(dir+'/stores.json',JSON.stringify(rows,null,2));const summary=JSON.parse(await fs.readFile(dir+'/summary.json','utf8'));summary.siTextCandidates=rows.filter(r=>r.siCandidate).length;summary.siTextConflicts=rows.filter(r=>!r.siCandidate&&r.siEvidence?.length).length;summary.planCandidateFiles=rows.filter(r=>r.planPages.length).length;summary.noPlanTextHit=rows.filter(r=>!r.planPages.length&&!r.scanError).length;await fs.writeFile(dir+'/summary.json',JSON.stringify(summary,null,2));console.log(summary);
