import React,{useState} from 'react'
import inventory from './data/asset-library.json'

export default function AssetLibrary(){
  const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[status,setStatus]=useState('all')
  const categories=[...new Set(inventory.assets.map(a=>a.category))]
  const key=query.trim().toLocaleLowerCase()
  const assets=inventory.assets.filter(a=>(category==='all'||a.category===category)&&(status==='all'||a.webReady===(status==='ready'))&&`${a.id} ${a.sourceName} ${a.category}`.toLocaleLowerCase().includes(key))
  return <section className="case-library asset-library" aria-label="SU资产目录">
    <h2>SU 资产目录 · 只读检索</h2>
    <p>{inventory.assets.length} 项资产 · {inventory.assets.filter(a=>a.webReady).length} 项已接入网页清单；文件仍需本机提供，其余不可放置。</p>
    <p className="hint">类别来自源拆分记录，未完成用途、材质及正面验收。源坐标紧面包围盒尺寸不代表安装高度或摆放方式；灯具、灯箱与标识不能直接按落地家具使用。本目录不会修改平面或 SI。</p>
    <div className="case-filters"><label>资产编号或名称<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>资产类别<select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">全部类别</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label>资产接入状态<select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">全部状态</option><option value="ready">已接入网页清单</option><option value="pending">未接入网页</option></select></label></div>
    <p>匹配 {assets.length} / {inventory.assets.length}</p>
    {!assets.length&&<p>没有匹配资产，请修改关键词或筛选条件。</p>}
    {assets.map(a=><article className="case-card" key={a.id}><h3>{a.category} · {a.sourceName}</h3><p><code>{a.id}</code> · {a.instanceCount} 个源实例</p><p>源包围盒 X/Y/Z：{[a.dimensions.w,a.dimensions.d,a.dimensions.h].map(n=>(n*1000).toFixed(1)).join(' × ')} mm</p><p>{a.siVersion?`来源 SI：${a.siVersion}`:'SI 未确认'} · 正面未确认</p><p>{a.webReady?'已接入网页清单；需本机 GLB，材质待验收':'未接入网页；仅完成源模型拆分，不可加入平面'}</p></article>)}
    <details><summary>索引来源与校验</summary><p>{inventory.sourceDirectory}</p>{Object.entries(inventory.sourceHashes).map(([name,hash])=><p key={name}>{name} SHA256：<code>{hash}</code></p>)}</details>
  </section>
}
