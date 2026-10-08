import {issues} from './layout.js'

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
const number=value=>String(Number(value.toFixed(6)))

export function exportLayoutSvg(layout,{forRaster=false}={}){
  const room=layout?.room,items=layout?.items
  if(!room||!['w','d','h'].every(k=>Number.isFinite(room[k])&&room[k]>0)||!Array.isArray(items))throw Error('平面尺寸或道具列表无效')
  for(const item of items){
    if(!['x','z','w','d','h'].every(k=>Number.isFinite(item[k]))||!['w','d','h'].every(k=>item[k]>0))throw Error('道具坐标或尺寸无效')
  }
  const warnings=issues(layout)
  if(warnings.length)throw Error('导出前请处理：'+warnings.join('；'))
  const title=layout.name||'门店平面方案',w=room.w,d=room.d
  const notes=[
    ...(layout.fuzzyAdvice?['比例估算 · 案例启发 · 非实测布局；图中米制尺寸是草案换算，不是现场尺寸。',`初始生成时的案例建议 ${layout.fuzzyAdvice.range.join('–')} 张；以下提示未随编辑重新评估：${layout.fuzzyAdvice.warnings.join('；')}`]:[]),
    forRaster?'PNG 分享预览 · 非施工图 · 不保证打印比例；尺寸以标注和 SVG 为准。':'概念布局 · 非施工图 · 米制坐标；按原尺寸打印为 1:50。',
    room.shopType==='中岛店'?'中岛：四周开放为方案假设。':'边厅：入口按正面假设；实际门墙柱尚需核对。',
    layout.fuzzyAdvice?'仅核家具占位和预留区域；动线连通、开放边与操作空间仍待核对。':layout.planning?'已预留入口及1.20m主通道；设计间距0.90m，需专项消防复核。':'不含通道、消防、暖通水电校验；SI/正面未知不作推断。',
    `体验桌 ${items.filter(i=>i.type==='table').length} 张 · 展柜 ${items.filter(i=>i.type==='display').length} 组 · 面积 ${number(w*d)} ㎡`,
    ...items.map((i,n)=>`${n+1}. ${i.name||'道具'} · ${number(i.w)}×${number(i.d)}×${number(i.h)} m · ${i.rotation??0}° · ${i.assetId||'参数化示意'}`)
  ]
  const maxChars=Math.max(16,Math.floor(w/.13)),lines=notes.flatMap(line=>{
    const chars=Array.from(line),parts=[]
    for(let i=0;i<chars.length;i+=maxChars)parts.push(chars.slice(i,i+maxChars).join(''))
    return parts
  })
  const titleChars=Array.from(title),titleWidth=Math.max(1,Math.floor(w/.21)),titleLines=[]
  for(let i=0;i<titleChars.length;i+=titleWidth)titleLines.push(titleChars.slice(i,i+titleWidth).join(''))
  const titleExtra=Math.max(0,titleLines.length-1)*.26,top=-.8-titleExtra
  const height=d+1.6+lines.length*.22+titleExtra
  const text=(x,y,value,size=.14)=>`<text x="${number(x)}" y="${number(y)}" font-size="${size}">${escape(value)}</text>`
  const footprints=items.map((i,n)=>`<rect data-item-id="${escape(i.id)}" data-asset-id="${escape(i.assetId||'')}" x="${number(i.x)}" y="${number(i.z)}" width="${number(i.w)}" height="${number(i.d)}" fill="${i.assetId?'#dedede':'#f0f0f0'}" stroke="#111" stroke-width="0.018"/><text x="${number(i.x+i.w/2)}" y="${number(i.z+i.d/2)}" text-anchor="middle" dominant-baseline="middle" font-size="0.16">${n+1}</text>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" data-unit="m" width="${number((w+1.6)*20)}mm" height="${number(height*20)}mm" viewBox="-0.8 ${number(top)} ${number(w+1.6)} ${number(height)}" font-family="Arial,Microsoft YaHei,sans-serif" fill="#111">
<title>${escape(title)}</title>
<metadata>${escape(JSON.stringify({format:'store-plan-v1',unit:'m',scale:50,layout}))}</metadata>
<rect x="-0.8" y="${number(top)}" width="${number(w+1.6)}" height="${number(height)}" fill="white"/>
${titleLines.map((line,n)=>text(0,-.53-titleExtra+n*.26,line,.2)).join('\n')}
<rect x="0" y="0" width="${number(w)}" height="${number(d)}" fill="#fff" stroke="#111" stroke-width="0.035"/>
<path d="M 0 -0.1 V -0.3 H ${number(w)} V -0.1" fill="none" stroke="#616161" stroke-width="0.01"/>
${text(w/2-.3,-.34,`${number(w)} m`)}
${text(w+.12,d/2,`${number(d)} m`)}
${(layout.planning?.zones||[]).map(zone=>`<rect x="${number(zone.x)}" y="${number(zone.z)}" width="${number(zone.w)}" height="${number(zone.d)}" fill="#f5f5f5" stroke="#888" stroke-width=".012" stroke-dasharray=".08 .06"/>${text(zone.x+.06,zone.z+zone.d/2,zone.name,.11)}`).join('\n')}
${footprints}
${lines.map((line,n)=>text(0,d+.4+n*.22,line,.12)).join('\n')}
</svg>`
}

export function downloadPlan(layout){
  const svg=exportLayoutSvg(layout),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}))
  const a=document.createElement('a');a.href=url;a.download='store-plan.svg';a.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
