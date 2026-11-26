import {
  RENDER_SIZE, NodeDisplayUpdateSchema, applyDisplayEdits, emptyDisplayEdits,
  entranceFrame, onPicture, planDisplay, projectToView,
} from '../../packages/shared/src/index.ts'
import type { Asset, Layout, Space, NodeCamera, RenderImage, DisplayRulesView, Market, SiStyle, DisplayEdits, DisplayTableInput } from '../../packages/shared/src/index.ts'

interface DisplayInput {
  nodeId: string
  layout: Layout
  space: Space
  market: Market
  siStyle: SiStyle
  rules: DisplayRulesView
  edits: DisplayEdits | null
  cameras: NodeCamera[]
  images: RenderImage[]
}

export function checkDisplayUpdate(data: unknown) {
  return NodeDisplayUpdateSchema.safeParse(data)
}

export function computeStageDisplay(input: DisplayInput, assets: Asset[]) {
  const { nodeId, layout, rules, space, market, siStyle, cameras, images } = input
  const edits = input.edits ?? emptyDisplayEdits(siStyle)
  const byId = new Map(assets.map(a => [a.id,a]))
  const heights = new Map(layout.items.map(item => [item.id,item.h]))
  const tablesInput = layout.items.flatMap((item): DisplayTableInput[] => {
    const asset = item.assetId ? byId.get(item.assetId) : undefined
    const side = asset?.function === 'side_cabinet' && /托盘/.test(asset.standardName + asset.variant + asset.name)
    const kind = item.function === 'island_table' ? 'island' : side ? 'side' : null
    return kind ? [{id:item.id,kind,cx:item.cx,cz:item.cz,w:item.w,d:item.d,assetId:item.assetId ?? null}] : []
  })
  const tables = applyDisplayEdits(planDisplay(rules.rules, {
    tables:tablesInput, entrance:entranceFrame(space), market, siStyle,
    moduleScheme:edits.moduleScheme, landscapeEnd:edits.landscapeEnd, orientation:edits.orientation,
  }),edits)
  const views = cameras.map(row => {
    const image = images.find(i=>i.cameraId === row.id && i.mode === 'material' && !i.stale)
    const aspect = image ? image.width/image.height : RENDER_SIZE.width/RENDER_SIZE.height
    const marks = Object.fromEntries(tables.flatMap(table=>{
      const projection = projectToView(row.camera,aspect,[table.plan.cx,heights.get(table.sourceId)??0.9,table.plan.cz])
      return onPicture(projection) ? [[table.label,projection] as const] : []
    }))
    return {cameraId:row.id,name:row.camera.name,imageUrl:image?.url??null,marks}
  })
  const overview = [...views].sort((a,b)=>Object.keys(b.marks).length-Object.keys(a.marks).length)[0]
  const tableViews = Object.fromEntries(tables.map(table=>{
    const candidates = views.flatMap(v=>{
      const p = v.marks[table.label]
      return p ? [{id:v.cameraId,score:p.depth*(1+2*Math.hypot(p.x-.5,p.y-.55))}] : []
    })
    return [table.label,candidates.sort((a,b)=>a.score-b.score)[0]?.id??null]
  }))
  return {nodeId,edits,tables,views,overviewCameraId:overview && Object.keys(overview.marks).length ? overview.cameraId : null,
    tableViews,ruleVersion:rules.version}
}

