import {parseProject} from './project-import.js'
import {pngBytes} from './png-data.js'

export const PROJECT_KEY='insta-studio-v2'
export const DATABASE_NAME='store-design-projects'
export const DATABASE_VERSION=2
const conflict=()=>Error('其他窗口已更新项目，本窗口停止覆盖；请先导出本窗口备份，再刷新并导入合并')
const rawOf=record=>record?.raw ?? (record?.project ? JSON.stringify(record.project) : null)
const tokenOf=record=>record ? {revision:record.revision??0,raw:rawOf(record)} : null
const matches=(record,expected)=>!record ? expected===null : expected!==null && (record.revision??0)===expected.revision && rawOf(record)===expected.raw
let connection

export function openProjectDatabase(){
  if(!connection) connection=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE_NAME,DATABASE_VERSION)
    let failed=false
    request.onupgradeneeded=()=>{
      const db=request.result
      for(const name of ['projects','backups','renders']) if(!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:'key'})
    }
    request.onblocked=()=>{failed=true;reject(Error('数据库升级被其他窗口阻止，请关闭旧版窗口后重试'))}
    request.onerror=()=>{failed=true;reject(request.error)}
    request.onsuccess=()=>{
      const db=request.result
      if(failed){db.close();return}
      db.onversionchange=()=>{db.close();connection=null}
      resolve(db)
    }
  }).catch(error=>{connection=null;throw error})
  return connection
}

async function readRecord(store,key){
  const db=await openProjectDatabase()
  return new Promise((resolve,reject)=>{
    const request=db.transaction(store,'readonly').objectStore(store).get(key)
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error)
  })
}
export async function readProjectRaw(key=PROJECT_KEY){return rawOf(await readRecord('projects',key))}

// The comparison and write are in one readwrite transaction, including recovery backup.
async function commit(key,expected,raw,{backup,beforeWrite}={}){
  const db=await openProjectDatabase()
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(['projects','backups'],'readwrite')
    const projects=transaction.objectStore('projects'),request=projects.get(key)
    let result,error
    transaction.oncomplete=()=>resolve(tokenOf(result))
    transaction.onabort=()=>reject(error||transaction.error||Error('保存事务已取消'))
    transaction.onerror=()=>{} // onabort reports the final transaction failure.
    request.onsuccess=()=>{
      try{
        if(!matches(request.result,expected))throw conflict()
        beforeWrite?.()
        if(backup) transaction.objectStore('backups').put({key:crypto.randomUUID(),projectKey:key,createdAt:Date.now(),...backup})
        if(request.result?.raw===raw && request.result.schemaVersion===2){result=request.result;return}
        result={key,schemaVersion:2,revision:(request.result?.revision??0)+1,raw,updatedAt:Date.now()}
        projects.put(result)
      }catch(cause){error=cause;transaction.abort()}
    }
  })
}

export async function withProjectLock(key,task){
  if(!navigator.locks)throw Error('当前浏览器不支持安全写入锁，请导出项目备份')
  return navigator.locks.request('store-design:'+key,task)
}

export async function loadProject(key=PROJECT_KEY){
  let raw=null,record,source='database',token=null
  try{
    return await withProjectLock(key,async()=>{
      record=await readRecord('projects',key);token=tokenOf(record)
      source=record?'database':'legacy'
      raw=record?rawOf(record):localStorage.getItem(key)
      if(record && ![1,2].includes(record.schemaVersion))throw Error('不支持的数据库记录版本')
      if(record?.schemaVersion===2 && (!Number.isSafeInteger(record.revision)||record.revision<1))throw Error('数据库修订号损坏')
      if(record && typeof raw!=='string')throw Error('数据库项目记录损坏')
      const project=raw===null?{schemaVersion:2,nodes:[]}:parseProject(raw,{allowEmpty:true})
      const nextRaw=JSON.stringify(project)
      if(!record || record.schemaVersion!==2 || nextRaw!==raw){
        token=await commit(key,token,nextRaw,{
          backup:raw===null?null:{raw,record,source,reason:'schema-migration'},
          beforeWrite:source==='legacy'?()=>{if(localStorage.getItem(key)!==raw)throw conflict()}:null,
        })
      }
      return {project,token}
    })
  }catch(error){return {raw,record,source,token,error:error.message}}
}

export async function saveProject(key,expected,project){
  const raw=JSON.stringify(parseProject(JSON.stringify(project),{allowEmpty:true}))
  return withProjectLock(key,()=>commit(key,expected,raw))
}

export async function isolateProject(state,key=PROJECT_KEY){
  if(state.raw===null)throw Error('没有可备份的原始项目')
  return withProjectLock(key,async()=>{
    const project={schemaVersion:2,nodes:[]}
    const token=await commit(key,state.token,JSON.stringify(project),{
      backup:{raw:state.raw,record:state.record,source:state.source,reason:'recovery-isolation'},
      beforeWrite:state.source==='legacy'?()=>{if(localStorage.getItem(key)!==state.raw)throw conflict()}:null,
    })
    return {project,token}
  })
}

const renderSignature=node=>JSON.stringify({layout:node.layout,style:node.style})
export async function saveRenderImages(node,images){
  if(node?.kind!=='render'||!Array.isArray(images)||images.length!==8||images.some(src=>typeof src!=='string'||!src.startsWith('data:image/png;base64,')))throw Error('需要完整的八视角 PNG')
  for(const image of images)pngBytes(image)
  const db=await openProjectDatabase()
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('renders','readwrite')
    transaction.oncomplete=()=>resolve()
    transaction.onabort=()=>reject(transaction.error||Error('图片保存已取消'))
    transaction.objectStore('renders').put({key:PROJECT_KEY+':'+node.id,schemaVersion:1,signature:renderSignature(node),images,updatedAt:Date.now()})
  })
}
export async function loadRenderImages(node){
  const record=await readRecord('renders',PROJECT_KEY+':'+node.id)
  if(record?.schemaVersion!==1||record.signature!==renderSignature(node)||!Array.isArray(record.images)||record.images.length!==8||record.images.some(src=>typeof src!=='string'||!src.startsWith('data:image/png;base64,')))return null
  try{for(const image of record.images)pngBytes(image)}catch{return null}
  return record.images
}
