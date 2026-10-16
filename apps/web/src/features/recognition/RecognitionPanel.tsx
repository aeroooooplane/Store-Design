import { useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  ITEM_SOURCE_LABELS,
  RECOGNITION_MIN_CONFIDENCE,
  rotatedFootprint,
  settleNearQuarter,
} from '@store/shared'
import type {
  Asset,
  DraftItem,
  Layout,
  LayoutItem,
  PlanUpload,
  RecognitionDraft,
  RecognitionRun,
  RecognizeRequest,
  Space,
  VectorContent,
} from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { SpaceEditor } from '../workbench/SpaceEditor.tsx'
import { EMPTY_TRACE, PlanImage } from './PlanImage.tsx'
import type { ImageTool, Trace } from './PlanImage.tsx'
import { scaleFromPoints, toPicturePoints, toTracedSpace } from './trace.ts'
import type { EdgeKind, Px, TracedSpace } from './trace.ts'
import type { PdfPage } from './pdf-extract.ts'
import { useConfirmRun, useRecognize, useUploadPlan } from './queries.ts'

const DEFAULT_HEIGHT_MM = 3200

interface PdfSource {
  doc: PDFDocumentProxy
  pages: PdfPage[]
  thumbnails: Record<number, string>
  name: string
}

interface RecognitionPanelProps {
  projectId: string
  assets: Asset[]
  onCreated: (nodeId: string) => void
  onCancel?: (() => void) | undefined
}

/** Props the user keeps become layout items of the confirmed space (outside ones never do). */
function toLayout(
  items: DraftItem[],
  choices: Map<string, string | null>,
  assets: Map<string, Asset>,
): Layout {
  const layoutItems: LayoutItem[] = items
    .filter((item) => item.source !== 'outside')
    .map((item) => {
      const assetId = choices.has(item.ref) ? (choices.get(item.ref) ?? null) : item.assetId
      const asset = assetId ? assets.get(assetId) : undefined
      // Within 3° of a quarter turn a recognised angle is that turn; others are kept.
      const rotation = settleNearQuarter(item.rotation)
      const size = asset ? rotatedFootprint(asset, rotation) : null
      return {
        id: item.ref,
        assetId: asset?.id ?? null,
        function: asset?.function ?? item.function,
        name: asset?.name ?? item.label,
        cx: item.cx,
        cz: item.cz,
        rotation,
        w: size?.w ?? item.w,
        d: size?.d ?? item.d,
        h: asset?.footprint.h ?? 1,
        placeholder: !asset?.placeable,
        locked: false,
      }
    })
  return { schemaVersion: 3, items: layoutItems, planning: null }
}

/**
 * The space to check and confirm: the outline traced by hand when there is one (columns kept
 * from the recognised space), otherwise what was recognised.
 */
function toSpace(
  draft: RecognitionDraft | null,
  traced: TracedSpace | null,
  heightMm: number,
): Space | undefined {
  const height = draft?.space?.height ?? heightMm / 1000
  if (traced) {
    return {
      schemaVersion: 1,
      boundary: traced.boundary,
      height,
      entrances: traced.entrances,
      openEdges: traced.openEdges,
      obstacles: draft?.space?.obstacles ?? [],
      calibration: draft?.scale
        ? {
            method: draft.scale.method,
            reference: draft.scale.reference,
            verified: draft.scale.verified,
          }
        : { method: 'manual', reference: '原图描点，两点指定已知长度', verified: false },
    }
  }
  if (!draft?.space) return undefined
  const method = draft.scale?.method ?? 'manual'
  return {
    schemaVersion: 1,
    boundary: draft.space.boundary,
    height,
    entrances: draft.space.entrances,
    openEdges: [],
    obstacles: draft.space.obstacles,
    calibration: draft.scale
      ? { method, reference: draft.scale.reference, verified: draft.scale.verified }
      : null,
  }
}

/**
 * A recognised boundary as a closed trace to edit, its entrances marked on the edges they lie
 * along (within a few pixels).
 */
function traceFromDraft(draft: RecognitionDraft | null): Trace | null {
  const scale = draft?.scale
  const space = draft?.space
  if (!scale || !space || space.boundary.length < 3) return null
  const points = toPicturePoints(space.boundary, scale.mmPerPixel, scale.originPx)
  const entrances = space.entrances.map((e) =>
    toPicturePoints([e.a, e.b], scale.mmPerPixel, scale.originPx),
  )
  const near = (p: Px, a: Px, b: Px) => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len))
    return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)) <= 3
  }
  const kinds = points.map((a, i): EdgeKind => {
    const b = points[(i + 1) % points.length] as Px
    const mid: Px = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    return entrances.some(([ea, eb]) => ea && eb && near(mid, ea, eb)) ? 'entrance' : 'wall'
  })
  return { points, closed: true, kinds, arc: false }
}

