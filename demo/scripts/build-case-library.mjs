// Rebuild a compact, read-only web index from existing reviewed evidence.
// Does not copy source PDFs/images or upgrade any eligibility flags.
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import path from 'node:path'

const root=fileURLToPath(new URL('../../',import.meta.url))
const source='资源库/90_处理过程与审核/门店案例/20260925-four-hour'
const hashes={}
async function read(name){
  const bytes=await readFile(path.join(root,source,name))
  hashes[name]=createHash('sha256').update(bytes).digest('hex')
  return bytes.toString('utf8').replace(/^\uFEFF/,'')
}
const lines=text=>text.trim().split(/\r?\n/).map(line=>JSON.parse(line))
const layouts=lines(await read('layout-references.jsonl'))
const renders=lines(await read('render-references.jsonl'))
const cards=JSON.parse(await read('render-reference-cards.json')).cards
const stores=[]
for(const id of [...new Set(layouts.map(row=>row.store_id))]){
  const plans=layouts.filter(row=>row.store_id===id),views=renders.filter(row=>row.store_id===id)
  const first=plans[0]
  if(plans.length!==3||!views.length)throw Error('Incomplete reference index: '+id)
  if([...plans,...views].some(row=>row.training_eligible!==false||row.source_sha256!==first.source_sha256))throw Error('Evidence contract mismatch: '+id)
  stores.push({
    id,name:path.basename(first.source_pdf,'.pdf'),sourcePdf:`资源库/01_各门店原图纸/${path.basename(first.source_pdf)}`,sourceSha256:first.source_sha256,
    reviewPath:`${source}/${id}/case.json`,si:first.si,versionStatus:'本地历史 PDF；最终版本及远程最新状态未确认',
    completeGeometry:false,sameCameraPair:false,trainingEligible:false,
    issues:first.source_conflicts,
    layouts:plans.map(row=>({page:row.page,role:row.role,path:row.split_pdf,sha256:row.split_pdf_sha256})),
    renders:views.map(row=>{
      const matched=cards.filter(card=>card.store_id===id&&card.source_page===row.source_page)
      if(matched.length!==1)throw Error('Ambiguous card join: '+id+'/'+row.source_page)
      const card=matched[0]
      return {page:row.source_page,role:row.view_role,path:row.native_image,sha256:row.native_sha256,
        focus:card.focus,exclude:card.exclude,geometryGuard:card.geometry_guard,materialPages:card.material_context_pages,
        nativeAnnotations:row.native_dimension_material_annotations}
    })
  })
}
const output={schemaVersion:1,sourceDirectory:source,sourceIndexHashes:hashes,stores}
const dest=path.join(root,'demo/src/data/case-library.json')
await mkdir(path.dirname(dest),{recursive:true})
await writeFile(dest,JSON.stringify(output,null,2)+'\n')
console.log(`Case reference index: ${stores.length} stores, ${layouts.length} plans, ${renders.length} views. No source assets copied.`)
