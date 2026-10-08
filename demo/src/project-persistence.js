import {saveProject} from './project-db.js'

export function createProjectPersistence(key,initialToken){
  let expected=initialToken
  // Keep the revision update in this instance's queue, before another queued save enters.
  let pending=Promise.resolve(),count=0
  return {
    get pending(){return count>0},
    save(project){
      const snapshot=structuredClone(project)
      count++
      const task=pending.then(async()=>{expected=await saveProject(key,expected,snapshot)}).finally(()=>{count--})
      pending=task.catch(()=>{})
      return task
    }
  }
}
