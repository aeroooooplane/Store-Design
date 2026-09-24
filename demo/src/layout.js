import trainedModel from './generated/layout-model.json' with {type:'json'}
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
export function generatePlans(room,{learned=false}={}) {
  const names = ['中轴体验', '环形展示', '双体验岛', '入口展示']
  const templates = [
    [['display',.2,.1],['display',.8,.1],['table',.5,.5],['counter',.8,.82]],
    [['display',.2,.1],['display',.8,.1],['table',.25,.54],['counter',.8,.82]],
    [['display',.5,.1],['table',.24,.5],['table',.76,.5],['counter',.8,.85]],
    [['display',.22,.14],['display',.78,.14],['table',.75,.55],['counter',.2,.8]],
  ]
  const plans=templates.map((template,i)=>({name:`方案 ${'ABCD'[i]} · ${names[i]}`, room, items:template.map(([type,x,z],j)=>({id:`item-${i}-${j}`,type,...catalog[type],x:Math.max(0,Math.min(room.w-catalog[type].w,room.w*x-catalog[type].w/2)),z:Math.max(0,Math.min(room.d-catalog[type].d,room.d*z-catalog[type].d/2))}))}))
  return learned?plans.map((p,i)=>applyCountModel(p,i)):plans
}
function applyCountModel(plan,variant){
 const area=plan.room.w*plan.room.d,m=trainedModel;
 const advice={modelVersion:m.version,datasetSha256:m.datasetSha256,trainingStores:m.count,status:'experimental',placement:'rule-based, not learned',mae:m.evaluation.mae};
 if(area<m.minArea||area>m.maxArea)return {...plan,modelAdvice:{...advice,status:'outside-training-range',placed:plan.items.filter(i=>i.type==='table').length}};
 const predicted=m.b+m.w*(area-m.mean)/m.scale,requested=Math.max(1,Math.min(4,Math.round(predicted))),items=plan.items.filter(i=>i.type!=='table');
 const positions=[];const table={...catalog.table,w:1.8,d:.8,h:.9};
 for(let z=.6;z<=plan.room.d-table.d-.6;z+=.2)for(let x=.3;x<=plan.room.w-table.w-.3;x+=.2)positions.push({x,z});
 const targets=[[.5,.5],[.3,.5],[.65,.5],[.5,.65]],target=targets[variant];
 positions.sort((a,b)=>((a.x+table.w/2)/plan.room.w-target[0])**2+((a.z+table.d/2)/plan.room.d-target[1])**2-(((b.x+table.w/2)/plan.room.w-target[0])**2+((b.z+table.d/2)/plan.room.d-target[1])**2));
 let placed=0;for(const pos of positions){if(placed>=requested)break;const a={id:`learned-${variant}-${placed}`,type:'table',...table,...pos};if(items.some(b=>a.x<b.x+b.w+.35&&b.x<a.x+a.w+.35&&a.z<b.z+b.d+.35&&b.z<a.z+a.d+.35))continue;items.push(a);placed++}
 if(!placed)return {...plan,modelAdvice:{...advice,status:'placement-fallback',requested,predicted,placed:plan.items.filter(i=>i.type==='table').length}};
 return {...plan,items,modelAdvice:{...advice,predicted,requested,placed,status:placed<requested?'capacity-limited':'experimental'}}
}
export function issues(layout) {
  const {room,items}=layout; const result=[]
  items.forEach((a,i)=>{
    if(a.x<0||a.z<0||a.x+a.w>room.w+.001||a.z+a.d>room.d+.001) result.push(`${a.name}超出门店边界`)
    items.slice(i+1).forEach(b=>{if(a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d) result.push(`${a.name}与${b.name}重叠`)})
  }); return result
}
