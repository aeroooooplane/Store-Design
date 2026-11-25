import { useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  PLAN_STRATEGY_LABELS,
  RENDER_SIZE,
  SHOP_TYPE_LABELS,
  deliveryLegend,
  mToMm,
  planLayout,
  rectangleSpace,
  safeFileName,
} from '@store/shared'
import type { Asset, GeneratedStrategy, PlannerCatalog, Project } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { Viewer3D } from '../viewer3d/Viewer3D.tsx'
import type { Viewer3DHandle } from '../viewer3d/Viewer3D.tsx'
import { standaloneSvg } from '../workbench/plan-export.ts'
import { PlanView } from '../workbench/PlanView.tsx'
import { useProject } from './queries.ts'
import './pilot-layout.css'

const strategies = ['max', 'area', 'min'] as const
const assets = new Map<string, Asset>()

// Simple solid geometry for the trial. These entries refer to no resource-library file.
const catalog: PlannerCatalog = {
  island: [
    {
      id: 'asset-1',
      name: '示例中岛桌',
      function: 'island_table',
      footprint: { w: 1.6, d: 0.8, h: 0.9 },
      front: '+Z',
    },
  ],
  cashier: [
    {
      id: 'asset-2',
      name: '示例收银台',
      function: 'cashier',
      footprint: { w: 1.2, d: 0.65, h: 1 },
      front: '+Z',
    },
  ],
  cabinet: [
    {
      id: 'asset-3',
      name: '示例配件柜',
      function: 'accessory_cabinet',
      footprint: { w: 1.2, d: 0.42, h: 2.1 },
      front: '+Z',
    },
  ],
  sideCabinet: [
    {
      id: 'asset-4',
      name: '示例边柜',
      function: 'side_cabinet',
      footprint: { w: 1.2, d: 0.5, h: 1.3 },
      front: '+Z',
    },
  ],
}

function download(url: string, name: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
}

