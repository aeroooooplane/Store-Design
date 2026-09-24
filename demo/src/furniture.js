// Parameterized concept geometry. Joinery and thicknesses are assumptions, not SKP measurements.
export const profiles={
  'open-table':'开敞四腿桌',
  'pedestal-table':'实体底座体验桌',
  'closed-counter':'封闭收银柜',
  'shelf-cabinet':'开放层板配件柜',
  solid:'结构占位'
}
export function profileFor(item){
  if(item.type==='structure')return 'solid'
  if(profiles[item.profile])return item.profile
  return {table:'open-table',counter:'closed-counter',display:'shelf-cabinet'}[item.type]||'solid'
}
export function furnitureParts(item){
  const {w,d,h}=item,profile=profileFor(item),parts=[]
  const add=(role,x,y,z,w,h,d)=>parts.push({role,x,y,z,w,h,d})
  const t=Math.min(.045,h*.08,w*.08,d*.08)
  if(profile==='solid'){add('body',w/2,h/2,d/2,w,h,d);return parts}
  add('top',w/2,h-t/2,d/2,w,t,d)
  if(profile==='open-table'){
    const leg=Math.min(.065,w*.12,d*.12),inset=leg
    for(const x of [inset,w-inset])for(const z of [inset,d-inset])add('leg',x,(h-t)/2,z,leg,h-t,leg)
  }else if(profile==='pedestal-table'){
    add('base',w/2,(h-t)/2,d/2,w*.66,h-t,d*.66)
  }else{
    // The short footprint axis is cabinet depth. Front faces +Z, or +X for a tall footprint.
    const sideways=d>w, length=sideways?d:w,depth=sideways?w:d
    const part=(role,u,y,v,a,b,c)=>sideways?add(role,v,y,u,c,b,a):add(role,u,y,v,a,b,c)
    part('plinth',length/2,t/2,depth/2,length*.94,t,depth*.88)
    part('back',length/2,h/2,t/2,length,h-2*t,t)
    for(const u of [t/2,length-t/2])part('side',u,h/2,depth/2,t,h-2*t,depth)
    if(profile==='closed-counter'){
      for(const u of [length*.25,length*.75])part('door',u,h/2,depth-t/2,length/2-t*.4,h-2*t,t)
    }else{
      for(const y of [t*1.5,h*.48])part('shelf',length/2,y,depth/2,length-2*t,t,depth-t)
      part('divider',length/2,h/2,depth/2,t,h-2*t,depth-t)
    }
  }
  return parts
}
