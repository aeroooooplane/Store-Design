import {parseProject} from './project-import.js'

export function createProjectPersistence(key,initialRaw){
  let expected=initialRaw
  return {
    async save(project){
      const raw=JSON.stringify(project)
      // Do not persist a project that the recovery boundary would reject.
      parseProject(raw,{allowEmpty:true})
      if(!navigator.locks)throw Error('当前浏览器不支持安全写入锁，请导出项目备份')
      await navigator.locks.request('store-design:'+key,()=>{
        if(localStorage.getItem(key)!==expected)throw Error('其他窗口已更新项目，本窗口停止覆盖；请先导出本窗口备份，再刷新并导入合并')
        if(raw!==expected)localStorage.setItem(key,raw)
        expected=raw
      })
    }
  }
}
