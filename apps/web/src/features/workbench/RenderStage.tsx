import { Suspense, lazy, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useIsMutating, useQueryClient } from '@tanstack/react-query'
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
import {
  BackgroundCanvas,
  BackgroundTools,
  emptyEditing,
} from './render-background/BackgroundEditor.tsx'
import { useBackgroundEditor } from './render-background/useBackgroundEditor.ts'
import { LeftTabContext, WorkbenchLayout } from './WorkbenchLayout.tsx'
import { CameraPanel } from './CameraPanel.tsx'

import type { LeftTab } from './WorkbenchLayout.tsx'

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
  const sharedTabs = useContext(LeftTabContext)
  const [localTab, setLocalTab] = useState<LeftTab | null>(null)
  const currentTab = sharedTabs ? sharedTabs.tab : localTab
  const setLeftTab = sharedTabs?.setTab ?? setLocalTab
  const editingBackground = currentTab === 'background' && show === '3d'
  const posed = useRef<string | null>(null)
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
  const cameraBusy = useIsMutating({ mutationKey: workbenchKeys.cameraActions(node.id) }) > 0

  const siStyle = node.siStyle ?? project.siStyle
  const views = useMemo(
    () => (cameras.data ?? []).filter((c) => c.deletedAt === null),
    [cameras.data],
  )
  const backgroundEditor = useBackgroundEditor(node.id, views)
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
  const stale = all.filter(({ camera, mode }) => imageOf(camera.id, mode)?.stale)
  const current = all.length - missing.length - stale.length
  const selected = views.find((c) => c.id === chosen) ?? views[0] ?? null
  const selectedDraft = selected ? backgroundEditor.drafts.get(selected.id) : undefined
  const editing = (selected && backgroundEditor.editing[selected.id]) || emptyEditing()
  const layout = node.layout ?? EMPTY_LAYOUT
  // Same numbering as the PDF legend (the server runs deliveryLegend too).
  const numbers = useMemo(() => deliveryLegend(layout.items, assets).numbers, [layout, assets])
  const deliverable = all.length > 0 && missing.length === 0 && stale.length === 0

  async function render(targets: Target[]) {
    if (
      !viewer.current ||
      progress ||
      cameraBusy ||
      !targets.length ||
      backgroundEditor.uploading.size
    )
      return
    setError(null)
    setProgress({ done: 0, total: targets.length })
    const ordered = MODES.flatMap((mode) => targets.filter((t) => t.mode === mode))
    try {
      const snapshots = await backgroundEditor.drafts.flushAll(views.map((c) => c.id))
      const backgrounds = new Map(views.map((c, i) => [c.id, snapshots[i]!]))
      for (const [index, { camera, mode }] of ordered.entries()) {
        const snapshot = backgrounds.get(camera.id)!
        const [url] =
          (await viewer.current?.renderViews(
            [camera.camera],
            RENDER_SIZE.width,
            RENDER_SIZE.height,
            mode,
            [snapshot.background],
          )) ?? []
        if (!url) throw new Error('三维视图已关闭，渲染中断')
        const image = await uploadRender(
          node.id,
          camera.id,
          mode,
          dataUrlToBlob(url),
          snapshot.revision,
        )
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
    if (!viewerReady || !selected || posed.current === selected.id) return
    posed.current = selected.id
    viewer.current?.showView(selected.camera)
  })

  // Opening a render node renders whatever is still missing, once.
  useEffect(() => {
    if (
      started.current ||
      !viewerReady ||
      !cameras.data ||
      !views.length ||
      !renders.data ||
      views.some((c) => !backgroundEditor.drafts.get(c.id))
    )
      return
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
    if (!svg || exporting || backgroundEditor.uploading.size) return
    setDeliveryError(null)
    setExporting(true)
    try {
      await backgroundEditor.drafts.flushAll(views.map((c) => c.id))
      const latest = await renders.refetch()
      if (latest.error) throw latest.error
      if (
        views.some(
          (c) =>
            !latest.data?.images.some(
              (image) => image.cameraId === c.id && image.mode === 'material' && !image.stale,
            ),
        )
      )
        throw new Error('背景已修改，请重新渲染后生成交付')
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
    if (show === 'display') {
      setShow('3d')
      viewer.current?.showView(camera.camera)
    }
  }

  const mainImage = selected && show === 'image' ? imageOf(selected.id, 'material') : undefined
  const busy = progress !== null || cameraBusy
  const delivering = exporting || createDelivery.isPending
  function selectTab(tab: LeftTab) {
    setLeftTab(tab)
    setShow('3d')
    if (tab === 'background' && selected) viewer.current?.showView(selected.camera)
  }

  return (
    <WorkbenchLayout
      tabState={{ tab: currentTab, setTab: selectTab }}
      left={left}
      cameras={
        <CameraPanel
          nodeId={node.id}
          viewer={viewer}
          viewerReady={viewerReady}
          layout={layout}
          onShow={choose}
          selectedId={selected?.id ?? null}
          canCapture={show === '3d' && !editingBackground}
          onOpenViewer={() => setShow('3d')}
          disabled={busy || delivering || !!selectedDraft?.gesture}
          actionsDisabled={backgroundEditor.pending || editingBackground}
          renderImages={
            new Map(
              views.flatMap(({ id }) => {
                const image = imageOf(id, 'material')
                return image ? [[id, image]] : []
              }),
            )
          }
        />
      }
      background={
        editingBackground && selected && selectedDraft ? (
          <BackgroundTools
            key={selected.id}
            cameraId={selected.id}
            draft={selectedDraft}
            drafts={backgroundEditor.drafts}
            editing={editing}
            setEditing={(value) => backgroundEditor.updateEditing(selected.id, value)}
            disabled={busy || delivering}
            uploading={backgroundEditor.uploading.has(selected.id)}
            upload={(file) => backgroundEditor.upload(selected.id, file)}
            uploadError={backgroundEditor.errors[selected.id]}
            cancelUpload={() => {
              if (!selectedDraft.background) selectTab('history')
            }}
            reload={() => {
              if (!window.confirm('放弃当前视角未保存的修改并读取服务器背景？')) return
              void cameras.refetch().then((result) => {
                const camera = result.data?.find((c) => c.id === selected.id)
                if (camera) {
                  backgroundEditor.drafts.reload(
                    camera.id,
                    camera.camera.background ?? null,
                    camera.camera.backgroundRevision ?? 0,
                  )
                  backgroundEditor.updateEditing(camera.id, emptyEditing())
                }
              })
            }}
          />
        ) : (
          <p className="hint">请选择视角后添加背景图片。</p>
        )
      }
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
                  disabled={busy || delivering}
                  onClick={() => {
                    if (currentTab === 'background') setLeftTab('history')
                    setShow(mode)
                    if (mode === '3d' && selected) viewer.current?.showView(selected.camera)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {selected && <span className="hint">{selected.camera.name}</span>}
            {show === '3d' && !editingBackground && (
              <span className="hint">拖动旋转，滚轮缩放，右键平移</span>
            )}
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

          <div
            className={show === 'display' ? 'render-main render-main-display' : 'render-main'}
            onDragOver={(e) => {
              if (show !== 'display' && e.dataTransfer.types.includes('Files')) e.preventDefault()
            }}
            onDrop={(e) => {
              if (show === 'display' || !e.dataTransfer.types.includes('Files')) return
              e.preventDefault()
              const file = e.dataTransfer.files[0]
              if (file && selected && !busy && !delivering && !selectedDraft?.gesture) {
                selectTab('background')
                backgroundEditor.upload(selected.id, file)
              }
            }}
          >
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
                  hideBoundaryWalls={editingBackground}
                  background={
                    selectedDraft ? selectedDraft.background : (selected?.camera.background ?? null)
                  }
                  siStyle={siStyle}
                  market={project.market}
                  onSelect={() => undefined}
                  onReady={() => setViewerReady(true)}
                  title={`${node.name} 三维材质`}
                />
              </Suspense>
            </div>
            {editingBackground && selected && selectedDraft && (
              <BackgroundCanvas
                key={selected.id}
                cameraId={selected.id}
                draft={selectedDraft}
                drafts={backgroundEditor.drafts}
                editing={editing}
                setEditing={(value) => backgroundEditor.updateEditing(selected.id, value)}
                disabled={busy || delivering || backgroundEditor.uploading.has(selected.id)}
                upload={(file) => backgroundEditor.upload(selected.id, file)}
              />
            )}
          </div>
        </section>
      }
      right={
        <>
          <div className="wb-card render-controls">
            <StagePanel
              title="渲染阶段"
              status={
                progress ? (
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
                  disabled:
                    busy ||
                    delivering ||
                    !!selectedDraft?.gesture ||
                    !!backgroundEditor.uploading.size ||
                    !viewerReady ||
                    !all.length,
                  primary: !deliverable,
                },
                {
                  label: '下载图片',
                  title: '下载当前（未过期）的全部渲染图（ZIP）',
                  onClick: () => window.location.assign(renderArchiveUrl(node.id)),
                  disabled: current <= 0 || !!backgroundEditor.pending || busy,
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
              disabled={
                busy ||
                delivering ||
                !!selectedDraft?.gesture ||
                !!backgroundEditor.uploading.size ||
                !deliverable
              }
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
