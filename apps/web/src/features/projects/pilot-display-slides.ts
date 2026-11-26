import { buildDisplayPresentation } from '../../../../api/src/modules/displays/deck-template.ts'
import type { DeckImage, DeckMark } from '../../../../api/src/modules/displays/deck-template.ts'
import type {
  DisplayEdits,
  DisplayRulesView,
  DisplayTable,
  Market,
  NodeDisplay,
  DisplayPptOptions,
  SiStyle,
} from '@store/shared'
import { photoOf } from '../display/photos.ts'
import { apiHref } from '../../api/deployment.ts'
import type { DisplayPlan } from './PilotDisplay.tsx'

interface SlideInput {
  title: string
  subtitle: string
  strategy: string
  market: Market
  si: SiStyle
  rules: DisplayRulesView
  drawing: DisplayPlan
  tables: DisplayTable[]
  end: 'left' | 'right'
  moduleScheme: DisplayEdits['moduleScheme']
  rendered?: Pick<NodeDisplay, 'views' | 'overviewCameraId' | 'tableViews'>
  options?: DisplayPptOptions
  planMarks?: Record<string, DeckMark>
}

export async function displaySlideImage(url: string, maxSide = Infinity): Promise<DeckImage> {
  const image = new Image()
  image.src = url
  await image.decode()
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法读取展陈照片')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return { data: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height }
}

export async function exportDisplaySlides(input: SlideInput) {
  const { image, box } = input.drawing
  const units = new Set(
    input.tables.flatMap((table) => table.slots.flatMap((slot) => (slot.unit ? [slot.unit] : []))),
  )
  const photos = Object.fromEntries(
    await Promise.all(
      [...units].map(async (unit) => {
        const source = photoOf(input.rules.photos, unit, input.si)
        return [unit, source ? await displaySlideImage(source.url) : undefined] as const
      }),
    ),
  )
  const pending = input.tables.flatMap((table) => [
    ...table.notes.map((note) => table.label + '桌 · ' + note),
    ...table.slots
      .filter((slot) => !slot.unit)
      .map((slot) => table.label + '桌 ' + slot.slot + ' 待分配'),
  ])
  const version =
    input.si === 'SI2.0' &&
    input.moduleScheme === 'draft-2026' &&
    input.rules.rules.seatModules.some(
      (table) => table.si === input.si && table.scheme === input.moduleScheme,
    )
      ? '2026'
      : 'legacy'
  const modules = new Set(
    input.tables.flatMap((table) => (table.kind === 'island' ? table.modules : [])),
  )
  const pictures = await Promise.allSettled(
    [...modules].map(async (id) => {
      const image = await displaySlideImage(
        apiHref('/api/v1/display-inner-trays/' + version + '/' + encodeURIComponent(id)),
      )
      return [id, image] as const
    }),
  )
  const innerTrays = {
    title: version === '2026' ? '2026版内嵌托盘' : '既有内嵌托盘方案',
    source:
      version === '2026' ? '内嵌托盘配件展示方案（2026版确认稿）' : '既有指引 · 2026-10-13资源',
    images: Object.fromEntries(
      pictures.flatMap((picture) => (picture.status === 'fulfilled' ? [picture.value] : [])),
    ),
  }
  const views = new Map(
    await Promise.all(
      (input.rendered?.views ?? [])
        .filter((v) => v.imageUrl)
        .map(
          async (view) =>
            [
              view.cameraId,
              { image: await displaySlideImage(view.imageUrl!), marks: view.marks },
            ] as const,
        ),
    ),
  )
  const tableViews = Object.fromEntries(
    input.tables.map((table) => {
      const view = views.get(input.rendered?.tableViews[table.label] ?? '')
      const mark = view?.marks[table.label]
      return [table.label, view && mark ? { image: view.image, mark } : undefined]
    }),
  )
  const tables3d = Object.fromEntries(
    await Promise.all(
      (input.options?.tables3d ?? []).map(async (shot) => {
        const table = input.tables.find((t) => t.sourceId === shot.table)
        if (!table) throw new Error('展陈桌位已更新，请重新生成')
        const mime = shot.image.startsWith('iVBOR') ? 'image/png' : 'image/jpeg'
        return [
          table.label,
          {
            image: await displaySlideImage('data:' + mime + ';base64,' + shot.image),
            names: shot.names,
          },
        ] as const
      }),
    ),
  )
  const pptx = buildDisplayPresentation({
    title: input.title,
    date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(),
    market: input.market,
    subtitle: input.subtitle + ' · ' + input.strategy,
    rules: input.rules.rules,
    tables: input.tables,
    plan: image,
    planMarks:
      input.planMarks ??
      Object.fromEntries(
        input.tables.map((table) => [
          table.label,
          { x: (table.plan.cx - box.x) / box.width, y: (table.plan.cz - box.y) / box.height },
        ]),
      ),
    overview: views.get(input.rendered?.overviewCameraId ?? '') ?? null,
    tableViews,
    photos,
    innerTrays,
    landscapeEnd: input.end,
    views: input.options?.views ?? 'plan',
    tables3d,
    pending,
  })
  const output = await pptx.write({ outputType: 'blob' })
  if (!(output instanceof Blob)) throw new Error('浏览器无法生成 PPTX 文件')
  return output
}
