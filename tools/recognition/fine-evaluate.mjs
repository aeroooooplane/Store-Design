import assert from 'node:assert/strict'
export function evaluateFine(raw,review) {
 assert.equal(raw.inputSha256,review.sourceSha256,'原图SHA不一致')
 const byId=new Map(raw.candidates.map(c=>[c.id,c])),seen=new Set()
 const objects=review.objects.filter(o=>o.kind!=='unknown')
 let geometryRetained=0,categoryAndGeometryRetained=0
 for(const o of objects){
  if(o.candidateId){assert(!seen.has(o.candidateId),'候选不能重复计分');seen.add(o.candidateId);assert(byId.has(o.candidateId),'候选不存在')}
  if(o.geometryOrigin==='automatic-retained'){
   const c=byId.get(o.candidateId);assert.deepEqual(o.points,c.geometry.points,'保留对象必须逐坐标不变');geometryRetained++
   if(o.semanticOrigin==='automatic-retained'){assert.equal(c.kind,o.kind);categoryAndGeometryRetained++}
  }
 }
 const proposals=raw.candidates.filter(c=>c.kind!=='unknown')
 const falsePositives=proposals.filter(c=>!objects.some(o=>o.candidateId===c.id&&o.kind===c.kind)).map(c=>c.id)
 const geometryMisses=objects.filter(o=>!o.candidateId).map(o=>o.id)
 const needsGeometryCorrection=objects.filter(o=>o.candidateId&&o.geometryOrigin!=='automatic-retained').map(o=>o.id)
 return {storeId:review.storeId,candidatePool:raw.candidates.length,objectProposals:proposals.length,referenceObjects:objects.length,unresolvedObjects:review.objects.length-objects.length,geometryRetained,categoryAndGeometryRetained,falsePositives,geometryMisses,needsGeometryCorrection,categoryMisses:objects.filter(o=>!o.candidateId||byId.get(o.candidateId).kind!==o.kind).map(o=>o.id),elapsedSeconds:raw.elapsedSeconds,automaticComplete:false,scope:'主要对象外接几何；不含墙、门洞、边界自动完整率；名称与模型未自动验收'}
}
