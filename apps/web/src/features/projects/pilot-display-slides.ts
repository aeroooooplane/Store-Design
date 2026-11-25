import { buildDisplayPresentation } from '../../../../api/src/modules/displays/deck-template.ts'
import type { DeckImage } from '../../../../api/src/modules/displays/deck-template.ts'
import type { DisplayRulesView, DisplayTable, Market, SiStyle } from '@store/shared'
import { photoOf } from '../display/photos.ts'
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
}

async function photo(url: string): Promise<DeckImage> {
  const image = new Image()
  image.src = url
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法读取展陈照片')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0)
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
        return [unit, source ? await photo(source.url) : undefined] as const
      }),
    ),
  )
  const pending = input.tables.flatMap((table) => [
    ...table.notes.map((note) => table.label + '桌 · ' + note),
    ...table.slots
      .filter((slot) => !slot.unit)
      .map((slot) => table.label + '桌 ' + slot.slot + ' 待分配'),
  ])
  const pptx = buildDisplayPresentation({
    title: input.title,
    date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(),
    market: input.market,
    subtitle: input.subtitle + ' · ' + input.strategy,
    rules: input.rules.rules,
    tables: input.tables,
    plan: image,
    planMarks: Object.fromEntries(
      input.tables.map((table) => [
        table.label,
        { x: (table.plan.cx - box.x) / box.width, y: (table.plan.cz - box.y) / box.height },
      ]),
    ),
    overview: null,
    tableViews: {},
    photos,
    landscapeEnd: input.end,
    views: 'plan',
    tables3d: {},
    pending,
  })
  const output = await pptx.write({ outputType: 'blob' })
  if (!(output instanceof Blob)) throw new Error('浏览器无法生成 PPTX 文件')
  return output
}
