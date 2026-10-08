import {exportLayoutSvg} from './plan-export.js'

export async function exportLayoutPng(layout){
  const doc=new DOMParser().parseFromString(exportLayoutSvg(layout,{forRaster:true}),'image/svg+xml')
  const svg=doc.documentElement,[,,w,h]=svg.getAttribute('viewBox').split(/\s+/).map(Number)
  const scale=Math.min(160,4096/w,4096/h,Math.sqrt(8000000/(w*h)))
  const width=Math.max(1,Math.floor(w*scale)),height=Math.max(1,Math.floor(h*scale))
  svg.setAttribute('width',String(width));svg.setAttribute('height',String(height))
  const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml;charset=utf-8'}))
  const image=new Image(),canvas=document.createElement('canvas')
  try{
    image.src=url;await image.decode()
    canvas.width=width;canvas.height=height
    const ctx=canvas.getContext('2d')
    if(!ctx)throw Error('当前浏览器无法创建平面画布')
    ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(image,0,0,width,height)
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('PNG 编码失败，未导出图片')),'image/png'))
    return {blob,width,height}
  }finally{URL.revokeObjectURL(url);image.src='';canvas.width=canvas.height=1}
}

export async function downloadPlanPng(layout){
  const result=await exportLayoutPng(layout),url=URL.createObjectURL(result.blob)
  const a=document.createElement('a');a.href=url;a.download='store-plan.png';a.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
  return {width:result.width,height:result.height}
}
