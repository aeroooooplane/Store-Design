import React,{useEffect,useRef,useState} from 'react'
import {realAssets} from './real-assets.js'

export const firstRealAsset=realAssets[0]

function Preview(){
  const canvas=useRef(),viewer=useRef()
  const [status,setStatus]=useState('loading'),[error,setError]=useState(''),[white,setWhite]=useState(false)
  useEffect(()=>{
    let active=true,instance
    async function start(){
      try{
        const {createAssetViewer}=await import('./asset-viewer.js')
        if(!active)return
        instance=createAssetViewer(canvas.current,firstRealAsset);viewer.current=instance
        await instance.ready
        if(active)setStatus('ready')
      }catch(e){if(active){setError(e.message);setStatus('error')}}
    }
    start()
    return()=>{active=false;instance?.dispose();viewer.current=null}
  },[])
  function download(){
    try{const a=document.createElement('a');a.href=viewer.current.image();a.download=`${firstRealAsset.id}-${white?'white':'material'}.png`;a.click()}
    catch(e){setError(e.message)}
  }
  return <>
    {status==='loading'&&<p role="status">正在载入本地真实网格（约 32.5 MB），完成前不可导出…</p>}
    {error&&<p role="alert">{error}。请确认本机已运行 SU 转换脚本；不会用占位模型替代。</p>}
    <div className="model"><canvas ref={canvas} aria-label="真实 SU 道具三维预览"/></div>
    <div className="actions">
      <button type="button" disabled={status!=='ready'} onClick={()=>{viewer.current.setWhite(!white);setWhite(!white)}}>{white?'查看原材质':'查看白模'}</button>
      <button type="button" disabled={status!=='ready'} onClick={download}>下载道具预览 PNG</button>
    </div>
    {status==='ready'&&<p role="status">真实网格已载入 · 拖动旋转、滚轮缩放 · {white?'中性白模':'原导出材质'}</p>}
  </>
}

export function AssetPreview(){
  const [open,setOpen]=useState(false)
  return <section className="source-panel" aria-label="真实道具检查">
    <h3>真实 SU 道具 · 接入检查</h3>
    <p>体验桌 asset-408124 · 1.000 × 1.800 × 1.327 m；总高含桌面物件。SI 和正面方向待确认，材质尚待视觉验收。</p>
    <p>此处查看原模型转换结果；进入平面编辑后可手动加入四类真实道具，旧方案不会自动替换。</p>
    <button type="button" onClick={()=>setOpen(!open)}>{open?'关闭道具预览':'预览真实 SU 体验桌'}</button>
    {open&&<Preview/>}
  </section>
}
