import React,{useState} from 'react'

export function ProjectTools({busy,onImport,onExport,onError}){
  const [CasePanel,setCasePanel]=useState(null),[open,setOpen]=useState(false),[loading,setLoading]=useState(false)
  async function toggleCases(){
    if(open){setOpen(false);return}
    setLoading(true)
    try{
      if(!CasePanel){const loaded=await import('./CaseLibrary.jsx');setCasePanel(()=>loaded.default)}
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
      <small>最多 5 MB / 500 节点；合并为独立分支，不覆盖当前项目。模型文件不随 JSON 同步，效果图刷新后需重新渲染。</small>
    </details>
    <div className="case-entry"><button disabled={loading} onClick={toggleCases}>{open?'关闭案例证据':'查看五店案例证据'}</button>{loading&&<small>正在加载证据索引…</small>}</div>
    {open&&CasePanel&&<CasePanel/>}
  </section>
}
