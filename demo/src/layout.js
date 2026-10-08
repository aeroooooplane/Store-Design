import trainedModel from './generated/layout-model.json' with {type:'json'}
import {spacePlan,planningIssues} from './space-planner.js'
import {fuzzyPlans} from './fuzzy-layout.js'
export const catalog = {
  display: { name: '展示柜', w: 1.2, d: .45, h: 1.5 },
  table: { name: '体验桌', w: 1.5, d: .8, h: .85 },
  counter: { name: '收银台', w: 1.4, d: .6, h: 1.05 },
}
export function dimensions(mode, width, depth, area, ratio, height) {
  const w = mode === 'area' ? Math.sqrt(Number(area) * Number(ratio)) : Number(width)
  const d = mode === 'area' ? Math.sqrt(Number(area) / Number(ratio)) : Number(depth)
  const h = Number(height)
  if (![w,d,h].every(Number.isFinite) || w < 4 || d < 4 || w > 30 || d > 30 || h < 2.4 || h > 6) throw Error('Demo 支持长宽各 4–30 米、层高 2.4–6 米，请调整输入。')
  return { w, d, h }
}
export function generatePlans(room,{learned=false,fuzzy=false}={}) {
  if(fuzzy)return fuzzyPlans(room)
  const names = ['中轴双列', '宽松体验', '纵向陈列', '侧向动线']
  return names.map((name,i)=>{
    const area=room.w*room.d,m=trainedModel,inRange=area>=m.minArea&&area<=m.maxArea
    const targetCount=learned&&inRange?Math.max(1,Math.min(4,Math.round(m.b+m.w*(area-m.mean)/m.scale))):undefined
    const plan={...spacePlan(room,i,{targetCount}),name:`方案 ${'ABCD'[i]} · ${name}`}
    if(learned)plan.modelAdvice={modelVersion:m.version,datasetSha256:m.datasetSha256,status:inRange?'experimental':'outside-training-range',trainingStores:m.count,placed:plan.planning.placed,requested:plan.planning.requested}
    return plan
  })
}
export function heightIssues({room,items}) {
  return items.filter(item=>item.h>room.h+.001).map(item=>`${item.name}高度超过层高`)
}
export function issues(layout) {
  const {room,items}=layout; const result=[...heightIssues(layout),...planningIssues(layout)]
  if(layout.fuzzyAdvice){
    if(!items.some(i=>i.type==='table'))result.push('当前比例无法容纳体验桌，请调整空间或功能留位')
    if(!items.some(i=>i.type==='counter'))result.push('服务柜未放下，请人工补充收银/开箱功能')
  }
  items.forEach((a,i)=>{
    if(a.x<0||a.z<0||a.x+a.w>room.w+.001||a.z+a.d>room.d+.001) result.push(`${a.name}超出门店边界`)
    items.slice(i+1).forEach(b=>{if(a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d) result.push(`${a.name}与${b.name}重叠`)})
  }); return result
}
