import React,{useEffect,useState} from 'react'
import {loadProject,isolateProject,PROJECT_KEY} from './project-db.js'
export {PROJECT_KEY}

// Never mount autosave until storage has opened, migrated and validated successfully.
export function ProjectRecovery({children}){
  const [state,setState]=useState(null),[failure,setFailure]=useState(''),[isolating,setIsolating]=useState(false)
  useEffect(()=>{let active=true;loadProject().then(result=>{if(active)setState(result)});return()=>{active=false}},[])
  if(!state)return <main><p role="status">正在读取并核对本机项目…</p></main>
  if(state.project)return children(state.project,state.token)
  function download(){
    const url=URL.createObjectURL(new Blob([state.raw],{type:'application/json'}))
    const link=document.createElement('a');link.href=url;link.download='store-project-recovery.json';link.click()
    setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  async function isolate(){
    setIsolating(true)
    try{setState(await isolateProject(state))}
    catch(error){setFailure('备份失败：'+error.message+'；原始数据仍保留。')}
    finally{setIsolating(false)}
  }
  return <main className="project-transfer"><h1>项目恢复保护</h1>
    <p role="alert">本机项目无法安全恢复，原始数据未覆盖。{state.error} {failure}</p>
    <p>请先下载原始数据以便修复。也可将异常数据完整保留在本浏览器的独立备份中，再开始新项目；清除浏览器数据会同时清除这些本地备份。</p>
    <div className="actions"><button disabled={state.raw===null||isolating} onClick={download}>下载原始数据</button>
    <button disabled={state.raw===null||isolating} onClick={isolate}>隔离备份后新建</button>
    <button disabled={isolating} onClick={()=>location.reload()}>重新尝试恢复</button></div>
  </main>
}
