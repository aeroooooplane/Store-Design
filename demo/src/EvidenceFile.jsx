import React,{useEffect,useRef,useState} from 'react'

export function EvidenceFile({storeId,purpose,reference}){
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false)
  const request=useRef()
  useEffect(()=>()=>request.current?.abort(),[])
  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url)},[url])
  async function load(){
    setLoading(true);setError('')
    const controller=new AbortController();request.current=controller
    try{
      const response=await fetch(`/__local-evidence/${storeId}/${purpose}/${reference.page}`,{signal:controller.signal})
      if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.error||'本机证据服务不可用')}
      const expected=purpose==='layout'?'application/pdf':'image/'
      if(!response.headers.get('content-type')?.startsWith(expected))throw Error('本机证据服务不可用；静态网页不含原始资料')
      const bytes=await response.arrayBuffer()
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('')
      if(hash!==reference.sha256)throw Error('文件哈希与证据索引不一致')
      if(!controller.signal.aborted)setUrl(URL.createObjectURL(new Blob([bytes],{type:response.headers.get('content-type')})))
    }catch(e){if(!controller.signal.aborted)setError(e.message)}finally{if(!controller.signal.aborted)setLoading(false)}
  }
  return <div className="evidence-file">
    {!url&&<button disabled={loading} onClick={load}>{loading?'正在校验本机文件…':'载入本机证据'}</button>}
    {error&&<p role="alert">{error}</p>}
    {url&&<><a href={url} target="_blank" rel="noreferrer">打开已校验文件</a>{purpose==='render'&&<img src={url} alt={`原始效果参考：${storeId} 第 ${reference.page} 页`}/>}<p className="hint">字节哈希已核对；不代表版本、几何或所有标注已验收。</p></>}
  </div>
}
