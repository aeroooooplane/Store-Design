import { useCallback, useMemo, useState } from 'react'
import { DISPLAY_ORIENTATION_LABELS } from '@store/shared'
import type {
  Asset,
  DesignNode,
  DisplayEdits,
  Layout,
  NodeDisplayExportRequest,
  Project,
  Space,
} from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { PlanView } from '../workbench/PlanView.tsx'
import { MarkedPicture } from './MarkedPicture.tsx'
import { PptViewsSelect } from './PptViewsSelect.tsx'
import { usePptViews } from './pptViews.ts'
import { tableShots } from './table3d/shots.ts'
import { SlotTable } from './SlotTable.tsx'
import {
  useDisplayRules,
  useExportNodeDisplay,
  useNodeDisplay,
  useSaveNodeDisplay,
} from './queries.ts'

const NO_NUMBERS: Readonly<Record<string, number>> = {}

interface DisplayPanelProps {
  project: Project
  node: DesignNode
  space: Space
  layout: Layout
  assets: ReadonlyMap<string, Asset>
  /** The clean plan drawn for the PPT (no legend numbers), with the area it shows. */
  exportPlan: () => Promise<NodeDisplayExportRequest>
}

const sizeText = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

/**
 * 展陈 tab of a render node: the island and side tables of the layout numbered by the guide,
 * their labels on the plan and on the renders (worked out from the views), what each slot holds
 * (editable), and the PPT and checklist export.
 */
