import fs from 'node:fs/promises';
const dir='../../素材库/01_catalog/classification';
const master=(await fs.readFile(dir+'/master.ndjson','utf8')).trim().split(/\r?\n/).map(JSON.parse);
const rows=JSON.parse(await fs.readFile(dir+'/stores.json','utf8'));
const norm=s=>(s||'').normalize('NFKC').toLowerCase().replace(/\.pdf$/,'').replace(/\s+/g,'');
const core=s=>norm(s).replace(/授权体验店|授权专卖店|照材专卖店|授权专区/g,'').replace(/[()]/g,'');
const counts={};
for(const r of rows){const name=norm(r.file);let method='项目名称精确/格式标准化',candidates=master.filter(m=>norm(m['项目名称'])===name);
 if(!candidates.length){method='项目名经营类型后缀标准化';candidates=master.filter(m=>core(m['项目名称'])===core(r.file))}
 if(!candidates.length){method='附件同名';candidates=master.filter(m=>(m['图纸pdf(效果图+施工图)']||[]).some(a=>norm(a.name)===name))}
 const bytes=(await fs.stat('../../'+r.path)).size;
 if(candidates.length>1){const sized=candidates.filter(m=>(m['图纸pdf(效果图+施工图)']||[]).some(a=>a.size===bytes));if(sized.length===1){candidates=sized;method+=' + 附件字节数唯一一致（非内容哈希）'}}
 if(!candidates.length&&r.file==='深圳壹方汇直营店.pdf'){const alias=master.filter(m=>m['项目名称']==='深圳壹方汇授权体验店'&&(m['图纸pdf(效果图+施工图)']||[]).some(a=>a.size===bytes));if(alias.length===1){candidates=alias;method='人工核对商场名称 + 附件字节数一致；经营类型名称不同'}}
 r.matchCandidates=candidates.map(m=>({recordId:m.record_id,name:m['项目名称'],si:m['SI形象'],shopType:m['铺型']}));r.matchMethod=candidates.length?method:null;
 if(candidates.length===1){const m=candidates[0];r.masterName=m['项目名称'];r.recordId=m.record_id;r.masterRaw={si:m['SI形象'],shopType:m['铺型'],designStart:m['启动设计时间']};r.si=m['SI形象']?.[0]?.toUpperCase()||null;r.shopType=m['铺型']?.[0]?({'边厅':'边厅店','中岛':'中岛店'}[m['铺型'][0]]||m['铺型'][0]):null;r.siSource=r.si?'飞书总表.SI形象':null;r.typeSource=r.shopType?'飞书总表.铺型':null;r.combinedTag=r.si&&r.shopType?`${r.si} ${r.shopType}`:null;r.status=r.combinedTag?'总表已匹配，PDF版本待核对':'总表已匹配，标签字段缺失';r.sourceUrl='https://arashivision.feishu.cn/wiki/Ynt0wThwNiaX8Dk0Gm2c2XlJnsc?table=tbl394Uo6M3FuGaN&record='+m.record_id;r.labelConflict=!!(r.siCandidate&&r.si&&r.siCandidate!==r.si)||!!(r.documentTypeHint&&r.shopType&&r.documentTypeHint!==r.shopType);if(r.labelConflict)r.status='总表与PDF线索冲突，待核对';
 }else{r.status=candidates.length?'总表同名多记录，待消歧':'未匹配总表';r.masterName=null;r.si=null;r.shopType=null;r.combinedTag=null;r.recordId=null}
 if(r.recordId){const m=master.find(m=>m.record_id===r.recordId);r.sameSizeAttachments=(m['图纸pdf(效果图+施工图)']||[]).filter(a=>a.size===bytes).map(a=>({name:a.name,size:a.size}));r.attachmentSizeMatches=r.sameSizeAttachments.length>0;r.labelSyncedAt=new Date().toISOString()}
 counts[r.status]=(counts[r.status]||0)+1;
}
await fs.writeFile(dir+'/stores.json',JSON.stringify(rows,null,2));const summary={masterRecords:master.length,scope:'all_records（为匹配全量本地PDF，读取汇总整表，不限分享链接视图）',hasMore:false,files:rows.length,matched:rows.filter(r=>r.recordId).length,completeTags:rows.filter(r=>r.combinedTag).length,conflicts:rows.filter(r=>r.labelConflict).length,status:counts,groups:rows.filter(r=>r.combinedTag).reduce((a,r)=>(a[r.combinedTag]=(a[r.combinedTag]||0)+1,a),{}),syncedAt:new Date().toISOString()};await fs.writeFile(dir+'/match-summary.json',JSON.stringify(summary,null,2));console.log(summary);
console.log('UNRESOLVED',rows.filter(r=>!r.recordId).map(r=>r.file));