function downloadFile(content: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  download(url, name)
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export function PilotLayoutPage() {
  const { projectId = '' } = useParams()
  const project = useProject(projectId)

  return (
    <main className="page pilot-layout">
      <ErrorMessage error={project.error} />
      {project.data?.deletedAt ? (
        <p className="notice">项目在回收站中，恢复后可试排。</p>
      ) : project.data ? (
        <PilotLayout key={project.data.id} project={project.data} />
      ) : !project.error ? (
        <p className="notice" role="status">
          正在载入项目…
        </p>
      ) : null}
    </main>
  )
}

function PilotLayout({ project }: { project: Project }) {
  const [dimensions, setDimensions] = useState({ width: 10, depth: 8, height: 3.2 })
  const [space, setSpace] = useState(() => rectangleSpace(10, 8, 3.2))
  const [strategy, setStrategy] = useState<GeneratedStrategy>('area')
  const [view, setView] = useState<'plan' | '3d'>('plan')
  const [ready, setReady] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<unknown>(null)
  const plan = useRef<SVGSVGElement>(null)
  const viewer = useRef<Viewer3DHandle>(null)
  const candidate = useMemo(
    () => planLayout({ space, shopType: project.shopType, strategy, catalog }),
    [space, project.shopType, strategy],
  )
  const legend = deliveryLegend(candidate.layout.items, assets)
  const flagged = new Set(candidate.issues.flatMap((issue) => issue.itemIds ?? []))
  const filename = safeFileName(project.name + ' 试排 ' + PLAN_STRATEGY_LABELS[strategy])

  async function renderCurrentView() {
    if (!viewer.current) return
    setRenderError(null)
    setRendering(true)
    try {
      const { width, height } = RENDER_SIZE
      const [url] = await viewer.current.renderViews(
        [viewer.current.currentView()],
        width,
        height,
        'material',
      )
      if (!url) throw new Error('三维视图暂时无法导出。')
      download(url, filename + '.png')
    } catch (error) {
      setRenderError(error)
    } finally {
      setRendering(false)
    }
  }

  function downloadMaterials() {
    const rows = legend.entries.map(({ no, name, size, count }) =>
      [no, name, mToMm(size.w), mToMm(size.d), mToMm(size.h), count].join(','),
    )
    downloadFile(
      '\ufeff' + ['编号,示例道具,宽(mm),深(mm),高(mm),数量', ...rows].join('\r\n'),
      'text/csv;charset=utf-8',
      filename + ' 物料.csv',
    )
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>方案试排</h1>
          <p>
            {project.name} · {SHOP_TYPE_LABELS[project.shopType]}
          </p>
        </div>
        <Link to={'/projects/' + project.id}>返回项目</Link>
      </header>
      <p className="notice">
        仅使用虚构空间和示例道具。试排在浏览器内运行，离开前可下载平面图、三维图和物料清单。
      </p>
      <form
        className="create-form pilot-layout-form"
        aria-label="矩形铺位尺寸"
        onSubmit={(event) => {
          event.preventDefault()
          setSpace(rectangleSpace(dimensions.width, dimensions.depth, dimensions.height))
        }}
      >
        {(
          [
            ['width', '面宽（米）', 3, 30],
            ['depth', '进深（米）', 3, 30],
            ['height', '层高（米）', 1.5, 10],
          ] as const
        ).map(([key, label, min, max]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={min}
              max={max}
              step="0.1"
              required
              value={Number.isFinite(dimensions[key]) ? dimensions[key] : ''}
              onChange={(event) =>
                setDimensions({ ...dimensions, [key]: event.target.valueAsNumber })
              }
            />
          </label>
        ))}
        <button className="primary" type="submit">
          生成方案
        </button>
      </form>

      <div className="pilot-layout-tools">
        <label>
          排布策略
          <select
            value={strategy}
            onChange={(event) => setStrategy(event.target.value as GeneratedStrategy)}
          >
            {strategies.map((option) => (
              <option key={option} value={option}>
                {PLAN_STRATEGY_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>查看方案</legend>
          <button
            type="button"
            aria-pressed={view === 'plan'}
            onClick={() => {
              setReady(false)
              setView('plan')
            }}
          >
            平面图
          </button>
          <button type="button" aria-pressed={view === '3d'} onClick={() => setView('3d')}>
            三维图
          </button>
        </fieldset>
        {view === 'plan' ? (
          <button
            type="button"
            onClick={() => {
              if (plan.current)
                downloadFile(standaloneSvg(plan.current, 1800), 'image/svg+xml', filename + '.svg')
            }}
          >
            下载平面图
          </button>
        ) : (
          <button
            type="button"
            disabled={!ready || rendering}
            onClick={() => void renderCurrentView()}
          >
            {rendering ? '正在出图…' : '下载当前三维图'}
          </button>
        )}
        <button type="button" disabled={!legend.entries.length} onClick={downloadMaterials}>
          下载物料清单
        </button>
      </div>
      <ErrorMessage error={renderError} />

      <section className="pilot-layout-drawing" aria-label="方案图">
        {view === 'plan' ? (
          <PlanView
            svgRef={plan}
            title="试排平面图"
            space={space}
            shopType={project.shopType}
            layout={candidate.layout}
            issues={candidate.issues}
            numbers={legend.numbers}
          />
        ) : (
          <Viewer3D
            ref={viewer}
            title="试排三维图"
            space={space}
            shopType={project.shopType}
            layout={candidate.layout}
            assets={assets}
            look="material"
            siStyle={project.siStyle}
            market={project.market}
            selectedId={null}
            flaggedIds={flagged}
            onSelect={() => undefined}
            onReady={() => setReady(true)}
          />
        )}
      </section>
      {candidate.issues.length > 0 && (
        <ul className="notice" aria-label="排布检查">
          {candidate.issues.map((issue, index) => (
            <li key={index}>{issue.message}</li>
          ))}
        </ul>
      )}
      {!legend.entries.length && (
        <p className="notice">当前尺寸下没有可摆放的示例道具，可调整尺寸或更换策略。</p>
      )}
      {legend.entries.length > 0 && (
        <table className="projects" aria-label="示例物料清单">
          <thead>
            <tr>
              <th>编号</th>
              <th>示例道具</th>
              <th>数量</th>
            </tr>
          </thead>
          <tbody>
            {legend.entries.map((item) => (
              <tr key={item.no}>
                <td>{item.no}</td>
                <td>{item.name}</td>
                <td>{item.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
