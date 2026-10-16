import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  DISPLAY_ORIENTATION_LABELS,
  ENTRANCE_SIDES,
  ENTRANCE_SIDE_LABELS,
  MARKETS,
  MARKET_LABELS,
  SI_STYLES,
  planTaskTables,
} from '@store/shared'
import type {
  DisplayEdits,
  DisplayTask,
  DisplayTaskState,
  TaskTable,
  VectorContent,
} from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import {
  canvasToPng,
  extractVector,
  openPdf,
  renderPage,
  renderThumbnail,
} from '../recognition/pdf-extract.ts'
import { MarkedPicture } from './MarkedPicture.tsx'
import { PptViewsSelect } from './PptViewsSelect.tsx'
import { usePptViews } from './pptViews.ts'
import { tableShots } from './table3d/shots.ts'
import type { PictureMark } from './MarkedPicture.tsx'
import { SlotTable } from './SlotTable.tsx'
import {
  useDetectTables,
  useDisplayRules,
  useDisplayTask,
  useExportDisplayTask,
  useUpdateDisplayTask,
  useUploadTaskPicture,
} from './queries.ts'
import { guessPages, guessRoles, pictureType } from './sources.ts'

interface PdfSource {
  name: string
  doc: PDFDocumentProxy
  thumbnails: string[]
  plan: number | null
  render: number | null
}

interface ImageSource {
  plan: File | null
  render: File | null
  files: File[]
}

type Tool = 'island' | 'side' | null

const sizeText = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

/** A display task (workflow 2): upload the plan and render, check the tables, export the PPT. */
export function DisplayTaskPage() {
  const { taskId = '' } = useParams()
  const task = useDisplayTask(taskId)
  const rules = useDisplayRules()
  if (task.error || rules.error) {
    return (
      <main className="page">
        <ErrorMessage error={task.error ?? rules.error} />
        <Link to="/display">返回展陈方案列表</Link>
      </main>
    )
  }
  if (!task.data || !rules.data) {
    return (
      <main className="page">
        <p className="notice">正在载入…</p>
      </main>
    )
  }
  return (
    <TaskEditor
      key={task.data.id}
      task={task.data}
      rules={rules.data.rules}
      photos={rules.data.photos}
      ruleVersion={rules.data.version}
    />
  )
}

interface TaskEditorProps {
  task: DisplayTask
  rules: NonNullable<ReturnType<typeof useDisplayRules>['data']>['rules']
  photos: NonNullable<ReturnType<typeof useDisplayRules>['data']>['photos']
  ruleVersion: string
}

