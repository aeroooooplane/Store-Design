import { detectVectorTables } from '../../apps/api/src/modules/displays/detect-vector.ts'
import {
  AssetListSchema,
  CameraCreateSchema,
  CameraUpdateSchema,
  SpaceSchema,
  defaultCameras,
  DisplayTaskCreateSchema,
  DisplayDetectRequestSchema,
  DisplayTaskUpdateSchema,
  DisplayTaskStateSchema,
  emptyDisplayEdits,
  deliveryFileNames,
  deliveryFolderName,
  polygonArea,
  safeFileName,
  storeTitle,
  DraftPutSchema,
  LayoutGenerateSchema,
  LayoutValidateSchema,
  NodeCreateSchema,
  NodeRenameSchema,
  NodeSpaceUpdateSchema,
  LayoutSchema,
  layoutSi,
  followSpaceWalls,
  checkAssetFit,
  generateRequired,
  normalizeSpace,
  planLayout,
  validateLayout,
  validateSpace,
} from '../../packages/shared/src/index.ts'
import type { Asset, Layout, Space } from '../../packages/shared/src/index.ts'
import { plannerCatalog } from '../../apps/api/src/modules/layouts/selection.ts'
import { checkDisplayUpdate, computeStageDisplay } from './stage-display.ts'

function failure(message: string, details: unknown, status = 400) {
  return { error: { status, message, details } }
}

function spaceCheck(space: Space) {
  const issues = validateSpace(space)
  const errors = issues.filter((issue) => issue.severity === 'error')
  return errors.length
    ? failure('空间不合法', errors)
    : { space: normalizeSpace(space), issues }
}

function layoutCheck(space: Space, layout: Layout, items: Asset[]) {
  const catalog = new Map(items.map((asset) => [asset.id, asset]))
  const fit = checkAssetFit(layout, catalog)
  return { fit, issues: validateLayout(space, layout, catalog) }
}

