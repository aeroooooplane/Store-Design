import {layoutCases} from './layout-cases.js'
import {realAssets} from './real-assets.js'
import {createAssetItem} from './asset-contract.js'

const round=n=>Math.round(n*1000)/1000
const apart=(a,b,gap=0)=>a.x+a.w+gap<=b.x+.001||b.x+b.w+gap<=a.x+.001||a.z+a.d+gap<=b.z+.001||b.z+b.d+gap<=a.z+.001
export const patternNames={single:'单桌体验',serial:'横桌纵向串列',parallel:'纵桌横向并列','cross-row':'横桌前沿展开',grid:'分组双列'}
export function tableRelativeRoom(widthUnits,depthUnits,height,shopType,block='none'){
  const w=Number(widthUnits)*1.8,d=Number(depthUnits)*1.8,h=Number(height)
  if(![w,d,h].every(Number.isFinite)||w<2.4||d<2.4||w>30||d>30||h<2.4||h>6)throw Error('比例输入折算长宽需在2.4–30米、层高2.4–6米范围内')
  if(!['none','left','right','center'].includes(block))throw Error('障碍区域无效')
  return {w:round(w),d:round(d),h,shopType,fuzzyBlock:block,dimensionBasis:'table-relative-estimate',tableUnit:1.8}
}
// Exclusion occurs BEFORE ranking. No label from the excluded case is used.
export function recommendLayout({widthUnits,depthUnits,shopType='边厅店',blocked=false},{excludeId,cases=layoutCases}={}){
  if(![widthUnits,depthUnits].every(n=>Number.isFinite(n)&&n>0))throw Error('桌尺度比例无效')
  const ranked=cases.filter(c=>c.eligible&&c.id!==excludeId&&c.shopType===shopType).map(c=>{
    const distance=Math.abs(Math.log(widthUnits/c.span[0]))+Math.abs(Math.log(depthUnits/c.span[1]))+.35*Math.abs(Math.log((widthUnits/depthUnits)/(c.span[0]/c.span[1])))+(blocked!==c.blocked?.25:0)
    return {...c,distance}
  }).sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id))
  const refs=ranked.slice(0,3),nearest=refs[0]
  if(!nearest)return {method:'table-relative-cases-v1',support:'no-reference',range:[0,0],suggested:0,references:[],pattern:'single'}
  const weights=refs.map(c=>1/(.15+c.distance)**2)
  const suggested=Math.round(refs.reduce((s,c,i)=>s+c.tableCount*weights[i],0)/weights.reduce((a,b)=>a+b,0))
  const range=[Math.max(1,Math.min(...refs.map(c=>c.tableCount),suggested-1)),Math.min(8,Math.max(...refs.map(c=>c.tableCount),suggested+1))]
  return {method:'table-relative-cases-v1',support:nearest.distance>1?'outside-reference-range':'limited-case-support',range,suggested,pattern:nearest.pattern,
    references:refs.map(c=>({id:c.id,name:c.name,page:c.page,source:c.source,pattern:c.pattern,serviceSide:c.serviceSide,count:c.tableCount,distance:round(c.distance),note:c.note,functions:c.functions})),
    uncertainty:'比例约±10%；区间是案例启发，不是统计置信区间；需核入口、墙柱和操作空间。'}
}

