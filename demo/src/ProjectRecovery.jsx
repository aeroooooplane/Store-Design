import React,{useState} from 'react'
import {parseProject} from './project-import.js'

export const PROJECT_KEY='insta-studio-v2'
function restore(){
  let raw=null
  try{
    raw=localStorage.getItem(PROJECT_KEY)
    return {raw,project:raw===null?{nodes:[]}:parseProject(raw,{allowEmpty:true})}
  }catch(error){return {raw,error:error.message}}
}

// Mount the editor only after validation: its autosave must never see corrupt input.
export function ProjectRecovery({children}){
  const [state,setState]=useState(restore),[failure,setFailure]=useState('')
  if(state.project)return children(state.project,state.raw)
  function download(){
    const url=URL.createObjectURL(new Blob([state.raw],{type:'application/json'}))
    const link=document.createElement('a');link.href=url;link.download='store-project-recovery.json';link.click()
    setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  function isolate(){
    try{
      if(localStorage.getItem(PROJECT_KEY)!==state.raw)throw Error('其他窗口已更新项目，请刷新重试')
      const key=PROJECT_KEY+'-recovery-'+crypto.randomUUID()
      localStorage.setItem(key,state.raw)
      if(localStorage.getItem(key)!==state.raw)throw Error('备份校验失败')
      setState({raw:state.raw,project:{nodes:[]}})
    }catch(error){setFailure('备份失败：'+error.message+'；原始数据仍保留。')}
  }
  return <main className="project-transfer"><h1>项目恢复保护</h1>
    <p role="alert">本机项目无法安全恢复，原始数据未覆盖。{state.error} {failure}</p>
    <p>请先下载原始数据以便修复。也可将异常数据完整保留在本浏览器的独立备份中，再开始新项目；清除浏览器数据会同时清除这些本地备份。</p>
    <div className="actions"><button disabled={state.raw===null} onClick={download}>下载原始数据</button>
    <button disabled={state.raw===null} onClick={isolate}>隔离备份后新建</button>
    <button onClick={()=>location.reload()}>重新尝试恢复</button></div>
  </main>
}
