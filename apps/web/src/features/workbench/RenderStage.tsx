import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ExternalLink, FileArchive, ImageIcon } from 'lucide-react'
import { RENDERED_MODES, RENDER_SIZE, deliveryLegend } from '@store/shared'
import type {
  Asset,
  DesignNode,
  Layout,
  NodeCamera,
  NodeDisplayExportRequest,
  NodeRenderList,
  Project,
  RenderImage,
  RenderMode,
  RenderedMode,
  Space,
} from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { DisplayPanel } from '../display/DisplayPanel.tsx'
import { storedPptViews } from '../display/pptViews.ts'
import { displayKeys, useDisplayRules, useNodeDisplay } from '../display/queries.ts'
import { tableShots } from '../display/table3d/shots.ts'
import type { Viewer3DHandle } from '../viewer3d/Viewer3D.tsx'
import {
  renderArchiveUrl,
  uploadRender,
  useCameras,
  useCreateDelivery,
  useDeliveries,
  useRenders,
  withImage,
  workbenchKeys,
} from './api.ts'
import { exportPlan } from './plan-export.ts'
import { PlanView } from './PlanView.tsx'
import { DeliveryList } from './DeliveryList.tsx'
import { StagePanel } from './StagePanel.tsx'
import { WorkbenchLayout } from './WorkbenchLayout.tsx'

const Viewer3D = lazy(() =>
  import('../viewer3d/Viewer3D.tsx').then((module) => ({ default: module.Viewer3D })),
)

const MODES: readonly RenderedMode[] = RENDERED_MODES
const NO_FLAGS: ReadonlySet<string> = new Set()
const EMPTY_LAYOUT: Layout = { schemaVersion: 3, items: [], planning: null }

/** The 3D material view (rotatable), the rendered image of the chosen view, or the 展陈 plan. */
type Show = '3d' | 'image' | 'display'
const NO_NUMBERS: Readonly<Record<string, number>> = {}
type Target = { camera: NodeCamera; mode: RenderedMode }

function dataUrlToBlob(url: string): Blob {
  const data = atob(url.slice(url.indexOf(',') + 1))
  const bytes = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i)
  return new Blob([bytes], { type: 'image/png' })
}

interface RenderStageProps {
  left: ReactNode
  project: Project
  node: DesignNode
  space: Space
  assets: ReadonlyMap<string, Asset>
}

/**
 * A render node: the shop in the material look, rotatable in 3D, and one material image per
 * view rendered in the browser from that scene and kept under this node (white-model images
 * are no longer made). Missing images render on opening; images made before the models or
 * views changed are marked stale.
 */