export function DisplayPanel({
  project,
  node,
  space,
  layout,
  assets,
  exportPlan,
}: DisplayPanelProps) {
  const display = useNodeDisplay(node.id)
  const rules = useDisplayRules()
  const save = useSaveNodeDisplay(node.id)
  const exporting = useExportNodeDisplay(node.id)
  const [viewId, setViewId] = useState<string | null>(null)
  const [pptViews, setPptViews] = usePptViews()
  const [drawing, setDrawing] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [viewBox, setViewBox] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  // The drawing's viewBox (plan metres) places the labels over it.
  const planRef = useCallback((svg: SVGSVGElement | null) => {
    const box = svg?.viewBox.baseVal
    if (!box) return
    setViewBox((old) =>
      old &&
      old.x === box.x &&
      old.y === box.y &&
      old.width === box.width &&
      old.height === box.height
        ? old
        : { x: box.x, y: box.y, width: box.width, height: box.height },
    )
  }, [])

  const data = display.data
  const planMarks = useMemo(
    () =>
      viewBox && data
        ? data.tables.map((t) => ({
            id: t.sourceId,
            label: t.label,
            x: (t.plan.cx - viewBox.x) / viewBox.width,
            y: (t.plan.cz - viewBox.y) / viewBox.height,
            tone: t.kind,
          }))
        : [],
    [data, viewBox],
  )

  if (display.error || rules.error) return <ErrorMessage error={display.error ?? rules.error} />
  if (!data || !rules.data) return <p className="notice">正在载入展陈方案…</p>
  if (!data.tables.length) {
    return <p className="notice">这个方案里没有中岛桌或带托盘的边桌，不需要展陈方案。</p>
  }

  const shown =
    data.views.find((v) => v.cameraId === (viewId ?? data.overviewCameraId)) ?? data.views[0]
  const islands = data.tables.filter((t) => t.kind === 'island')
  const orientation = islands[0]?.orientation
  const edit = (edits: DisplayEdits) => save.mutate(edits)
  // The PPT shows the renders: wait for them rather than print empty frames.
  const rendered = data.views.some((v) => v.imageUrl)

  async function makePpt() {
    if (!data || !rules.data) return
    setError(null)
    setDrawing(true)
    try {
      const plan = await exportPlan()
      // The server has no WebGL: the 3D views are drawn here and sent along.
      const tables3d =
        pptViews === 'plan'
          ? []
          : await tableShots(data.tables, {
              rules: rules.data.rules,
              photos: rules.data.photos,
              si: node.siStyle ?? project.siStyle,
              end: data.edits.landscapeEnd,
            })
      setDrawing(false)
      await exporting.mutateAsync({ ...plan, views: pptViews, tables3d })
    } catch (caught) {
      setError(caught)
    } finally {
      setDrawing(false)
    }
  }

  return (
    <div className="display-panel">
      <div className="toolbar">
        <span className="hint">
          {islands.length} 张中岛桌
          {orientation ? `（${DISPLAY_ORIENTATION_LABELS[orientation]}）` : ''}
          {data.tables.length > islands.length
            ? ` · 边桌 ${data.tables.length - islands.length} 张`
            : ''}{' '}
          · 展陈规则 {data.ruleVersion}
        </span>
        <div className="tabs" role="group" aria-label="横竖版">
          {(
            [
              [null, '自动'],
              ['landscape', '横版'],
              ['portrait', '竖版'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={data.edits.orientation === value}
              disabled={save.isPending}
              onClick={() => edit({ ...data.edits, orientation: value })}
            >
              {label}
            </button>
          ))}
        </div>
        {orientation === 'landscape' && (
          <select
            aria-label="横版端头"
            value={data.edits.landscapeEnd}
            disabled={save.isPending}
            onChange={(event) =>
              edit({ ...data.edits, landscapeEnd: event.target.value as 'left' | 'right' })
            }
          >
            <option value="left">端头统一在左侧</option>
            <option value="right">端头统一在右侧</option>
          </select>
        )}
        <PptViewsSelect value={pptViews} onChange={setPptViews} disabled={exporting.isPending} />
        <button
          type="button"
          className="primary"
          onClick={() => void makePpt()}
          disabled={drawing || exporting.isPending || !rendered}
          title={rendered ? undefined : '渲染完成后才能生成'}
        >
          {drawing ? '正在画三维…' : exporting.isPending ? '正在生成…' : '生成展陈方案 PPT'}
        </button>
      </div>
      <div className="display-pictures">
        <figure>
          <figcaption>平面图：编号按“离入口最近的一排起、每排从左到右”</figcaption>
          <div className="plan-marks">
            <PlanView
              svgRef={planRef}
              space={space}
              shopType={project.shopType}
              layout={layout}
              assets={assets}
              numbers={NO_NUMBERS}
              title={`${node.name} 展陈平面`}
            />
            {planMarks.map((m) => (
              <span
                key={m.id}
                className={`picture-mark static${m.tone === 'side' ? ' side' : ''}`}
                style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
              >
                {m.label}
              </span>
            ))}
          </div>
        </figure>
        <figure>
          <figcaption>
            效果图：标签由视角自动算出
            <select
              aria-label="选择视角"
              value={shown?.cameraId ?? ''}
              onChange={(event) => setViewId(event.target.value)}
            >
              {data.views.map((v) => (
                <option key={v.cameraId} value={v.cameraId}>
                  {v.name}（{Object.keys(v.marks).length} 张桌）
                </option>
              ))}
            </select>
          </figcaption>
          {shown?.imageUrl ? (
            <MarkedPicture
              src={shown.imageUrl}
              alt={`${shown.name} 效果图`}
              marks={Object.entries(shown.marks).map(([label, m]) => ({
                id: label,
                label,
                x: m.x,
                y: m.y,
              }))}
            />
          ) : (
            <p className="notice">这个视角还没有渲染图。</p>
          )}
        </figure>
      </div>
      <details className="display-slots" open>
        <summary>各桌陈列内容（可逐位修改，自动保存）</summary>
        <SlotTable
          rules={rules.data.rules}
          photos={rules.data.photos}
          si={node.siStyle ?? project.siStyle}
          tables={data.tables}
          edits={data.edits}
          onChange={edit}
          disabled={save.isPending}
        />
      </details>
      {data.exports.length > 0 && (
        <ol className="display-exports">
          {data.exports.map((e) => (
            <li key={e.createdAt}>
              <span className="hint">
                {new Date(e.createdAt).toLocaleString('zh-CN', { hour12: false })} · 规则{' '}
                {e.ruleVersion}
              </span>
              <a className="button primary" href={e.pptx.url} download={e.pptx.name}>
                下载 PPT
              </a>
              <a href={e.xlsx.url} download={e.xlsx.name}>
                展陈清单 Excel（{sizeText(e.xlsx.bytes)}）
              </a>
            </li>
          ))}
        </ol>
      )}
      <ErrorMessage error={error ?? save.error ?? exporting.error} />
    </div>
  )
}
