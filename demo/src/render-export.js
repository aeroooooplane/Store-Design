import {pngBytes} from './png-data.js'
import {zipSync,strToU8} from 'three/addons/libs/fflate.module.js'
import {cameraFor} from './camera-presets.js'
import {exportLayoutSvg} from './plan-export.js'

async function sha256(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')}


export async function buildRenderBundle(node,images){
  if(node?.kind!=='render'||!node.layout)throw Error('仅支持已完成的渲染分支')
  if(!Array.isArray(images)||images.length!==8)throw Error('需完整的 8 张机位图，不能导出缺图包')
  const layout=strToU8(JSON.stringify(node.layout,null,2)),files={'layout.json':layout,'plan.svg':strToU8(exportLayoutSvg(node.layout))}
  const manifest={format:'store-render-pack-v1',nodeId:node.id,style:node.style,createdAt:new Date().toISOString(),layoutSha256:await sha256(layout),
    scope:'概念预览；SI 环境为示意，真实资产 SI 未确认；非施工图',views:[]}
  for(let i=0;i<8;i++){
    const {bytes,width,height}=pngBytes(images[i]),name=`views/${String(i+1).padStart(2,'0')}.png`
    files[name]=bytes
    manifest.views.push({file:name,width,height,sha256:await sha256(bytes),camera:cameraFor(node.layout.room,i)})
  }
  files['manifest.json']=strToU8(JSON.stringify(manifest,null,2))
  files['README.txt']=strToU8('门店方案八视角包\nviews/ 为当前分支的八张 PNG。manifest.json 记录固定机位、图片哈希和布局哈希；layout.json 保存米制布局；plan.svg 为 1:50 概念平面。\n图片来自网页三维预览，不是写实或施工合规验收；SI 风格仅为环境示意。原始 SU/GLB 不打包。\n')
  // PNG is already compressed; avoid recompressing large image arrays on the UI thread.
  return zipSync(files,{level:0})
}

export async function downloadRenderBundle(node,images){
  const bytes=await buildRenderBundle(node,images),url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}))
  const a=document.createElement('a');a.href=url;a.download='store-views.zip';a.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