export function RenderStage({ left, project, node, space, assets }: RenderStageProps) {
  const cameras = useCameras(node.id)
  const renders = useRenders(node.id)
  const client = useQueryClient()
  const viewer = useRef<Viewer3DHandle>(null)
  const [viewerReady, setViewerReady] = useState(false)
  const [show, setShow] = useState<Show>('3d')
  const posed = useRef(false)
  const [chosen, setChosen] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const started = useRef(false)
  const planRef = useRef<SVGSVGElement>(null)
  const displayPlanRef = useRef<SVGSVGElement>(null)
  const display = useNodeDisplay(node.id)
  const displayRules = useDisplayRules()
  const hasDisplay = (display.data?.tables.length ?? 0) > 0
  const [withDisplay, setWithDisplay] = useState(true)
  const deliveries = useDeliveries(node.id)
  const createDelivery = useCreateDelivery(node.id)
  const [exporting, setExporting] = useState(false)
  const [deliveryError, setDeliveryError] = useState<unknown>(null)

  const siStyle = node.siStyle ?? project.siStyle
  const views = useMemo(
    () => (cameras.data ?? []).filter((c) => c.deletedAt === null),
    [cameras.data],
  )
  const images = useMemo(
    () =>
      new Map(
        (renders.data?.images ?? [])
          .filter((i) => (MODES as readonly RenderMode[]).includes(i.mode))
          .map((i) => [`${i.cameraId}:${i.mode}`, i]),
      ),
    [renders.data],
  )
  const imageOf = (cameraId: string, mode: RenderMode): RenderImage | undefined =>
    images.get(`${cameraId}:${mode}`)
  const all: Target[] = views.flatMap((camera) => MODES.map((mode) => ({ camera, mode })))
  const missing = all.filter((t) => !imageOf(t.camera.id, t.mode))
  const stale = [...images.values()].filter((i) => i.stale)
  const current = all.length - missing.length - stale.length
  const selected = views.find((c) => c.id === chosen) ?? views[0] ?? null
  const layout = node.layout ?? EMPTY_LAYOUT
  // Same numbering as the PDF legend (the server runs deliveryLegend too).
  const numbers = useMemo(() => deliveryLegend(layout.items, assets).numbers, [layout, assets])
  const deliverable = all.length > 0 && missing.length === 0 && stale.length === 0

  async function render(targets: Target[]) {
    if (!viewer.current || progress || !targets.length) return
    setError(null)
    setProgress({ done: 0, total: targets.length })
    const ordered = MODES.flatMap((mode) => targets.filter((t) => t.mode === mode))
    try {
      for (const [index, { camera, mode }] of ordered.entries()) {
        const [url] =
          (await viewer.current?.renderViews(
            [camera.camera],
            RENDER_SIZE.width,
            RENDER_SIZE.height,
            mode,
          )) ?? []
        if (!url) throw new Error('三维视图已关闭，渲染中断')
        const image = await uploadRender(node.id, camera.id, mode, dataUrlToBlob(url))
        client.setQueryData<NodeRenderList>(workbenchKeys.renders(node.id), (list) =>
          withImage(list, node.id, image),
        )
        setProgress({ done: index + 1, total: ordered.length })
      }
    } catch (caught) {
      setError(caught)
    } finally {
      setProgress(null)
      void client.invalidateQueries({ queryKey: workbenchKeys.renders(node.id) })
      // The 展陈 tab shows the renders with the table labels on them.
      void client.invalidateQueries({ queryKey: displayKeys.node(node.id) })
    }
  }

  // The 3D view opens at the chosen view, once the scene and the views are there.
  useEffect(() => {
    if (posed.current || !viewerReady || !selected) return
    posed.current = true
    viewer.current?.showView(selected.camera)
  })

  // Opening a render node renders whatever is still missing, once.
  useEffect(() => {
    if (started.current || !viewerReady || !cameras.data || !renders.data) return
    started.current = true
    if (missing.length) void render(missing)
  })

  /** The plan for the 展陈 PPT: no legend numbers, the customer-flow arrow, and its area in metres. */
  async function exportDisplayPlan(): Promise<NodeDisplayExportRequest> {
    const svg = displayPlanRef.current
    if (!svg) throw new Error('平面图尚未绘制')
    const plan = await exportPlan(svg)
    const box = svg.viewBox.baseVal
    return { planPng: plan.png, planViewBox: [box.x, box.y, box.width, box.height] }
  }

  /** The 展陈 PPT's request: its plan, and the 3D views unless only the slot diagrams are wanted. */
  async function displayExport() {
    const views = storedPptViews()
    const data = display.data
    const tables3d =
      views === 'plan' || !data || !displayRules.data
        ? []
        : await tableShots(data.tables, {
            rules: displayRules.data.rules,
            photos: displayRules.data.photos,
            si: siStyle,
            end: data.edits.landscapeEnd,
          })
    return { ...(await exportDisplayPlan()), views, tables3d }
  }

  /** Draws the numbered plan at print size, then the server builds both PDFs and the ZIP. */
  async function deliver() {
    const svg = planRef.current
    if (!svg || exporting) return
    setDeliveryError(null)
    setExporting(true)
    try {
      const plan = await exportPlan(svg)
      await createDelivery.mutateAsync({
        planPng: plan.png,
        planSvg: plan.svg,
        ...(hasDisplay && withDisplay ? { display: await displayExport() } : {}),
      })
    } catch (caught) {
      setDeliveryError(caught)
    } finally {
      setExporting(false)
    }
  }

  function choose(camera: NodeCamera) {
    setChosen(camera.id)
    if (show === '3d') viewer.current?.showView(camera.camera)
  }

  const mainImage = selected && show === 'image' ? imageOf(selected.id, 'material') : undefined
  const busy = progress !== null
  const delivering = exporting || createDelivery.isPending

  return (
    <WorkbenchLayout
      left={left}
      center={
        <section className="render-stage wb-card" aria-label="渲染">
          <h2 className="node-heading">
            {node.name} <span className="hint">· {siStyle}</span>
          </h2>
          <div className="toolbar">
            <div className="tabs" role="group" aria-label="显示">
              {(
                [
                  ['3d', '三维查看'],
                  ['image', '渲染图'],
                  ['display', '展陈'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={show === mode}
                  onClick={() => {
                    setShow(mode)
                    if (mode === '3d' && selected) viewer.current?.showView(selected.camera)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {selected && <span className="hint">{selected.camera.name}</span>}
            {show === '3d' && <span className="hint">拖动旋转，滚轮缩放，右键平移</span>}
          </div>
          {/* The delivery plan, drawn off screen at a fixed width and exported as an image. */}
          <div className="delivery-plan" aria-hidden="true">
            <PlanView
              svgRef={planRef}
              space={space}
              shopType={project.shopType}
              layout={layout}
              assets={assets}
              numbers={numbers}
              spacing
              title={`${node.name} 交付平面`}
            />
            <PlanView
              svgRef={displayPlanRef}
              space={space}
              shopType={project.shopType}
              layout={layout}
              assets={assets}
              numbers={NO_NUMBERS}
              title={`${node.name} 展陈平面`}
            />
          </div>

          <div className={show === 'display' ? 'render-main render-main-display' : 'render-main'}>
            {show === 'display' && (
              <DisplayPanel
                project={project}
                node={node}
                space={space}
                layout={layout}
                assets={assets}
                exportPlan={exportDisplayPlan}
              />
            )}
            {show === 'image' && (
              <div className="render-image">
                {mainImage ? (
                  <>
                    <img
                      src={mainImage.url}
                      alt={`${selected?.camera.name ?? ''} 材质图`}
                      width={mainImage.width}
                      height={mainImage.height}
                    />
                    <div className="render-image-actions">
                      {mainImage.stale && (
                        <span className="tag render-status warning">
                          <AlertTriangle size={14} aria-hidden="true" />
                          已过期，重新渲染后更新
                        </span>
                      )}
                      <a
                        className="button render-open"
                        href={mainImage.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={14} aria-hidden="true" />
                        查看大图
                      </a>
                    </div>
                  </>
                ) : (
                  <div className="render-empty" role="status">
                    <ImageIcon size={28} aria-hidden="true" />
                    <strong>{busy ? '正在渲染当前视角' : '尚未渲染'}</strong>
                    <span>
                      {busy ? '完成后将在这里显示材质图' : '请使用右侧“重新渲染”生成材质图'}
                    </span>
                  </div>
                )}
              </div>
            )}
            {/* Always mounted: it is the scene the images are rendered from. */}
            <div className="render-live" hidden={show !== '3d'}>
              <Suspense fallback={<p className="notice">正在载入三维…</p>}>
                <Viewer3D
                  ref={viewer}
                  space={space}
                  shopType={project.shopType}
                  layout={layout}
                  assets={assets}
                  selectedId={null}
                  flaggedIds={NO_FLAGS}
                  look="material"
                  siStyle={siStyle}
                  market={project.market}
                  onSelect={() => undefined}
                  onReady={() => setViewerReady(true)}
                  title={`${node.name} 三维材质`}
                />
              </Suspense>
            </div>
          </div>

          <div className="render-strip-heading">
            <h3>
              视角 <span className="hint">（{views.length}）</span>
            </h3>
            <span className="hint">选择缩略图切换视角</span>
          </div>
          {views.length === 0 && (
            <p className="hint">暂无视角，请回到白模添加视角后重新开始渲染。</p>
          )}
          <ol className="render-strip" aria-label="视角">
            {views.map((camera) => {
              const image = imageOf(camera.id, 'material')
              return (
                <li key={camera.id}>
                  <button
                    type="button"
                    className="camera-thumb"
                    aria-pressed={camera.id === selected?.id}
                    aria-label={`查看视角 ${camera.camera.name}`}
                    onClick={() => choose(camera)}
                  >
                    {image ? (
                      <img src={image.url} alt="" />
                    ) : (
                      <span className="camera-thumb-empty">{busy ? '渲染中…' : '未渲染'}</span>
                    )}
                  </button>
                  <span className="render-strip-name">
                    {camera.camera.name}
                    {image?.stale ? <span className="tag render-status warning">过期</span> : null}
                  </span>
                </li>
              )
            })}
          </ol>
        </section>
      }
      right={
        <>
          <div className="wb-card render-controls">
            <StagePanel
              title="渲染阶段"
              status={
                busy ? (
                  <span className="tag render-status" role="status">
                    正在渲染 {progress.done}/{progress.total}
                  </span>
                ) : stale.length ? (
                  <span className="tag render-status warning">{stale.length} 张过期</span>
                ) : deliverable ? (
                  <span className="tag render-status complete">已就绪</span>
                ) : null
              }
              first={[
                {
                  label: '重新渲染',
                  title: '按当前模型与视角重新渲染全部材质图',
                  onClick: () => void render(all),
                  disabled: busy || !viewerReady || !all.length,
                  primary: !deliverable,
                },
                {
                  label: '下载图片',
                  title: '下载当前（未过期）的全部渲染图（ZIP）',
                  onClick: () => window.location.assign(renderArchiveUrl(node.id)),
                  disabled: current <= 0,
                },
              ]}
              hint={
                <>
                  已渲染 {Math.max(current, 0)}/{all.length} 张：每个视角一张材质图（
                  {RENDER_SIZE.width}×{RENDER_SIZE.height}
                  ），与三维查看同一场景。渲染节点保存了确认时的布局，不能直接编辑；如需修改，请回到它的白模。
                </>
              }
            />
            {progress && (
              <div className="render-progress">
                <progress aria-label="渲染进度" value={progress.done} max={progress.total} />
                <p className="hint">正在生成材质图，请保持页面打开。</p>
              </div>
            )}
            <ErrorMessage error={error ?? cameras.error ?? renders.error} />
          </div>
          <section className="wb-card delivery-options" aria-label="生成交付">
            <h3>
              <FileArchive size={16} aria-hidden="true" />
              生成交付
            </h3>
            <p className="hint">每次生成均包含以下文件，并保存到服务器归档目录。</p>
            <ul className="delivery-included" aria-label="必含文件">
              <li>
                <Check size={14} aria-hidden="true" />
                完整版 PDF<span>完整方案与物料明细</span>
              </li>
              <li>
                <Check size={14} aria-hidden="true" />
                展示版 PDF<span>用于方案展示</span>
              </li>
              <li>
                <Check size={14} aria-hidden="true" />
                交付目录 ZIP<span>一次下载整套文件</span>
              </li>
            </ul>
            {hasDisplay ? (
              <label className="delivery-ppt-option">
                <input
                  type="checkbox"
                  checked={withDisplay}
                  disabled={delivering}
                  onChange={(event) => setWithDisplay(event.target.checked)}
                />
                <span>
                  同时生成展陈方案 PPT
                  <small>{display.data?.tables.length} 张桌 · 页型沿用“展陈”中的设置</small>
                </span>
              </label>
            ) : (
              <p className="hint">如需展陈方案 PPT，请先在“展陈”页签配置桌面。</p>
            )}
            <button
              type="button"
              className="primary delivery-generate"
              onClick={() => void deliver()}
              disabled={busy || delivering || !deliverable}
              aria-describedby="delivery-availability"
            >
              {delivering ? '正在生成交付文件…' : '生成交付文件'}
            </button>
            <p className="hint" id="delivery-availability">
              {delivering
                ? '文件生成中，请等待完成后下载。'
                : deliverable
                  ? '已就绪，可生成双 PDF 与交付目录 ZIP。'
                  : '请先渲染全部视角，缺失或过期的图需重新渲染。'}
            </p>
            {delivering && (
              <div className="delivery-progress" role="status">
                <span
                  className="delivery-progress-track"
                  role="progressbar"
                  aria-label="交付文件生成进度"
                  aria-valuetext="正在整理交付文件"
                />
                <strong>正在整理交付文件</strong>
                <span>
                  生成 PDF{hasDisplay && withDisplay ? '、展陈 PPT' : ''} 与
                  ZIP，完成后可在下方下载。请保持页面打开。
                </span>
              </div>
            )}
            <ErrorMessage error={deliveryError ?? createDelivery.error} />
          </section>
          <DeliveryList deliveries={deliveries.data ?? []} error={deliveries.error} />
        </>
      }
    />
  )
}