function arrange(room,count,pattern,variant,serviceSide='rear'){
  const island=room.shopType==='中岛店',items=[],zones=[],gap=variant===1?1.2:.9,edge=.08
  const make=(type,x,z,turn=false)=>{
    const item=createAssetItem(realAssets.find(a=>a.category===type),`fuzzy-${variant}-${items.length}`,round(x),round(z))
    if(turn){[item.w,item.d]=[item.d,item.w];item.rotation=90}
    return item
  }
  const block=room.fuzzyBlock||'none'
  if(block!=='none'){
    const w=round(room.w*.22),d=round(room.d*.3)
    items.push({id:`block-${variant}`,name:'障碍/不可用区域（估计）',type:'structure',profile:'solid',x:block==='left'?0:block==='right'?room.w-w:(room.w-w)/2,z:block==='center'?(room.d-d)/2:0,w,d,h:room.h})
  }
  // A service fixture is required; it is not counted as an experience table.
  // Keep rear staff access in edge shops, while shallow islands use a boundary counter.
  const sideService=serviceSide!=='rear',serviceZ=sideService?(room.d-1.8)/2:island?0:.75
  const service=sideService?make('counter',serviceSide==='left'?0:room.w-.5,serviceZ):make('counter',(room.w-1.8)/2,serviceZ,true)
  if(items.every(i=>apart(service,i,.15))&&service.x>=0&&service.z+service.d<=room.d){
    items.push(service)
    if(!island&&!sideService)zones.push({name:'员工操作留位（假设）',x:service.x,z:0,w:service.w,d:.75})
  }else{
    const alternative={...service,x:round(room.w-1.8-edge),z:serviceZ}
    if(items.every(i=>apart(alternative,i,.15)))items.push(alternative)
  }
  const front=island?0:.8
  if(front)zones.push({name:'入口缓冲（假设）',x:0,z:room.d-front,w:room.w,d:front})
  // Whole aligned groups, never nearest-grid-point scattering. Remove a table
  // when a complete group cannot fit; don't squeeze/stretch physical assets.
  let placed=0
  for(let n=count;n>=1&&!placed;n--){
    const turn=pattern==='serial'||pattern==='cross-row'||pattern==='single'
    const proto=make('table',0,0,turn),cols=pattern==='serial'||pattern==='single'?1:pattern==='grid'?Math.min(2,n):n,rows=Math.ceil(n/cols)
    const gw=cols*proto.w+(cols-1)*gap,gd=rows*proto.d+(rows-1)*gap
    const minZ=sideService?edge:serviceZ+.5+gap,maxZ=room.d-front-gd
    const left=sideService&&serviceSide==='left'?.5+gap:edge,right=sideService&&serviceSide==='right'?room.w-.5-gap:room.w-edge
    if(gw>right-left+.001||maxZ<minZ-.001)continue
    const centers=[(left+right-gw)/2,left,right-gw]
    for(const x of centers){
      const z=minZ+(maxZ-minZ)*.5,group=[]
      for(let j=0;j<n;j++)group.push({...proto,id:`table-${variant}-${j}`,x:round(x+(j%cols)*(proto.w+gap)),z:round(z+Math.floor(j/cols)*(proto.d+gap))})
      if(group.every(t=>t.x>=0&&t.z>=0&&t.x+t.w<=room.w+.001&&t.z+t.d<=room.d+.001&&items.every(i=>apart(t,i,i.type==='structure'?.3:gap))&&zones.every(zone=>apart(t,zone)))){
        items.push(...group);placed=n;break
      }
    }
  }
  // A single suitable cabinet, not an automatically filled rear wall.
  for(const x of [edge,room.w-1.6-edge]){
    const display=make('display',x,0)
    if(display.h<=room.h&&display.x>=0&&items.every(i=>apart(display,i,i.type==='table'?gap:.15))&&zones.every(z=>apart(display,z))){items.push(display);break}
  }
  return {room,items,planning:{version:2,area:round(room.w*room.d),requested:count,placed,aisle:0,clearance:gap,zones,status:placed<count?'capacity-limited':'ready',note:'案例比例草案；仅检查占位与家具间距，不等于路径连通或现场验收。'},chosenPattern:pattern==='single'&&placed>1?'serial':pattern}
}
export function fuzzyPlans(room){
  const advice=recommendLayout({widthUnits:room.w/1.8,depthUnits:room.d/1.8,shopType:room.shopType,blocked:!!room.fuzzyBlock&&room.fuzzyBlock!=='none'})
  const variants=[{n:advice.suggested,p:advice.pattern,label:'相似案例'}, {n:advice.range[0],p:advice.pattern,label:'宽松减量'},
    {n:advice.range[1],p:advice.pattern,label:'容量试排'}, {n:advice.suggested,p:advice.references[1]?.pattern||advice.pattern,label:'备选组织'}]
  return variants.map((v,i)=>{
    const ref=advice.references[i===3?1:0],plan=arrange(room,v.n,v.p,i,ref?.serviceSide),warnings=[]
    if(plan.planning.placed<v.n)warnings.push(`建议${v.n}张，当前真实模型尺寸只能排${plan.planning.placed}张；未强塞`)
    if(!plan.items.some(x=>x.type==='counter'))warnings.push('收银/开箱服务位未放下，需要调整')
    if(advice.support!=='limited-case-support')warnings.push('超出相似案例范围，数量仅供探索，不能视为已学会此类门店')
    warnings.push('边界按矩形包络；斜边、凹位、柱与开放边须人工核对；未自动复刻原店')
    return {...plan,name:`方案 ${'ABCD'[i]} · ${v.label} / ${patternNames[plan.chosenPattern]}`,fuzzyAdvice:{...advice,pattern:plan.chosenPattern,requested:v.n,warnings}}
  })
}