/**
 * Upload a plan sketch (picture, or a page of a PDF), recognise it, check the result on the
 * picture, correct the space and keep the props; confirming makes the root space node.
 */
export function RecognitionPanel({
  projectId,
  assets,
  onCreated,
  onCancel,
}: RecognitionPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [pdf, setPdf] = useState<PdfSource | null>(null)
  const [preparing, setPreparing] = useState<string | null>(null)
  const [upload, setUpload] = useState<PlanUpload | null>(null)
  const [vector, setVector] = useState<VectorContent | null>(null)
  const [tool, setTool] = useState<ImageTool>('none')
  const [crop, setCrop] = useState<RecognizeRequest['crop'] | null>(null)
  const [points, setPoints] = useState<{ a: [number, number]; b: [number, number] } | null>(null)
  const [knownMm, setKnownMm] = useState(0)
  const [useModel, setUseModel] = useState(false)
  const [run, setRun] = useState<RecognitionRun | null>(null)
  const [attempted, setAttempted] = useState<RecognitionRun | null>(null)
  const [heightMm, setHeightMm] = useState(DEFAULT_HEIGHT_MM)
  const [choices, setChoices] = useState<Map<string, string | null>>(new Map())
  const [localError, setLocalError] = useState<unknown>(null)
  /** The boundary traced on the picture, and what it became once applied (in metres). */
  const [trace, setTrace] = useState<Trace>(EMPTY_TRACE)
  const [traced, setTraced] = useState<TracedSpace | null>(null)
  const [editorKey, setEditorKey] = useState(0)

  const uploadPlan = useUploadPlan(projectId)
  const recognize = useRecognize(upload?.id ?? '')
  const confirm = useConfirmRun(projectId, upload?.id ?? '')
  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets])
  const draft = run?.draft ?? null

  async function choose(file: File) {
    setLocalError(null)
    setRun(null)
    setAttempted(null)
    setVector(null)
    setCrop(null)
    setPoints(null)
    setPdf(null)
    setTrace(EMPTY_TRACE)
    setTraced(null)
    try {
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        setPreparing('正在打开 PDF…')
        const pdfjs = await import('./pdf-extract.ts')
        const doc = await pdfjs.openPdf(await file.arrayBuffer())
        const pages = await pdfjs.listPages(doc)
        const thumbnails: Record<number, string> = {}
        for (const page of pages.slice(0, 40)) {
          thumbnails[page.number] = (await pdfjs.renderThumbnail(doc, page.number)).toDataURL()
        }
        setPdf({ doc, pages, thumbnails, name: file.name })
        setUpload(null)
        if (pages.length === 1) await pickPage({ doc, pages, thumbnails, name: file.name }, 1)
      } else if (file.type === 'image/png' || file.type === 'image/jpeg') {
        setPreparing('正在上传…')
        const uploaded = await uploadPlan.mutateAsync({
          blob: file,
          contentType: file.type,
          originalName: file.name,
        })
        setUpload(uploaded)
      } else {
        throw new Error('只支持 JPG、PNG 或 PDF')
      }
    } catch (error) {
      setLocalError(error)
    } finally {
      setPreparing(null)
    }
  }

  /** Renders the page to a picture for upload and pulls its vector content for local reading. */
  async function pickPage(source: PdfSource, pageNumber: number) {
    setLocalError(null)
    setRun(null)
    setCrop(null)
    setPoints(null)
    setTrace(EMPTY_TRACE)
    setTraced(null)
    try {
      setPreparing(`正在转换第 ${pageNumber} 页…`)
      const pdfjs = await import('./pdf-extract.ts')
      const [canvas, content] = await Promise.all([
        pdfjs.renderPage(source.doc, pageNumber),
        pdfjs.extractVector(source.doc, pageNumber),
      ])
      const blob = await pdfjs.canvasToPng(canvas)
      setVector(content.texts.length || content.lines.length ? content : null)
      const uploaded = await uploadPlan.mutateAsync({
        blob,
        contentType: 'image/png',
        originalName: source.name,
        page: pageNumber,
      })
      setUpload(uploaded)
    } catch (error) {
      setLocalError(error)
    } finally {
      setPreparing(null)
    }
  }

  /** Millimetres per picture pixel: the recognised scale, else the two picked points. */
  const mmPerPixel = draft?.scale?.mmPerPixel ?? scaleFromPoints(points, knownMm)

  function toggleTrace() {
    if (tool === 'trace') {
      setTool('none')
      return
    }
    // Start from the recognised boundary when there is one, so it can be corrected.
    if (!trace.points.length) setTrace(traceFromDraft(draft) ?? EMPTY_TRACE)
    setTool('trace')
  }

  /** The traced outline into the space below (recognising first when nothing was run yet). */
  function applyTrace() {
    if (!trace.closed || !mmPerPixel) return
    const origin: Px = draft?.scale?.originPx ?? [
      Math.min(...trace.points.map((p) => p[0])),
      Math.min(...trace.points.map((p) => p[1])),
    ]
    setTraced(toTracedSpace(trace.points, trace.kinds, mmPerPixel, origin))
    setEditorKey((k) => k + 1)
    setTool('none')
    // Confirming needs a recognition run; a picture's local run records it, even if it fails.
    if (!run) void start()
  }

  async function start() {
    if (!upload) return
    setLocalError(null)
    const request: RecognizeRequest = {
      ...(vector && !useModel ? { vector } : {}),
      ...(useModel ? { method: 'llm' as const } : {}),
      ...(crop ? { crop } : {}),
      ...(points && knownMm > 0 ? { calibration: { a: points.a, b: points.b, mm: knownMm } } : {}),
    }
    try {
      const response = await recognize.mutateAsync(request)
      setRun(response.run)
      setAttempted(response.attempted)
      setChoices(new Map())
      setTool('none')
    } catch (error) {
      setLocalError(error)
    }
  }

  function submit(space: Space, name: string) {
    if (!run) return
    confirm.mutate(
      { runId: run.id, name, space, layout: toLayout(draft?.items ?? [], choices, assetMap) },
      { onSuccess: (created) => onCreated(created.node.id) },
    )
  }

  const sameFunction = (item: DraftItem) =>
    assets.filter(
      (a) =>
        !a.retired &&
        a.function === (item.assetId ? assetMap.get(item.assetId)?.function : item.function),
    )
  const initialSpace = toSpace(draft, traced, heightMm)
  const busy = preparing !== null || uploadPlan.isPending || recognize.isPending

  return (
    <section className="recognition" aria-label="上传简图识别">
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,application/pdf"
        hidden
        aria-label="选择简图文件"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void choose(file)
          e.target.value = ''
        }}
      />
      <div className="toolbar">
        <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
          {upload || pdf ? '换一张' : '选择简图（JPG / PNG / PDF）'}
        </button>
        {upload && (
          <span className="hint">
            {upload.originalName ?? '简图'}
            {upload.page ? ` 第 ${upload.page} 页` : ''} · {upload.width}×{upload.height} px
            {vector ? ' · 矢量图纸，可本地识别' : ' · 图片，需模型识别'}
          </span>
        )}
        {preparing && (
          <span className="hint" role="status">
            {preparing}
          </span>
        )}
      </div>
      <ErrorMessage error={localError ?? uploadPlan.error ?? recognize.error ?? confirm.error} />

      {pdf && pdf.pages.length > 1 && (
        <div className="pdf-pages" role="group" aria-label="选择页">
          {pdf.pages.map((page) => (
            <button
              key={page.number}
              type="button"
              className="pdf-page"
              aria-pressed={upload?.page === page.number}
              disabled={busy}
              onClick={() => void pickPage(pdf, page.number)}
            >
              {pdf.thumbnails[page.number] ? (
                <img src={pdf.thumbnails[page.number]} alt="" />
              ) : (
                <span className="camera-thumb-empty">第 {page.number} 页</span>
              )}
              <span>第 {page.number} 页</span>
            </button>
          ))}
        </div>
      )}

      {upload && (
        <div className="recognition-work">
          <div className="recognition-picture">
            <div className="toolbar">
              <button
                type="button"
                aria-pressed={tool === 'crop'}
                onClick={() => setTool(tool === 'crop' ? 'none' : 'crop')}
              >
                框选区域
              </button>
              {crop && (
                <button type="button" onClick={() => setCrop(null)}>
                  清除区域
                </button>
              )}
              <button
                type="button"
                aria-pressed={tool === 'calibrate'}
                onClick={() => setTool(tool === 'calibrate' ? 'none' : 'calibrate')}
              >
                指定已知长度
              </button>
              {points && (
                <label className="hint">
                  这段长度为
                  <input
                    type="number"
                    aria-label="已知长度（毫米）"
                    min={100}
                    step={10}
                    value={knownMm || ''}
                    onChange={(e) => setKnownMm(Number(e.target.value))}
                  />
                  mm
                </label>
              )}
              <button type="button" aria-pressed={tool === 'trace'} onClick={toggleTrace}>
                描边界
              </button>
              {tool === 'trace' && (
                <>
                  <button
                    type="button"
                    aria-pressed={trace.arc}
                    disabled={trace.closed || !trace.points.length}
                    onClick={() => setTrace({ ...trace, arc: !trace.arc })}
                  >
                    圆弧
                  </button>
                  <button
                    type="button"
                    disabled={!trace.points.length}
                    onClick={() => {
                      setTrace(EMPTY_TRACE)
                      setTraced(null)
                      setEditorKey((k) => k + 1)
                    }}
                  >
                    清空边界
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={!trace.closed || !mmPerPixel || busy}
                    title={
                      mmPerPixel ? undefined : '先用“指定已知长度”在图上量一段已知长度，定出比例'
                    }
                    onClick={applyTrace}
                  >
                    应用到空间
                  </button>
                  {!mmPerPixel && (
                    <span className="hint">还没有比例：先用“指定已知长度”量一段已知长度。</span>
                  )}
                </>
              )}
              <label className="hint">
                <input
                  type="checkbox"
                  checked={useModel}
                  onChange={(e) => setUseModel(e.target.checked)}
                />{' '}
                直接用模型识别
              </label>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void start()}
              >
                {recognize.isPending ? '正在识别…' : run ? '重新识别' : '识别'}
              </button>
            </div>
            <PlanImage
              url={upload.url}
              width={upload.width}
              height={upload.height}
              tool={tool}
              crop={crop}
              onCrop={setCrop}
              calibration={points}
              onCalibrate={setPoints}
              draft={draft}
              trace={trace}
              onTrace={setTrace}
              vector={vector}
            />
          </div>

          {run && (
            <div className="recognition-result">
              <h3>
                识别结果
                <span className={`tag ${run.status === 'succeeded' ? 'done' : ''}`}>
                  {run.method === 'local' ? '本地识别' : `模型 ${run.model}`}
                  {draft ? ` · 置信度 ${draft.confidence.toFixed(2)}` : ''}
                </span>
              </h3>
              {attempted && (
                <p className="hint">本地识别未通过（{attempted.error}），已改用模型。</p>
              )}
              {run.status === 'failed' && (
                <p className="error">
                  {run.error}
                  {draft && draft.confidence < RECOGNITION_MIN_CONFIDENCE
                    ? '。可以指定一段已知长度后重新识别，或勾选“直接用模型识别”。'
                    : ''}
                  {!traced ? ' 也可以点“描边界”，在原图上描出店铺边界。' : ''}
                </p>
              )}
              {(draft || traced) && (
                <>
                  {draft && draft.pending.length > 0 && (
                    <div className="recognition-pending">
                      <h4>待确认（{draft.pending.length}）</h4>
                      <ul>
                        {draft.pending.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {draft && draft.items.length > 0 && (
                    <table className="recognition-items" aria-label="识别到的道具">
                      <thead>
                        <tr>
                          <th>图上文字</th>
                          <th>分类</th>
                          <th>对应模型</th>
                          <th>说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draft.items.map((item) => (
                          <tr key={item.ref} className={item.source === 'outside' ? 'outside' : ''}>
                            <td>{item.label}</td>
                            <td>
                              <span className={`tag source-${item.source}`}>
                                {ITEM_SOURCE_LABELS[item.source]}
                              </span>
                            </td>
                            <td>
                              {item.source === 'outside' ? (
                                <span className="hint">不放入</span>
                              ) : (
                                <select
                                  aria-label={`${item.label} 对应模型`}
                                  value={
                                    choices.has(item.ref)
                                      ? (choices.get(item.ref) ?? '')
                                      : (item.assetId ?? '')
                                  }
                                  onChange={(e) =>
                                    setChoices(
                                      new Map(choices).set(item.ref, e.target.value || null),
                                    )
                                  }
                                >
                                  <option value="">占位方框（未对应）</option>
                                  {sameFunction(item).map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td className="hint">
                              {item.note}
                              {item.confidence < 0.6 ? '（把握不大）' : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {draft && (
                    <details className="recognition-notes">
                      <summary>识别依据</summary>
                      <ul>
                        {draft.notes.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  <h3>校对并确认空间</h3>
                  {traced ? (
                    <p className="hint">已用原图上描出的边界；可在下面继续核对尺寸。</p>
                  ) : (
                    !draft?.space && (
                      <p className="hint">
                        未识别到边界：点“描边界”在原图上描出，或在下面录入；识别到的道具会一并放入，之后在平面上调整位置。
                      </p>
                    )
                  )}
                  {(traced || draft?.space) && !draft?.space?.height && (
                    <label className="field">
                      层高（毫米）
                      <input
                        type="number"
                        step={10}
                        min={1500}
                        value={heightMm}
                        onChange={(e) => setHeightMm(Number(e.target.value))}
                      />
                    </label>
                  )}
                  <SpaceEditor
                    key={`${run.id}-${heightMm}-${editorKey}`}
                    initial={initialSpace}
                    initialName="空间（识别）"
                    submitting={confirm.isPending}
                    onCancel={onCancel}
                    onSubmit={submit}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
