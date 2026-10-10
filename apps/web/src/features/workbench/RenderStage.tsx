import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RENDER_MODE_LABELS, RENDER_SIZE } from '@store/shared'
import type {
  Asset,
  DesignNode,
  Layout,
  NodeCamera,
  NodeRenderList,
  Project,
  RenderImage,
  RenderMode,
  Space,
} from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import type { Viewer3DHandle } from '../viewer3d/Viewer3D.tsx'
import {
  renderArchiveUrl,
  uploadRender,
  useCameras,
  useRenders,
  withImage,
  workbenchKeys,
} from './api.ts'
import { StagePanel } from './StagePanel.tsx'
import { WorkbenchLayout } from './WorkbenchLayout.tsx'

const Viewer3D = lazy(() =>
  import('../viewer3d/Viewer3D.tsx').then((module) => ({ default: module.Viewer3D })),
)

/** White first: the material look stays on screen, so only the white pass switches looks. */
const MODES: readonly RenderMode[] = ['white', 'material']
const NO_FLAGS: ReadonlySet<string> = new Set()
const EMPTY_LAYOUT: Layout = { schemaVersion: 3, items: [], planning: null }

type Show = RenderMode | '3d'
type Target = { camera: NodeCamera; mode: RenderMode }

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
 * A render node: every view as a white-model and a material image, rendered in the browser
 * from one scene and camera (only the materials change) and kept under this node. Missing
 * images render on opening; images made before the models or views changed are marked stale.
 */
export function RenderStage({ left, project, node, space, assets }: RenderStageProps) {
  const cameras = useCameras(node.id)
  const renders = useRenders(node.id)
  const client = useQueryClient()
  const viewer = useRef<Viewer3DHandle>(null)
  const [viewerReady, setViewerReady] = useState(false)
  const [show, setShow] = useState<Show>('material')
  const [chosen, setChosen] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const started = useRef(false)

  const siStyle = node.siStyle ?? project.siStyle
  const views = useMemo(
    () => (cameras.data ?? []).filter((c) => c.deletedAt === null),
    [cameras.data],
  )
  const images = useMemo(
    () => new Map((renders.data?.images ?? []).map((i) => [`${i.cameraId}:${i.mode}`, i])),
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
    }
  }

  // Opening a render node renders whatever is still missing, once.
  useEffect(() => {
    if (started.current || !viewerReady || !cameras.data || !renders.data) return
    started.current = true
    if (missing.length) void render(missing)
  })

  function choose(camera: NodeCamera) {
    setChosen(camera.id)
    if (show === '3d') viewer.current?.showView(camera.camera)
  }

  const shownMode: RenderMode = show === 'white' ? 'white' : 'material'
  const mainImage = selected && show !== '3d' ? imageOf(selected.id, show) : undefined
  const busy = progress !== null

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
              {(['material', 'white', '3d'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={show === mode}
                  onClick={() => {
                    setShow(mode)
                    if (mode === '3d' && selected) viewer.current?.showView(selected.camera)
                  }}
                >
                  {mode === '3d' ? '三维查看' : `${RENDER_MODE_LABELS[mode]}图`}
                </button>
              ))}
            </div>
            {selected && <span className="hint">{selected.camera.name}</span>}
          </div>

          <div className="render-main">
            {show !== '3d' && (
              <div className="render-image">
                {mainImage ? (
                  <>
                    <img
                      src={mainImage.url}
                      alt={`${selected?.camera.name ?? ''} ${RENDER_MODE_LABELS[show]}图`}
                      width={mainImage.width}
                      height={mainImage.height}
                    />
                    {mainImage.stale && (
                      <span className="tag render-stale">已过期，重新渲染后更新</span>
                    )}
                  </>
                ) : (
                  <p className="notice">{busy ? '正在渲染…' : '尚未渲染'}</p>
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
                  look={show === 'white' ? 'white' : 'material'}
                  siStyle={siStyle}
                  onSelect={() => undefined}
                  onReady={() => setViewerReady(true)}
                  title={`${node.name} 三维材质`}
                />
              </Suspense>
            </div>
          </div>

          <ol className="render-strip" aria-label="视角">
            {views.map((camera) => {
              const image = imageOf(camera.id, shownMode)
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
                    {image?.stale ? <span className="tag">过期</span> : null}
                  </span>
                </li>
              )
            })}
          </ol>
        </section>
      }
      right={
        <div className="wb-card">
          <StagePanel
            title="渲染阶段"
            status={
              busy ? (
                <span className="tag" role="status">
                  正在渲染 {progress.done}/{progress.total}
                </span>
              ) : stale.length ? (
                <span className="tag">{stale.length} 张过期</span>
              ) : null
            }
            first={[
              {
                label: '重新渲染',
                title: '按当前模型与视角重新渲染全部白模图和材质图',
                onClick: () => void render(all),
                disabled: busy || !viewerReady || !all.length,
              },
              {
                label: '下载图片',
                title: '下载当前（未过期）的全部渲染图（ZIP）',
                onClick: () => window.location.assign(renderArchiveUrl(node.id)),
                disabled: current <= 0,
              },
            ]}
            second={{
              label: '生成交付文件',
              onClick: () => undefined,
              disabled: true,
              primary: true,
              title: '双 PDF 交付将在下一步接入',
            }}
            hint={
              <>
                已渲染 {Math.max(current, 0)}/{all.length} 张：每个视角一张白模图、一张材质图（
                {RENDER_SIZE.width}×{RENDER_SIZE.height}
                ），同一场景同一相机，只切换材质。渲染节点保存了确认时的布局，不能直接编辑；如需修改，请回到它的白模。
              </>
            }
          />
          <ErrorMessage error={error ?? cameras.error ?? renders.error} />
        </div>
      }
    />
  )
}