function TaskEditor({ task, rules, photos, ruleVersion }: TaskEditorProps) {
  const update = useUpdateDisplayTask(task.id)
  const upload = useUploadTaskPicture(task.id)
  const detect = useDetectTables(task.id)
  const exporting = useExportDisplayTask(task.id)
  const [pptViews, setPptViews] = usePptViews()
  const [drawing, setDrawing] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const [pdf, setPdf] = useState<PdfSource | null>(null)
  const [images, setImages] = useState<ImageSource | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [draft, setDraft] = useState<DisplayTaskState>(task.state)
  const [dirty, setDirty] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>(null)

  // A saved or re-detected task replaces the draft unless the user has unsaved changes.
  const revision = task.revision
  const saved = useRef(revision)
  useEffect(() => {
    if (saved.current === revision) return
    saved.current = revision
    if (!dirty) setDraft(task.state)
  }, [revision, dirty, task.state])

  const tables = useMemo(
    () => planTaskTables(rules, { market: task.market, plan: task.plan, state: draft }),
    [rules, task.market, task.plan, draft],
  )
  const labelOf = useMemo(() => new Map(tables.map((t) => [t.sourceId, t.label])), [tables])
  const change = (next: DisplayTaskState) => {
    setDraft(next)
    setDirty(true)
  }
  const setTables = (list: TaskTable[]) => change({ ...draft, tables: list })
  const setEdits = (edits: DisplayEdits) => change({ ...draft, edits })
  const moveTable = (id: string, patch: Partial<TaskTable>) =>
    setTables(draft.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  async function saveDraft() {
    if (!dirty) return
    await update.mutateAsync({ state: draft })
    setDirty(false)
  }

  async function choose(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    const list = [...files]
    const pdfFile = list.find((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf')
    try {
      if (pdfFile) {
        setBusy('正在读取 PDF…')
        const doc = await openPdf(await pdfFile.arrayBuffer())
        const guess = await guessPages(doc)
        const thumbnails: string[] = []
        for (let n = 1; n <= Math.min(doc.numPages, 40); n++) {
          thumbnails.push((await renderThumbnail(doc, n)).toDataURL('image/png'))
        }
        setPdf({ name: pdfFile.name, doc, thumbnails, plan: guess.plan, render: guess.render })
        setImages(null)
      } else {
        const pictures = list.filter((f) => pictureType(f))
        if (!pictures.length) throw new Error('请选择 PDF，或 PNG / JPG 图片')
        const roles = guessRoles(pictures)
        setImages({ ...roles, files: pictures })
        setPdf(null)
      }
    } catch (caught) {
      setError(caught)
    } finally {
      setBusy(null)
    }
  }

  /** Uploads the chosen plan and render, then finds the tables. */
  async function recognise() {
    setError(null)
    try {
      let vector: VectorContent | undefined
      if (pdf) {
        if (!pdf.plan) throw new Error('请在缩略图中选出平面图页')
        setBusy('正在上传平面图…')
        const planCanvas = await renderPage(pdf.doc, pdf.plan)
        vector = await extractVector(pdf.doc, pdf.plan)
        await upload.mutateAsync({
          which: 'plan',
          blob: await canvasToPng(planCanvas),
          contentType: 'image/png',
          originalName: pdf.name,
          page: pdf.plan,
        })
        if (pdf.render) {
          setBusy('正在上传效果图…')
          const renderCanvas = await renderPage(pdf.doc, pdf.render, 2000)
          await upload.mutateAsync({
            which: 'render',
            blob: await canvasToPng(renderCanvas),
            contentType: 'image/png',
            originalName: pdf.name,
            page: pdf.render,
          })
        }
      } else if (images?.plan) {
        for (const which of ['plan', 'render'] as const) {
          const file = images[which]
          const type = file ? pictureType(file) : null
          if (!file || !type) continue
          setBusy(which === 'plan' ? '正在上传平面图…' : '正在上传效果图…')
          await upload.mutateAsync({
            which,
            blob: file,
            contentType: type,
            originalName: file.name,
          })
        }
      } else if (!task.plan) {
        throw new Error('请先选择门店图纸 PDF，或平面图与效果图')
      }
      setBusy('正在识别中岛桌与边桌…')
      const next = await detect.mutateAsync({ ...(vector ? { vector } : {}), useModel: true })
      setDraft(next.state)
      setDirty(false)
    } catch (caught) {
      setError(caught)
    } finally {
      setBusy(null)
    }
  }

  async function makePpt() {
    setError(null)
    try {
      await saveDraft()
      setDrawing(true)
      const tables3d =
        pptViews === 'plan'
          ? []
          : await tableShots(tables, {
              rules,
              photos,
              si: task.siStyle,
              end: draft.edits.landscapeEnd,
            })
      setDrawing(false)
      await exporting.mutateAsync({ views: pptViews, tables3d })
    } catch (caught) {
      setError(caught)
    } finally {
      setDrawing(false)
    }
  }

  const planMarks: PictureMark[] = draft.tables.map((t) => ({
    id: t.id,
    label: labelOf.get(t.id) ?? '?',
    x: t.x,
    y: t.y,
    tone: t.kind,
  }))
  const renderMarks: PictureMark[] = draft.tables.flatMap((t) =>
    t.render
      ? [{ id: t.id, label: labelOf.get(t.id) ?? '?', x: t.render.x, y: t.render.y, tone: t.kind }]
      : [],
  )
  const islands = tables.filter((t) => t.kind === 'island')
  const orientation = islands[0]?.orientation
  const working = busy !== null || upload.isPending || detect.isPending
  const selectedTable = draft.tables.find((t) => t.id === selected)

  return (
    <main className="page display-page">
      <header className="page-header">
        <h1>门店中岛桌展陈方案</h1>
        <span className="page-header-end">
          <p>先识别图纸，再校准平面图和效果图上的桌子编号，最后生成 PPT · 展陈规则 {ruleVersion}</p>
          <Link to="/display">展陈方案列表</Link>
          <Link to="/">项目</Link>
        </span>
      </header>

      <div className="display-layout">
        <ol className="display-steps" aria-label="步骤">
          <li className={task.plan ? 'done' : 'current'}>
            <strong>输入</strong>
            <span>上传门店图纸 PDF，或平面图与效果图</span>
          </li>
          <li className={draft.tables.length ? 'done' : task.plan ? 'current' : ''}>
            <strong>校准</strong>
            <span>拖动编号到中岛桌中心，核对入口与横竖版</span>
          </li>
          <li className={task.exports.length ? 'done' : draft.tables.length ? 'current' : ''}>
            <strong>输出</strong>
            <span>生成可编辑的展陈方案 PPT 与清单</span>
          </li>
        </ol>

        <div className="display-main">
          <section className="wb-card display-card" aria-label="基本信息">
            <div className="display-fields">
              <label>
                <span>门店名称</span>
                <input
                  defaultValue={task.name}
                  onBlur={(event) => {
                    const name = event.target.value.trim()
                    if (name && name !== task.name) update.mutate({ name })
                  }}
                />
              </label>
              <label>
                <span>市场</span>
                <select
                  value={task.market}
                  onChange={(event) =>
                    update.mutate({ market: event.target.value as DisplayTask['market'] })
                  }
                >
                  {MARKETS.map((m) => (
                    <option key={m} value={m}>
                      {MARKET_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>SI 版本（决定托盘照片和桌体）</span>
                <select
                  value={task.siStyle}
                  onChange={(event) =>
                    update.mutate({ siStyle: event.target.value as DisplayTask['siStyle'] })
                  }
                >
                  {SI_STYLES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="wb-card display-card" aria-label="输入文件">
            <h2>输入文件</h2>
            <div className="toolbar">
              <button type="button" onClick={() => fileInput.current?.click()} disabled={working}>
                选择文件
              </button>
              <button type="button" onClick={() => folderInput.current?.click()} disabled={working}>
                选择文件夹
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void recognise()}
                disabled={working || (!pdf && !images && !task.plan)}
              >
                {busy ?? '识别并校准'}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,image/png,image/jpeg"
                multiple
                hidden
                onChange={(event) => {
                  void choose(event.target.files)
                  event.target.value = ''
                }}
              />
              <input
                ref={folderInput}
                type="file"
                multiple
                hidden
                {...{ webkitdirectory: '' }}
                onChange={(event) => {
                  void choose(event.target.files)
                  event.target.value = ''
                }}
              />
            </div>
            <p className="hint">
              可以上传整套门店图纸
              PDF（自动挑出平面图页和效果图页，可在缩略图中改选），也可以上传平面图和效果图两张图片。平面图质量需与施工图相当。
            </p>
            {pdf && (
              <>
                <p className="hint">
                  {pdf.name} · 共 {pdf.doc.numPages} 页。点击缩略图下方的按钮设为平面图或效果图。
                </p>
                <ol className="pdf-pages">
                  {pdf.thumbnails.map((src, i) => {
                    const n = i + 1
                    return (
                      <li
                        key={n}
                        className={
                          n === pdf.plan ? 'is-plan' : n === pdf.render ? 'is-render' : undefined
                        }
                      >
                        <img src={src} alt={`第 ${n} 页`} />
                        <span className="pdf-page-actions">
                          <span>第 {n} 页</span>
                          <button
                            type="button"
                            aria-pressed={n === pdf.plan}
                            onClick={() => setPdf({ ...pdf, plan: n })}
                          >
                            平面图
                          </button>
                          <button
                            type="button"
                            aria-pressed={n === pdf.render}
                            onClick={() => setPdf({ ...pdf, render: pdf.render === n ? null : n })}
                          >
                            效果图
                          </button>
                        </span>
                      </li>
                    )
                  })}
                </ol>
              </>
            )}
            {images && (
              <div className="display-fields">
                {(['plan', 'render'] as const).map((which) => (
                  <label key={which}>
                    <span>{which === 'plan' ? '平面图' : '效果图（可不选）'}</span>
                    <select
                      value={images[which]?.name ?? ''}
                      onChange={(event) =>
                        setImages({
                          ...images,
                          [which]: images.files.find((f) => f.name === event.target.value) ?? null,
                        })
                      }
                    >
                      <option value="">（无）</option>
                      {images.files.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.name}（{sizeText(f.size)}）
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
            {task.plan && !pdf && !images && (
              <p className="hint">
                已上传平面图 {task.plan.originalName ?? ''}
                {task.plan.page ? ` 第 ${task.plan.page} 页` : ''}
                {task.render
                  ? `，效果图 ${task.render.originalName ?? ''}${task.render.page ? ` 第 ${task.render.page} 页` : ''}`
                  : '，未上传效果图'}
                。可重新选择文件后再次识别。
              </p>
            )}
          </section>

          {task.plan && (
            <section className="wb-card display-card" aria-label="校准标识">
              <div className="display-card-head">
                <h2>校准标识</h2>
                <span className="hint">
                  {islands.length} 张中岛桌
                  {orientation ? `（${DISPLAY_ORIENTATION_LABELS[orientation]}）` : ''}
                  {tables.length > islands.length
                    ? ` · 边桌 ${tables.length - islands.length} 张`
                    : ''}
                </span>
                <button
                  type="button"
                  onClick={() => void saveDraft()}
                  disabled={!dirty || update.isPending}
                >
                  {update.isPending ? '正在保存…' : dirty ? '保存校准' : '已保存'}
                </button>
              </div>
              <div className="toolbar">
                <label className="inline-field">
                  主入口
                  <select
                    value={draft.entrance}
                    onChange={(event) =>
                      change({
                        ...draft,
                        entrance: event.target.value as DisplayTaskState['entrance'],
                      })
                    }
                  >
                    {ENTRANCE_SIDES.map((s) => (
                      <option key={s} value={s}>
                        在图的{ENTRANCE_SIDE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
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
                      aria-pressed={draft.edits.orientation === value}
                      onClick={() => setEdits({ ...draft.edits, orientation: value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {orientation === 'landscape' && (
                  <label className="inline-field">
                    端头
                    <select
                      value={draft.edits.landscapeEnd}
                      onChange={(event) =>
                        setEdits({
                          ...draft.edits,
                          landscapeEnd: event.target.value as 'left' | 'right',
                        })
                      }
                    >
                      <option value="left">统一在左侧</option>
                      <option value="right">统一在右侧</option>
                    </select>
                  </label>
                )}
                <div className="tabs" role="group" aria-label="增加桌子">
                  <button
                    type="button"
                    aria-pressed={tool === 'island'}
                    onClick={() => setTool(tool === 'island' ? null : 'island')}
                  >
                    增加中岛桌
                  </button>
                  <button
                    type="button"
                    aria-pressed={tool === 'side'}
                    onClick={() => setTool(tool === 'side' ? null : 'side')}
                  >
                    增加边桌
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!selectedTable}
                  onClick={() => {
                    setTables(draft.tables.filter((t) => t.id !== selected))
                    setSelected(null)
                  }}
                >
                  减少桌子{selectedTable ? `（${labelOf.get(selectedTable.id) ?? ''}）` : ''}
                </button>
              </div>
              {tool && (
                <p className="hint">
                  在平面图上点击要增加{tool === 'island' ? '中岛桌' : '边桌'}的位置。
                </p>
              )}
              {draft.detection && (
                <ul className="display-notes">
                  {draft.detection.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
              <div className="display-pictures">
                <figure>
                  <figcaption>平面图：拖动编号点到中岛桌中心</figcaption>
                  <MarkedPicture
                    src={task.plan.url}
                    alt="平面图"
                    marks={planMarks}
                    selectedId={selected}
                    onSelect={setSelected}
                    onMove={(id, x, y) => moveTable(id, { x, y })}
                    onPick={(x, y) => {
                      if (!tool) return
                      const id = `m${Date.now().toString(36)}`
                      setTables([
                        ...draft.tables,
                        { id, kind: tool, x, y, w: 0, h: 0, render: null, label: null },
                      ])
                      setSelected(id)
                      setTool(null)
                    }}
                    className={tool ? 'picking' : undefined}
                  />
                </figure>
                {task.render ? (
                  <figure>
                    <figcaption>
                      效果图：拖动编号到对应的桌子上
                      {selectedTable && !selectedTable.render
                        ? `；点击图中位置放置 ${labelOf.get(selectedTable.id) ?? ''} 桌`
                        : ''}
                    </figcaption>
                    <MarkedPicture
                      src={task.render.url}
                      alt="效果图"
                      marks={renderMarks}
                      selectedId={selected}
                      onSelect={setSelected}
                      onMove={(id, x, y) => moveTable(id, { render: { x, y } })}
                      onPick={(x, y) => {
                        if (selectedTable && !selectedTable.render)
                          moveTable(selectedTable.id, { render: { x, y } })
                      }}
                    />
                  </figure>
                ) : (
                  <p className="notice">没有效果图：PPT 中效果图位置会显示“暂无效果图”。</p>
                )}
              </div>
              {tables.length > 0 && (
                <details className="display-slots">
                  <summary>各桌陈列内容（按展陈规则 {ruleVersion}，可逐位修改）</summary>
                  <SlotTable
                    rules={rules}
                    photos={photos}
                    si={task.siStyle}
                    tables={tables}
                    edits={draft.edits}
                    onChange={setEdits}
                  />
                </details>
              )}
            </section>
          )}

          <section className="wb-card display-card" aria-label="输出结果">
            <div className="display-card-head">
              <h2>输出结果</h2>
              <span className="hint">{task.exports.length} 个 PPT</span>
              <PptViewsSelect
                value={pptViews}
                onChange={setPptViews}
                disabled={exporting.isPending}
              />
              <button
                type="button"
                className="primary"
                onClick={() => void makePpt()}
                disabled={drawing || exporting.isPending || working || !draft.tables.length}
              >
                {drawing ? '正在画三维…' : exporting.isPending ? '正在生成…' : '生成 PPT'}
              </button>
            </div>
            {task.exports.length === 0 ? (
              <p className="hint">生成后可下载可编辑的展陈方案 PPT 和展陈清单 Excel。</p>
            ) : (
              <ol className="display-exports">
                {task.exports.map((e) => (
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
          </section>
          <ErrorMessage error={error ?? update.error ?? exporting.error} />
        </div>
      </div>
    </main>
  )
}
