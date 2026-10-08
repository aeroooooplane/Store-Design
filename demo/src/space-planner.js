import {realAssets} from './real-assets.js'
import {createAssetItem} from './asset-contract.js'
import policy from './data/placement-policy.json' with {type:'json'}

const rounded=n=>Math.round(n*1000)/1000
const separated=(a,b,gap)=>a.x+a.w+gap<=b.x+.001||b.x+b.w+gap<=a.x+.001||a.z+a.d+gap<=b.z+.001||b.z+b.d+gap<=a.z+.001
export function circulationZones(room,variant=0){
  const island=room.shopType==='中岛店',front=island?1:1.2
  const side=room.w<6?0:variant===1?0:variant===3?room.w-1.2:(room.w-1.2)/2
  return [{name:'入口缓冲',x:0,z:room.d-front,w:room.w,d:front},
    {name:'主通道 1.20 m',x:side,z:1.4,w:1.2,d:Math.max(0,room.d-front-1.4)}]
}
export function spacePlan(room,variant=0,{targetCount}={}){
  const area=room.w*room.d,island=room.shopType==='中岛店',edge=island?.35:.12
  const zones=circulationZones(room,variant),items=[]
  const make=(category,x,z,turn=false)=>{
    const asset=realAssets.find(a=>a.id===policy.planningDefaults[category]),item=createAssetItem(asset,`auto-${variant}-${items.length}`,rounded(x),rounded(z))
    if(turn){[item.w,item.d]=[item.d,item.w];item.rotation=90}
    return item
  }
  // Back service band leaves the entrance and the main longitudinal route free.
  const counter=make('counter',room.w-edge-1.8,edge,true)
  if(counter.h<=room.h+.001)items.push(counter)
  for(let x=edge;x+1.6<=counter.x-.3;x+=1.9){
    const display=make('display',x,edge)
    if(display.h<=room.h+.001)items.push(display)
  }
  const base=Math.max(1,Math.floor((area-16)/18)+1)
  const requested=targetCount??Math.min(36,Math.max(1,base+[0,-1,1,0][variant]))
  const candidates=[]
  for(const turn of (variant===2?[false,true]:[true,false])){
    const proto=make('table',0,0,turn)
    for(let z=1.4;z+proto.d<=room.d-zones[0].d+.001;z+=.2){
      for(let x=edge;x+proto.w<=room.w-edge+.001;x+=.2){
        const item={...proto,x:rounded(x),z:rounded(z)}
        if(zones.some(zone=>!separated(item,zone,0)))continue
        candidates.push(item)
      }
    }
  }
  // Row-first / column-first arrangements offer distinct space-use choices.
  candidates.sort((a,b)=>variant===2?(a.x-b.x||a.z-b.z):(a.z-b.z||(variant===3?b.x-a.x:a.x-b.x)))
  const columns=room.w<6?1:Math.max(2,Math.floor((room.w-1.2)/3)),rows=Math.ceil(requested/columns)
  for(let slot=0;slot<requested;slot++){
    const col=slot%columns,row=Math.floor(slot/columns)
    const tx=room.w*(col+.5)/columns,tz=1.4+(room.d-zones[0].d-1.4)*(row+.5)/rows
    const ranked=candidates.filter(candidate=>items.every(other=>separated(candidate,other,.9)))
    ranked.sort((a,b)=>((a.x+a.w/2-tx)**2+(a.z+a.d/2-tz)**2)-((b.x+b.w/2-tx)**2+(b.z+b.d/2-tz)**2))
    if(!ranked.length)break
    items.push({...ranked[0],id:`auto-${variant}-${items.length}`})
  }
  const placed=items.filter(i=>i.type==='table').length
  return {room,items,planning:{version:2,area:rounded(area),requested,placed,aisle:1.2,clearance:.9,
    status:placed<requested?'capacity-limited':'ready',zones,
    note:'按面积与可用空间排布；主通道1.2m、道具间距0.9m为设计参数，非消防验收。'}}
}

export function planningIssues(layout){
  if(!layout.planning)return []
  const zones=layout.planning.zones||[],result=[]
  for(const item of layout.items){
    if(zones.some(zone=>!separated(item,zone,0)))result.push(`${item.name}占用预留通道`)
  }
  layout.items.forEach((a,i)=>layout.items.slice(i+1).forEach(b=>{
    const gap=layout.fuzzyAdvice?(a.type==='structure'||b.type==='structure'?.3:layout.planning.clearance):.9
    if((a.type==='table'||b.type==='table')&&!separated(a,b,gap))result.push(`${a.name}与${b.name}间距不足${gap.toFixed(2)}m`)
  }))
  return result
}
