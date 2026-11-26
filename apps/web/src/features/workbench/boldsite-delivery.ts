import { zipSync, strToU8 } from '../../../../api/src/modules/deliveries/archive-codec.ts'
import { buildDisplayChecklistBytes } from '../../../../api/src/modules/displays/checklist.ts'
import {
  DeliverySchema,
  DisplayExportSchema,
  ApiErrorSchema,
  MARKET_LABELS,
  SHOP_TYPE_LABELS,
  deliveryLegend,
  polygonArea,
  storeTitle,
} from '@store/shared'
import type {
  Asset,
  DesignNode,
  DisplayRulesView,
  NodeCamera,
  NodeDisplay,
  NodeDisplayExportRequest,
  Project,
  RenderImage,
  Space,
} from '@store/shared'
import { ApiRequestError, fetchWorkbench } from '../../api/client.ts'
import { apiHref, mapFileLinks, servicePrefix } from '../../api/deployment.ts'
import { exportDeliveryPdfs } from '../projects/pilot-delivery.ts'
import { exportDisplaySlides } from '../projects/pilot-display-slides.ts'

interface Scene {
  node: DesignNode
  project: Project
  images: RenderImage[]
  cameras: NodeCamera[]
}
interface Exhibit {
  data: NodeDisplay
  rules: DisplayRulesView
  options: NodeDisplayExportRequest
}

export function decodeImage(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}

async function upload(
  scene: Scene,
  kind: 'display' | 'delivery',
  files: Record<string, Uint8Array>,
  revision = 0,
  pages?: { full: number; show: number },
) {
  const useful = scene.cameras
    .filter((c) => !c.deletedAt)
    .map((camera) => {
      const render = scene.images.find(
        (i) => i.cameraId === camera.id && i.mode === 'material' && !i.stale,
      )
      if (!render) throw new Error('请先生成全部视角的有效渲染图')
      return render
    })
  const query = new URLSearchParams({
    renders: useful.map((i) => i.id).join(','),
    revision: String(revision),
  })
  if (pages) {
    query.set('full', String(pages.full))
    query.set('show', String(pages.show))
  }
  const response = await fetchWorkbench(
    new Request(
      apiHref('/api/v1/nodes/' + scene.node.id + '/compiled/' + kind + '?' + query.toString()),
      {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        body: zipSync(files, { level: 0 }),
      },
    ),
  )
  const data: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(data)
    if (parsed.success) {
      const error = parsed.data.error
      throw new ApiRequestError(
        response.status,
        error.code,
        error.message,
        error.requestId,
        error.details,
      )
    }
    throw new Error('无法保存交付文件（HTTP ' + response.status + '）')
  }
  return mapFileLinks(data, servicePrefix)
}

async function compileDisplay(scene: Scene, exhibit: Exhibit) {
  const { data, rules, options } = exhibit
  const [x, y, width, height] = options.planViewBox
  const image = new Image()
  image.src = 'data:image/png;base64,' + options.planPng
  await image.decode()
  const title = storeTitle(scene.project.name)
  const [pptx, xlsx] = await Promise.all([
    exportDisplaySlides({
      title,
      subtitle: SHOP_TYPE_LABELS[scene.project.shopType],
      strategy: scene.node.siStyle ?? scene.project.siStyle,
      market: scene.project.market,
      si: scene.node.siStyle ?? scene.project.siStyle,
      rules,
      drawing: {
        image: { data: image.src, width: image.naturalWidth, height: image.naturalHeight },
        box: { x, y, width, height },
      },
      tables: data.tables,
      end: data.edits.landscapeEnd,
      moduleScheme: data.edits.moduleScheme,
      rendered: data,
      options,
    }),
    buildDisplayChecklistBytes({
      title,
      rules: rules.rules,
      tables: data.tables,
      pending: data.tables.flatMap((t) => t.notes),
    }),
  ])
  return { 'display.pptx': new Uint8Array(await pptx.arrayBuffer()), 'display.xlsx': xlsx }
}

export async function archiveDisplay(scene: Scene, exhibit: Exhibit) {
  return DisplayExportSchema.parse(
    await upload(scene, 'display', await compileDisplay(scene, exhibit), exhibit.data.revision),
  )
}

export async function archiveDelivery(
  scene: Scene,
  input: {
    png: string
    svg: string
    space: Space
    assets: ReadonlyMap<string, Asset>
    exhibit?: Exhibit
  },
) {
  const plan = decodeImage(input.png)
  const layout = scene.node.layout
  if (!layout) throw new Error('缺少渲染方案')
  const legend = deliveryLegend(layout.items, input.assets).entries
  const views = await Promise.all(
    scene.cameras
      .filter((c) => !c.deletedAt)
      .map(async (camera, index) => {
        const image = scene.images.find(
          (value) => value.cameraId === camera.id && value.mode === 'material' && !value.stale,
        )
        if (!image) throw new Error('请先生成全部视角的有效渲染图')
        const response = await fetch(image.url)
        if (!response.ok) throw new Error('读取渲染图失败')
        return {
          no: index + 1,
          name: camera.camera.name,
          material: new Uint8Array(await response.arrayBuffer()),
        }
      }),
  )
  const mm = (metres: number) => Math.round(metres * 1000)
  const xs = input.space.boundary.map((p) => p[0])
  const zs = input.space.boundary.map((p) => p[1])
  const files = await exportDeliveryPdfs({
    title: storeTitle(scene.project.name),
    subtitle: [
      SHOP_TYPE_LABELS[scene.project.shopType],
      MARKET_LABELS[scene.project.market],
      scene.node.siStyle,
    ].join(' · '),
    date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(),
    plan,
    legend,
    views,
    facts: [
      `面积 ${polygonArea(input.space.boundary).toFixed(1)} ㎡，外包尺寸 ${mm(Math.max(...xs) - Math.min(...xs))} × ${mm(Math.max(...zs) - Math.min(...zs))} mm，层高 ${mm(input.space.height)} mm`,
      `道具 ${layout.items.length} 件，${legend.length} 种（编号见图例）`,
      `方案：${scene.node.name}`,
      `效果图 ${views.length} 个视角`,
    ],
    notes: [
      ...(layout.planning?.note ? [layout.planning.note] : []),
      ...legend.filter((e) => e.placeholder).map((e) => e.name + '为占位'),
    ],
  })
  const exhibit = input.exhibit ? await compileDisplay(scene, input.exhibit) : {}
  return DeliverySchema.parse(
    await upload(
      scene,
      'delivery',
      {
        'full.pdf': new Uint8Array(await files.full.arrayBuffer()),
        'show.pdf': new Uint8Array(await files.show.arrayBuffer()),
        'plan.png': plan,
        'plan.svg': strToU8(input.svg),
        ...exhibit,
      },
      input.exhibit?.data.revision,
      files.pages,
    ),
  )
}
