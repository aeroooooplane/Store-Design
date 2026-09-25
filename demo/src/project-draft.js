// A working draft is separate from immutable history nodes.
export function captureProject(project,active,draft,stage){
  const {editorDraft:previous,...snapshot}=project
  const parent=project.nodes.find(n=>n.id===active)
  if(stage==='editor'&&draft&&parent&&JSON.stringify(draft)!==JSON.stringify(parent.layout)){
    snapshot.editorDraft={parent:active,layout:structuredClone(draft)}
  }
  return snapshot
}
