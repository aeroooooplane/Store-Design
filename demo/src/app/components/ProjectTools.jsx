import React,{useState} from 'react'

export function ProjectTools({busy,onImport,onExport,onError,onPlace}){
  const [CasePanel,setCasePanel]=useState(null),[open,setOpen]=useState(false),[loading,setLoading]=useState(false)
  const [AssetPanel,setAssetPanel]=useState(null),[assetsOpen,setAssetsOpen]=useState(false),[assetsLoading,setAssetsLoading]=useState(false)
  async function toggleAssets(){
    if(assetsOpen){setAssetsOpen(false);return}
    setAssetsLoading(true)
    try{
      if(!AssetPanel){const loaded=await import('../../AssetLibrary.jsx');setAssetPanel(()=>loaded.default)}
      setAssetsOpen(true)
    }catch(e){onError('资产索引加载失败：'+e.message)}finally{setAssetsLoading(false)}
  }
  async function toggleCases(){
    if(open){setOpen(false);return}
    setLoading(true)
    try{
      if(!CasePanel){const loaded=await import('../../CaseLibrary.jsx');setCasePanel(()=>loaded.default)}
      setOpen(true)
    }catch(e){onError('案例索引加载失败：'+e.message)}finally{setLoading(false)}
  }
  return <section className="project-tools" aria-label="项目工具">
    <h2>项目工具</h2>
    <p className="hint">备份保留设计分支和当前草稿；案例证据仅供核对，不自动改变方案。</p>
    <details className="project-transfer">
      <summary>项目备份 · 导入 / 导出</summary>
      <button className="backup-export" onClick={onExport}>导出当前备份</button>
      <label>导入项目 JSON<input aria-label="导入项目 JSON" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)onImport(file)}}/></label>
      <small>最多 50 MB / 500 节点；合并为独立分支，不覆盖当前项目。模型文件不随 JSON 同步，效果图可单独保存在本机；跨设备请下载图片 ZIP。</small>
    </details>
    <div className="case-entry"><button disabled={loading} onClick={toggleCases}>{open?'关闭案例证据':'查看五店案例证据'}</button>{loading&&<small>正在加载证据索引…</small>}</div>
    {open&&CasePanel&&<CasePanel/>}
    <div className="case-entry"><button disabled={assetsLoading} onClick={toggleAssets}>{assetsOpen?'关闭资产目录':'查看90项资产目录'}</button>{assetsLoading&&<small>正在加载资产索引…</small>}</div>
    {assetsOpen&&AssetPanel&&<AssetPanel onPlace={onPlace}/>}
  </section>
}
