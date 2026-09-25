import React,{useState,useEffect,useRef} from 'react'
import {createRoot} from 'react-dom/client'
import {ReactFlow,Background,Controls} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {catalog,dimensions,generatePlans,issues} from './layout'
import './styles.css'
import {profiles,profileFor} from './furniture'
import {realSample} from './sample'
import {AssetPreview} from './AssetPreview'
import {realAssets} from './real-assets.js'
import {createAssetItem,rotateItem} from './asset-contract.js'
import {downloadPlan} from './plan-export.js'
import {parseProject,mergeProject,MAX_IMPORT_BYTES} from './project-import.js'
const clone=v=>structuredClone(v), uid=()=>crypto.randomUUID(), KEY='insta-studio-v2'
import {ProjectRecovery} from './ProjectRecovery.jsx'
import {captureProject} from './project-draft.js'
import {ProjectTools} from './ProjectTools.jsx'
import {createProjectPersistence} from './project-persistence.js'
function Plan({layout,onChange,selected,onSelect}){
 const svg=useRef(),drag=useRef();const {room,items}=layout
 const point=e=>new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.current.getScreenCTM().inverse())
 return <svg ref={svg} className="plan" viewBox={`-.35 -.4 ${room.w+.7} ${room.d+.8}`} onPointerMove={e=>{if(!drag.current)return;const p=point(e);onChange(items.map(i=>i.id===drag.current.id?{...i,x:Math.max(0,Math.min(room.w-i.w,Math.round((p.x-drag.current.x)*20)/20)),z:Math.max(0,Math.min(room.d-i.d,Math.round((p.y-drag.current.z)*20)/20))}:i))}} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null}>
 <rect width={room.w} height={room.d} fill="#e8e8e2" stroke="#707974" strokeWidth=".06" strokeDasharray={room.shopType==='中岛店'?'.12 .1':undefined}/>
 {Array.from({length:Math.ceil(room.w*2)},(_,i)=><path key={'x'+i} d={`M ${i/2} 0 V ${room.d}`} stroke="#cfd3cc" strokeWidth=".008"/>)}
 {Array.from({length:Math.ceil(room.d*2)},(_,i)=><path key={'z'+i} d={`M 0 ${i/2} H ${room.w}`} stroke="#cfd3cc" strokeWidth=".008"/>)}
 <text x={room.w/2} y="-.15" textAnchor="middle" fontSize=".17" fill="#acb7b0">{room.w.toFixed(2)} m</text><text x={room.w/2} y={room.d+.26} textAnchor="middle" fontSize=".17" fill="#acb7b0">{room.shopType==='中岛店'?'四周开放':'入口'} · {room.d.toFixed(2)} m 深</text>
 {items.map(i=><g key={i.id} onPointerDown={e=>{if(!onChange)return;e.stopPropagation();onSelect(i.id);const p=point(e);drag.current={id:i.id,x:p.x-i.x,z:p.y-i.z};svg.current.setPointerCapture(e.pointerId)}} style={{cursor:onChange?'grab':'inherit'}}><rect x={i.x} y={i.z} width={i.w} height={i.d} rx=".03" fill={i.type==='table'?'#a8b5a4':i.type==='counter'?'#869293':'#c7b58f'} stroke={selected===i.id?'#db9d32':'#fff'} strokeWidth={selected===i.id?'.06':'.02'}/><text x={i.x+i.w/2} y={i.z+i.d/2+.05} fontSize=".14" textAnchor="middle" fill="#26312c" pointerEvents="none">{i.name}</text></g>)}
 </svg>
}
function Model({layout,onReady}) {
 const canvas=useRef(),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 useEffect(()=>{
  let scene,active=true
  setError('');setLoading(true);onReady(false)
  async function start(){
   try{
    const {createScene}=await import('./scene.js')
    if(!active)return
    scene=createScene(canvas.current,layout,'white',true)
    await scene.ready
    if(active){setLoading(false);onReady(true)}
   }catch(e){if(active){setError('无法启动三维：'+e.message);setLoading(false)}}
  }
  start()
  return()=>{active=false;scene?.dispose()}
 },[layout,onReady])
 return <div className="model">{error&&<p role="alert">{error}</p>}{loading&&<p role="status">正在载入场景，完成前不可渲染…</p>}<canvas ref={canvas}/><small>拖动旋转 · 滚轮缩放 · 剖切展示</small></div>
}
function App({initialProject,initialRaw}){
 const [persistence]=useState(()=>createProjectPersistence(KEY,initialRaw)),[saveError,setSaveError]=useState('')
 const [modelReady,setModelReady]=useState(false)
 const [historyOpen,setHistoryOpen]=useState(false)
 const [project,setProject]=useState(()=>{const {editorDraft,...saved}=initialProject;return saved}),[active,setActive]=useState(initialProject.editorDraft?.parent||null),[stage,setStage]=useState(initialProject.editorDraft?'editor':project.nodes.length?'gallery':'setup')
 const [mode,setMode]=useState('dimensions'),[width,setWidth]=useState(8),[depth,setDepth]=useState(6),[area,setArea]=useState(48),[ratio,setRatio]=useState(1),[height,setHeight]=useState(3.2)
 const [learned,setLearned]=useState(false),[shopType,setShopType]=useState('边厅店')
 const [draft,setDraft]=useState(initialProject.editorDraft?.layout||null),[selected,setSelected]=useState(null),[style,setStyle]=useState('SI1.0'),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[lightbox,setLightbox]=useState(null),[images,setImages]=useState({})
 useEffect(()=>{persistence.save(captureProject(project,active,draft,stage)).then(()=>setSaveError('')).catch(e=>setSaveError('自动保存失败：'+e.message+'。当前内容仍可导出，请勿直接关闭。'))},[project,active,draft,stage,persistence])
 useEffect(()=>{if(!saveError)return;const warn=e=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[saveError])
 const node=project.nodes.find(n=>n.id===active),layout=draft||node?.layout,warnings=layout?issues(layout):[]
 const slots=500-project.nodes.length,dirty=stage==='editor'&&draft&&node&&JSON.stringify(draft)!==JSON.stringify(node.layout)
 const importContext=useRef();importContext.current={project,draft,stage,node,active}
 async function importBackup(file){
  setBusy(true)
  try{
   if(file.size>MAX_IMPORT_BYTES)throw Error('项目文件大小不能超过 5 MB')
   const incoming=parseProject(await file.text()),current=importContext.current
   let base=current.project
   if(current.stage==='editor'&&current.draft&&current.node&&JSON.stringify(current.draft)!==JSON.stringify(current.node.layout))base={...base,nodes:[...base.nodes,{id:uid(),parent:current.active,kind:'edit',name:'导入前保留的调整',layout:clone(current.draft)}]}
   const merged=mergeProject(base,incoming)
   // setItem is atomic: quota failure leaves the previous saved project intact.
   await persistence.save(merged)
   setProject(merged);setActive(merged.nodes.filter(n=>n.kind==='root').at(-1)?.id);setDraft(null);setSelected(null);setStage('gallery')
   setNotice(`已导入 ${incoming.nodes.length} 个节点，作为独立分支保留；原项目未覆盖。真实模型需本机 GLB，效果图可重新渲染。`)
  }catch(e){setNotice('导入失败，当前项目保持不变：'+e.message)}finally{setBusy(false)}
 }
 function exportBackup(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(captureProject(project,active,draft,stage),null,2)],{type:'application/json'}));a.download='store-project.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
 function append(nodes){setProject(p=>({...p,nodes:[...p.nodes,...nodes]}))}
 function loadSample(){if(slots<2)return;const root={id:uid(),kind:"root",name:"真实样本 · 上海星光",room:clone(realSample.room)};const n={id:uid(),parent:root.id,kind:"plan",name:realSample.name,layout:clone(realSample)};append([root,n]);open(n)}
 function generate(e){e.preventDefault();if(slots<5)return;try{const room={...dimensions(mode,width,depth,area,ratio,height),shopType};const root={id:uid(),kind:'root',name:`${shopType} ${room.w.toFixed(1)} × ${room.d.toFixed(1)} m`,room};append([root,...generatePlans(room,{learned}).map(p=>({id:uid(),parent:root.id,kind:'plan',name:p.name,layout:p}))]);setActive(root.id);setDraft(null);setStage('gallery');setNotice(learned?'四套方案已生成：实验模型建议体验桌数量，位置由规则安排；超出训练面积时回退。':'四套规则示例已生成，请选择一个方案细化。')}catch(e){setNotice(e.message)}}
 function open(n,preserve=true){if(busy)return;if(preserve&&dirty&&slots<1){setNotice('节点已满，请先导出当前备份，再整理项目；未丢弃当前草稿。');return;}setHistoryOpen(false);if(preserve&&stage==='editor'&&draft&&node&&JSON.stringify(draft)!==JSON.stringify(node.layout))append([{id:uid(),parent:active,kind:'edit',name:'自动保存的调整',layout:clone(draft)}]);setActive(n.id);setSelected(null);setDraft(n.layout?clone(n.layout):null);setStage(n.kind==='root'?'gallery':['plan','edit'].includes(n.kind)?'editor':n.kind==='white'?'white':'render');setNotice('');setStyle(n.style||'SI1.0')}
 function save(){if(slots<1)return;const n={id:uid(),parent:active,kind:'edit',name:'平面快照 '+new Date().toLocaleTimeString(),layout:clone(layout)};append([n]);open(n,false);setNotice('快照已保存，可从历史节点创建独立分支。')}
 function white(){if(warnings.length||slots<2)return;const snapshot={id:uid(),parent:active,kind:'edit',name:'已确认平面',layout:clone(layout)},n={id:uid(),parent:snapshot.id,kind:'white',name:'三维白膜',layout:clone(layout)};append([snapshot,n]);open(n,false)}
 async function render(){if(node.kind!=='render'&&slots<(style==='both'?2:1))return;setBusy(true);const styles=style==='both'?['SI1.0','SI2.0']:[style];let last
 try{const {createScene}=await import('./scene.js');for(const s of styles){const n=node.kind==='render'?node:{id:uid(),parent:active,kind:'render',name:`${s} · 8 视角`,style:s,layout:clone(layout)};let scene;const results=[];try{scene=createScene(document.createElement('canvas'),n.layout,s);await scene.ready;for(let i=0;i<8;i++){scene.view(i);results.push(scene.image());setNotice(`${s}：${i+1}/8`);await new Promise(r=>setTimeout(r,40))}}finally{scene?.dispose()}setImages(prev=>({...prev,[n.id]:results}));if(node.kind!=='render')append([n]);last=n}if(last){setActive(last.id);setDraft(clone(last.layout));setStyle(last.style);setStage('render')}setNotice('八视角预览已生成，可点击放大并下载。')}catch(e){setNotice('渲染失败，可重试：'+e.message)}finally{setBusy(false)}}
 const change=items=>setDraft({...layout,items}),selectedItem=layout?.items.find(i=>i.id===selected)
 let root=node;while(root?.parent)root=project.nodes.find(n=>n.id===root.parent);const rootId=root?.id||project.nodes.filter(n=>n.kind==='root').at(-1)?.id,candidates=project.nodes.filter(n=>n.kind==='plan'&&n.parent===rootId)
 const levels={},counts={},flowNodes=project.nodes.map(n=>{const level=n.parent?(levels[n.parent]||0)+1:0;levels[n.id]=level;const row=counts[level]||0;counts[level]=row+1;return {id:n.id,position:{x:level*185,y:row*90},data:{label:n.name},style:{borderColor:active===n.id?'#d5ef76':'#46504c'}}})
 return <><header><div><b className="brand">Insta360 <span>SPACE STUDIO</span></b><p>门店空间设计工作台</p></div><span className="badge">DEMO / 规则布局 · 概念渲染</span><button disabled={busy||(dirty&&slots<1)} onClick={()=>{const saved=captureProject(project,active,draft,stage);if(saved.editorDraft)append([{id:uid(),parent:active,kind:'edit',name:'新建前保留的调整',layout:clone(draft)}]);setDraft(null);setSelected(null);setStage('setup');setNotice('')}}>＋ 新建尺寸方案</button></header><div className="steps">{['01 空间输入','02 四方案比较','03 平面细化','04 白膜确认','05 风格渲染'].map((s,i)=><span key={s} className={['setup','gallery','editor','white','render'][i]===stage?'current':''}>{s}</span>)}</div>
 <button className="history-toggle" aria-expanded={historyOpen} aria-controls="project-history" onClick={()=>setHistoryOpen(v=>!v)}>历史与备份</button><div className="workspace"><aside id="project-history" className={historyOpen?'history-open':''}><h3>设计分支 <small>{project.nodes.length}</small></h3><p>点击历史节点继续设计</p><div className="tree"><ReactFlow key={project.nodes.length} nodes={flowNodes} edges={project.nodes.filter(n=>n.parent).map(n=>({id:n.id,source:n.parent,target:n.id}))} nodesDraggable={false} nodesConnectable={false} deleteKeyCode={null} fitView minZoom={.1} onNodeClick={(_,n)=>open(project.nodes.find(x=>x.id===n.id))}><Background/><Controls showInteractive={false}/></ReactFlow></div><nav className="branch-list">{project.nodes.map(n=><button key={n.id} disabled={busy} className={active===n.id?"active":""} onClick={()=>open(n)}>{n.kind==="root"?"▣ ":"↳ "}{n.name}</button>)}</nav><button onClick={exportBackup}>导出项目快照</button><small>方案与当前草稿自动保存；图片刷新后可重新渲染。</small></aside>
 <main><div className="heading"><div><div className="eyebrow">DESIGN YOUR NEXT SPACE</div><h1>{({setup:'从空间开始',gallery:'四种布局，一起比较',editor:node?.name,white:'检查你的三维白膜',render:node?.name})[stage]}</h1></div>{stage==='editor'&&<button disabled={slots<1} onClick={()=>{save();setStage('gallery')}}>保存并返回四方案</button>}</div>
 {slots<5&&<p className="warning">剩余 {slots} 个节点（上限 500）。四方案生成需 5 个，白模确认需 2 个，快照需 1 个；请先导出备份并分项目管理。</p>}
 {stage==='setup'&&<form onSubmit={generate} className="setup"><p>输入真实尺寸，生成四套不同布局。仅有面积时，按所选长宽比推算矩形空间。</p><div className="tabs"><button type="button" className={mode==='dimensions'?'active':''} onClick={()=>setMode('dimensions')}>输入长宽</button><button type="button" className={mode==='area'?'active':''} onClick={()=>setMode('area')}>输入面积</button></div><div className="fields">{mode==='dimensions'?<><label>宽度 / m<input aria-label="宽度" type="number" min="4" max="30" step=".01" required value={width} onChange={e=>setWidth(e.target.value)}/></label><label>进深 / m<input aria-label="进深" type="number" min="4" max="30" step=".01" required value={depth} onChange={e=>setDepth(e.target.value)}/></label></>:<><label>面积 / ㎡<input aria-label="面积" type="number" min="16" max="900" step=".01" required value={area} onChange={e=>setArea(e.target.value)}/></label><label>宽 : 深<select value={ratio} onChange={e=>setRatio(e.target.value)}><option value="1">1 : 1（默认正方形）</option><option value="1.3333333333">4 : 3</option><option value="1.5">3 : 2</option><option value="2">2 : 1</option></select></label></>}<label>门店铺型<select aria-label="门店铺型" value={shopType} onChange={e=>setShopType(e.target.value)}><option value="边厅店">边厅店</option><option value="中岛店">中岛店</option></select></label><label>层高 / m<input aria-label="层高" type="number" min="2.4" max="6" step=".1" required value={height} onChange={e=>setHeight(e.target.value)}/></label></div><label className="model-toggle"><input type="checkbox" checked={learned} onChange={e=>setLearned(e.target.checked)}/>实验：参考已训练的体验桌数量模型</label><p className="hint">11家门店的小样本实验，仅预测数量；位置仍由规则生成。适用面积12–141.5㎡，超出时回退。</p><p className="hint">首版：矩形门店；边厅按正面入口、中岛按四周开放演示。道具为参数化示例，白模确认后可对比参考环境；SI 结论需另查证据。</p><button className="primary" disabled={slots<5}>生成四个平面方案 →</button><button type="button" className="sample-button" disabled={slots<2} onClick={loadSample}>打开真实图纸样本 · 上海星光摄影城</button></form>}
 {stage==='gallery'&&<><p className="hint">点击任一方案放大细化。布局按输入尺寸计算；实验模型仅建议体验桌数量，不代表品牌布局规范。</p><div className="gallery">{candidates.map(n=><button className="plan-card" key={n.id} onClick={()=>open(n)}><Plan layout={n.layout}/><div><strong>{n.name}</strong><span>{n.layout.room.shopType} · {(n.layout.room.w*n.layout.room.d).toFixed(1)} ㎡ · 点击细化 ↗</span></div></button>)}</div></>}
 {stage==='editor'&&layout&&<>{layout.modelAdvice&&<p className="hint">实验模型 · {layout.modelAdvice.trainingStores} 家训练门店 · 当前摆放 {layout.modelAdvice.placed} 张体验桌 · {layout.modelAdvice.status==='outside-training-range'?'超出训练面积，已回退规则':'位置由规则生成，非模型预测'}</p>}{layout.source&&<details className="source-panel" open><summary>图纸来源与待核对项</summary><p>{layout.source.file} · 第 {layout.source.page} 页 · {layout.source.drawing} · {layout.source.date}</p><p>{layout.source.notes}</p><p>来源风格记录：{layout.source.style}；当前几何为参数化草案，非已核实 SKP。</p><div className="source-images"><a href="/references/s03/plan.png" target="_blank" rel="noreferrer"><img src="/references/s03/plan.png" alt="原始家具定位图，点击放大"/></a><img src="/references/s03/effect.png" alt="原PDF效果图参考"/></div></details>}<div className="edit-grid"><div className="drawing"><Plan layout={layout} onChange={change} selected={selected} onSelect={setSelected}/></div><section className="properties"><p className="hint">道具 {layout.items.length} / 200；超限前请导出并分项目管理。</p><h3>参数化示意道具</h3>{Object.entries(catalog).map(([type,item])=><button key={type} disabled={layout.items.length>=200} onClick={()=>{const i={id:uid(),type,...item,x:(layout.room.w-item.w)/2,z:(layout.room.d-item.d)/2};change([...layout.items,i]);setSelected(i.id)}}>＋ {item.name}</button>)}<hr/><h3>真实 SU 道具</h3><small>原尺寸 · SI/正面待核；需本地 GLB</small>{realAssets.map(asset=><button key={asset.id} disabled={layout.items.length>=200} onClick={()=>{const i=createAssetItem(asset,uid(),(layout.room.w-asset.dimensions.w)/2,(layout.room.d-asset.dimensions.d)/2);change([...layout.items,i]);setSelected(i.id)}}>＋ {asset.name}</button>)}<hr/>{selectedItem?<><h3>{selectedItem.name}</h3><p>{selectedItem.w} × {selectedItem.d} × {selectedItem.h} m</p>{selectedItem.assetId&&<p>资产：{selectedItem.assetId} · 朝向 {selectedItem.rotation||0}° · SI 未确认</p>}{!selectedItem.assetId&&selectedItem.type!=='structure'&&<label>道具结构<select aria-label="道具结构" value={profileFor(selectedItem)} onChange={e=>change(layout.items.map(i=>i.id===selected?{...i,profile:e.target.value}:i))}>{Object.entries(profiles).filter(([key])=>key!=='solid').map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><small>参数化示意；构造与厚度待实物核对。</small></label>}{['x','z'].map(axis=><label key={axis}>{axis==='x'?'横向':'纵向'}位置 / m<input type="number" step=".05" min="0" max={(axis==='x'?layout.room.w-selectedItem.w:layout.room.d-selectedItem.d).toFixed(2)} value={selectedItem[axis]} onChange={e=>{if(Number.isFinite(e.target.valueAsNumber))change(layout.items.map(i=>i.id===selected?{...i,[axis]:e.target.valueAsNumber}:i))}}/></label>)}<button onClick={()=>change(layout.items.map(i=>i.id===selected?rotateItem(i):i))}>旋转 90°</button><button onClick={()=>{change(layout.items.filter(i=>i.id!==selected));setSelected(null)}}>删除</button></>:<p>点击道具选中；拖动位置，或输入精确坐标。</p>}<p className={warnings.length?'warning':'hint'}>{warnings.length?warnings.join('；'):'未发现道具重叠或越界（不含通道及消防校验）'}</p></section></div><div className="actions"><button disabled={slots<1} onClick={save}>保存平面快照</button><button className="primary" onClick={white} disabled={warnings.length>0||slots<2}>确认平面并生成白膜 →</button></div></>}
 {stage==='white'&&layout&&<><Model layout={layout} onReady={setModelReady}/><div className="render-options"><div><h3>选择参考环境</h3><p>仅改变示意环境配色，不据此判定本方案 SI；几何复用白模。</p></div><select aria-label="渲染风格" value={style} onChange={e=>setStyle(e.target.value)} disabled={busy}><option value="SI1.0">SI1.0 参考环境（未验收）</option><option value="SI2.0">SI2.0 参考环境（未验收）</option><option value="both">对比两种参考环境</option></select><button className="primary" disabled={busy||!modelReady||slots<(style==='both'?2:1)} onClick={render}>{busy?'渲染中…':'确认白膜，渲染八视角 →'}</button></div><p className="hint">绑定资产编号的道具使用真实 SU 转换网格，其他道具仍为参数化示意。SI 仅调整示意环境，真实资产保留原材质；不代表 SI 验收或写实渲染。</p></>}
 {stage==='render'&&layout&&<><p className="hint">{node.style} · 实时光照预览 · 8 个固定相对机位，点击查看大图。</p>{images[active]?<div className="renders">{images[active].map((src,i)=><button key={i} onClick={()=>setLightbox({src,i})}><img src={src} alt={`视角 ${i+1}`}/><span>{['正面鸟瞰','左前方','右前方','右后方','左后方','背面鸟瞰','顶部俯视','入口方向'][i]}</span></button>)}</div>:<div className="empty"><p>布局已保存，点击重新渲染恢复八视角图片。</p><button className="primary" disabled={busy} onClick={render}>重新渲染</button></div>}</>}
 {stage==='render'&&images[active]&&<button disabled={busy} onClick={async()=>{setBusy(true);try{const {downloadRenderBundle}=await import('./render-export.js');await downloadRenderBundle(node,images[active]);setNotice('八视角、布局、平面 SVG 和机位清单已打包。')}catch(e){setNotice('打包失败：'+e.message)}finally{setBusy(false)}}}>下载八视角完整包 ZIP</button>}
 {stage==='editor'&&layout&&<button onClick={()=>{try{downloadPlan(layout);setNotice('平面 SVG 已导出，含尺寸与资产编号；非施工图。')}catch(e){setNotice(e.message)}}}>导出平面 SVG</button>}
 <ProjectTools busy={busy} onImport={importBackup} onExport={exportBackup} onError={setNotice}/>
 {stage==='setup'&&<AssetPreview/>}
 {saveError&&<div className="notice warning" role="alert">{saveError}</div>}
 {notice&&<div className="notice" role="status">{notice}</div>}</main></div>
 {lightbox&&<div className="lightbox" onClick={()=>setLightbox(null)}><div onClick={e=>e.stopPropagation()}><img src={lightbox.src} alt="效果预览大图"/><div className="actions"><a download={`store-view-${lightbox.i+1}.png`} href={lightbox.src}>下载 PNG</a><button onClick={()=>setLightbox(null)}>关闭</button></div></div></div>}</>
}
createRoot(document.getElementById('root')).render(<ProjectRecovery>{(project,raw)=><App initialProject={project} initialRaw={raw}/>}</ProjectRecovery>)
