export async function readSaved(page){
  return page.evaluate(()=>new Promise((resolve,reject)=>{
    const open=indexedDB.open('store-design-projects')
    open.onerror=()=>reject(open.error)
    open.onsuccess=()=>{
      const db=open.result,request=db.transaction('projects').objectStore('projects').get('insta-studio-v2')
      request.onsuccess=()=>{resolve(request.result?JSON.parse(request.result.raw):null);db.close()}
      request.onerror=()=>{reject(request.error);db.close()}
    }
  }))
}

// Simulate an independent writer, intentionally bypassing this tab's Web Lock.
export async function replaceSaved(page,project){
  return page.evaluate(async project=>{
    const {openProjectDatabase,PROJECT_KEY}=await import('/src/project-db.js')
    const db=await openProjectDatabase()
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('projects','readwrite'),store=tx.objectStore('projects'),get=store.get(PROJECT_KEY)
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)
      get.onsuccess=()=>store.put({...get.result,key:PROJECT_KEY,schemaVersion:2,revision:(get.result?.revision??0)+1,raw:JSON.stringify(project)})
    })
  },project)
}