// Boundary between the Python process and these fixed, bundled domain rules.
globalThis.performance ??= { now: () => Date.now() } as Performance
Object.assign(globalThis, {
  workbenchRules(command: string, input: string, source: string) {
    const respond = (value: unknown) => JSON.stringify(value)
    const data: unknown = JSON.parse(input)
    if (command === 'delivery-names') {
      const { name, shopType, space, date, revision } = data as {
        name: string; shopType: Parameters<typeof deliveryFolderName>[1]; space: Space; date: string; revision: number
      }
      return respond({ ...deliveryFileNames(name), folder: deliveryFolderName(name, shopType, polygonArea(space.boundary), date, revision) })
    }
    if (command === 'safe-file') {
      return respond({ name: safeFileName(String(data)) })
    }
    if (command === 'display-task-export-name') {
      return respond({ name: safeFileName(storeTitle(String(data))) })
    }
    if (command === 'display-task-create') {
      const parsed = DisplayTaskCreateSchema.safeParse(data)
      if (!parsed.success) return respond(failure('请求参数或内容无效', parsed.error.issues))
      return respond({ ...parsed.data, state: DisplayTaskStateSchema.parse({ edits: emptyDisplayEdits(parsed.data.siStyle) }) })
    }
    if (command === 'display-task-detect') {
      const { request, task } = data as { request: unknown; task: { plan: {width:number;height:number}; siStyle:'SI1.0'|'SI2.0'; render: unknown } }
      const parsed = DisplayDetectRequestSchema.safeParse(request)
      if (!parsed.success) return respond(failure('请求参数或内容无效', parsed.error.issues))
      if (!parsed.data.vector) return respond(failure('请重新选择含文字和线条的 PDF 平面图页', []))
      return respond(detectVectorTables(parsed.data.vector, task.plan, AssetListSchema.parse(JSON.parse(source)).items, task.siStyle, !!task.render))
    }
    if (command === 'display-task-update') {
      const parsed = DisplayTaskUpdateSchema.safeParse(data)
      return respond(parsed.success ? parsed.data : failure('请求参数或内容无效', parsed.error.issues))
    }
    if (command === 'stage-display') {
      return respond(computeStageDisplay(data as Parameters<typeof computeStageDisplay>[0],
        AssetListSchema.parse(JSON.parse(source)).items))
    }
    if (command === 'display-update') {
      const parsed = checkDisplayUpdate(data)
      return respond(parsed.success ? parsed.data : failure('请求参数或内容无效', parsed.error.issues))
    }
    if (command === 'default-cameras') {
      return respond({ cameras: defaultCameras(SpaceSchema.parse(data)) })
    }
    if (command === 'camera-create' || command === 'camera-update') {
      const parsed = (command === 'camera-create' ? CameraCreateSchema : CameraUpdateSchema).safeParse(data)
      return respond(parsed.success ? parsed.data : failure('请求参数或内容无效', parsed.error.issues))
    }
    if (command === 'rename') {
      const parsed = NodeRenameSchema.safeParse(data)
      return respond(parsed.success ? parsed.data : failure('请求参数或内容无效', parsed.error.issues))
    }
    if (command === 'node-space') {
      const input = data as { update: unknown; stored: unknown }
      const parsed = NodeSpaceUpdateSchema.safeParse(input.update)
      if (!parsed.success) return respond(failure('请求参数或内容无效', parsed.error.issues))
      const checked = spaceCheck(parsed.data.space)
      return respond('error' in checked ? checked : {
        ...checked,
        previous: SpaceSchema.parse(input.stored),
        expected: parsed.data.previousSpace,
      })
    }
    if (command === 'layout-si') {
      return respond({ siStyle: layoutSi(LayoutSchema.parse(data)) })
    }
    if (command === 'space-layout') {
      const { layout, before, after } = data as { layout: unknown; before: unknown; after: unknown }
      return respond({ layout: followSpaceWalls(LayoutSchema.parse(layout), SpaceSchema.parse(before), SpaceSchema.parse(after)) })
    }
    if (command === 'node') {
      const parsed = NodeCreateSchema.safeParse(data)
      if (!parsed.success) return respond(failure('请求参数或内容无效', parsed.error.issues))
      const node = parsed.data
      if (!node.space) return respond({ node, issues: [] })
      const checked = spaceCheck(node.space)
      return respond('error' in checked ? checked : { node: { ...node, space: checked.space }, issues: checked.issues })
    }

    const assets = AssetListSchema.parse(JSON.parse(source)).items
    if (command === 'generate') {
      const parsed = LayoutGenerateSchema.safeParse(data)
      if (!parsed.success) return respond(failure('请求参数或内容无效', parsed.error.issues))
      const { siStyle, shopType, strategies } = parsed.data
      const checked = spaceCheck(parsed.data.space)
      if ('error' in checked) return respond(checked)
      const { space, issues } = checked
      const placeable = assets.filter((asset) => asset.placeable && !asset.retired)
      const catalog = plannerCatalog(placeable, siStyle)
      const candidates = strategies.map((strategy) => {
        const result = space.demand
          ? generateRequired(space, space.demand.entities, placeable, siStyle, strategy)
          : planLayout({ space, shopType, strategy, catalog })
        return { strategy, layout: result.layout, issues: [...issues, ...result.issues], notes: result.notes }
      })
      return respond({ space, candidates })
    }
    if (command === 'draft') {
      const parsed = DraftPutSchema.safeParse(data)
      return respond(parsed.success ? parsed.data : failure('请求参数或内容无效', parsed.error.issues))
    }
    const parsed = LayoutValidateSchema.safeParse(data)
    if (!parsed.success) return respond(failure('请求参数或内容无效', parsed.error.issues))
    const { space, layout } = parsed.data
    const { fit, issues } = layoutCheck(space, layout, assets)
    return respond(command === 'layout' && fit.length
      ? failure('布局中的模型引用无效', fit)
      : { issues: [...fit, ...issues] })
  },
})
