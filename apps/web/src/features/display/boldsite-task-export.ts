import { zipSync } from '../../../../api/src/modules/deliveries/archive-codec.ts'
import { buildDisplayChecklistBytes } from '../../../../api/src/modules/displays/checklist.ts'
import { DisplayExportSchema, MARKET_LABELS, planTaskTables, storeTitle } from '@store/shared'
import type { DisplayPptOptions, DisplayRulesView, DisplayTask } from '@store/shared'
import { fetchWorkbench, unwrap } from '../../api/client.ts'
import { apiHref, mapFileLinks, servicePrefix } from '../../api/deployment.ts'
import { displaySlideImage, exportDisplaySlides } from '../projects/pilot-display-slides.ts'

export async function archiveDisplayTask(
  task: DisplayTask,
  rules: DisplayRulesView,
  options: DisplayPptOptions,
) {
  if (!task.plan) throw new Error('请先上传平面图')
  const { market, siStyle: si, state } = task
  const tables = planTaskTables(rules.rules, task)
  const desks = new Map(state.tables.map((desk) => [desk.id, desk]))
  const planMarks = Object.fromEntries(
    tables.flatMap((table) => {
      const desk = desks.get(table.sourceId)
      return desk ? [[table.label, { x: desk.x, y: desk.y }]] : []
    }),
  )
  const renderMarks = Object.fromEntries(
    tables.flatMap((table) => {
      const mark = desks.get(table.sourceId)?.render
      return mark ? [[table.label, mark]] : []
    }),
  )
  const renderId = 'task-render'
  const rendered = task.render
    ? {
        views: [
          { cameraId: renderId, name: '效果图', imageUrl: task.render.url, marks: renderMarks },
        ],
        overviewCameraId: renderId,
        tableViews: Object.fromEntries(Object.keys(renderMarks).map((label) => [label, renderId])),
      }
    : undefined
  const title = storeTitle(task.name)
  const islands = tables.filter((table) => table.kind === 'island')
  const subtitle = [
    MARKET_LABELS[market],
    `中岛桌 ${islands.length} 张${islands[0] ? `（${islands[0].orientation === 'portrait' ? '竖版' : '横版'}）` : ''}`,
    ...(tables.length > islands.length ? [`边桌 ${tables.length - islands.length} 张`] : []),
  ].join(' · ')
  const image = await displaySlideImage(task.plan.url, 2400)
  const [pptx, xlsx] = await Promise.all([
    exportDisplaySlides({
      title,
      subtitle: si,
      strategy: subtitle,
      market,
      si,
      rules,
      drawing: { image, box: { x: 0, y: 0, width: image.width, height: image.height } },
      tables,
      planMarks,
      end: state.edits.landscapeEnd,
      moduleScheme: state.edits.moduleScheme,
      rendered,
      options,
    }),
    buildDisplayChecklistBytes({
      title,
      rules: rules.rules,
      tables,
      pending: tables.flatMap((table) => table.notes),
    }),
  ])
  const files = zipSync(
    { 'display.pptx': new Uint8Array(await pptx.arrayBuffer()), 'display.xlsx': xlsx },
    { level: 0 },
  )
  const query = new URLSearchParams({ revision: String(task.revision), ruleVersion: rules.version })
  const response = await fetchWorkbench(
    new Request(apiHref(`/api/v1/display-tasks/${task.id}/compiled?${query.toString()}`), {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: files,
    }),
  )
  const body: unknown = await response.json().catch(() => undefined)
  return DisplayExportSchema.parse(
    mapFileLinks(
      unwrap(response.ok ? { data: body, response } : { error: body, response }),
      servicePrefix,
    ),
  )
}
