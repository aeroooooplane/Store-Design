import React,{useState} from 'react'
import evidence from './data/case-library.json'
import {EvidenceFile} from './EvidenceFile.jsx'

const roles={original_plan:'原始平面',design_plan:'设计平面',furniture_dimension_plan:'家具定位',furniture_plan:'家具定位',exterior_render:'外观效果',interior_render:'内景效果'}

export default function CaseLibrary(){
  const [si,setSi]=useState('all'),[purpose,setPurpose]=useState('layout')
  return <section className="case-library" aria-label="五店案例证据">
    <h2>五店参考案例 · 证据索引</h2>
    <p>不是完整几何，也不是已就绪训练集。当前按同一源 PDF 关联，最终版本、闭合边界、门柱与家具全局坐标仍待核实。</p>
    <p className="hint">SI 依据为未取消且非零的家具清单条目；黑色只可辅助判断门头、墙面和展柜主体，排除产品、屏幕、文字、阴影与反射。未见黑色不能反推 SI1。</p>
    <div className="case-filters"><label>案例 SI 筛选<select aria-label="案例 SI 筛选" value={si} onChange={e=>setSi(e.target.value)}><option value="all">全部 SI</option><option>SI1.0</option><option>SI2.0</option></select></label><label>案例用途<select aria-label="案例用途" value={purpose} onChange={e=>setPurpose(e.target.value)}><option value="layout">辅助平面布局</option><option value="render">白模材质与外观参考</option></select></label></div>
    <p className="hint">页码为源 PDF 的 1 基物理页码。下方路径相对项目根目录；本机开发/预览服务可按需读取清单内原件并校验哈希，静态网页不包含原始资料。不会上传文件。</p>
    {evidence.stores.filter(store=>si==='all'||store.si.label===si).map(store=><article className="case-card" key={store.id}>
      <h3>{store.name} <small>{store.id}</small></h3>
      <p>{store.si.label} · 家具清单证据：第 {store.si.pages.join('、')} 页</p>
      <p className="warning">{store.versionStatus}</p>
      <details><summary>源文件与追溯记录</summary><p><code>{store.sourcePdf}</code></p><p>PDF SHA256：<code>{store.sourceSha256}</code></p><p><code>{store.reviewPath}</code></p></details>
      <ul>{store.issues.map(issue=><li key={issue.id}>p{issue.pages?.join('/')}：{issue.impact}{issue.values_mm&&`（${issue.values_mm.join(' / ')} mm）`}</li>)}</ul>
      {purpose==='render'&&<p className="warning">没有已确认的同相机白模配对；只参考可见材质，不可改变核准几何。</p>}
      {(purpose==='layout'?store.layouts:store.renders).map(ref=><details className="case-reference" key={`${purpose}-${ref.page}`}>
        <summary>第 {ref.page} 页 · {roles[ref.role]||ref.role}{ref.focus&&` · ${ref.focus}`}</summary>
        <p><code>{ref.path}</code></p><p>资产 SHA256：<code>{ref.sha256}</code></p>
        <EvidenceFile storeId={store.id} purpose={purpose} reference={ref}/>
        {ref.geometryGuard&&<><p>结构保护：{ref.geometryGuard}</p><p>排除内容：{ref.exclude.join('；')}</p><p>材料上下文：p{ref.materialPages.join('/')}（不证明同修订版）</p><p>原图尺寸/材料箭头：{ref.nativeAnnotations===false?'已确认无此类箭头（不等于无广告文字）':'未知，不能当作无标注'}</p></>}
      </details>)}
    </article>)}
  </section>
}
