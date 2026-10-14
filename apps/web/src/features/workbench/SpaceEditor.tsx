import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { validateSpace } from '@store/shared'
import type { Space } from '@store/shared'
import { SpaceBoundaryFields } from './SpaceBoundaryFields.tsx'
import type { BoundaryEntry } from './SpaceBoundaryFields.tsx'
import { SpaceEdgeTools } from './SpaceEdgeTools.tsx'
import { ChoiceInput, NumberInput } from './SpaceFields.tsx'
import { SpacePreview } from './SpacePreview.tsx'
import {
  CORNER_LABELS,
  DEFAULT_TEMPLATES,
  ENTRANCE_SIDE_LABELS,
  OBSTACLE_KIND_LABELS,
  OPENING_KIND_LABELS,
  TEMPLATE_LABELS,
  applyEdges,
  arcEdge,
  deleteVertex,
  formWarnings,
  insertVertex,
  openingRange,
  polygonToSpace,
  rectangleToPolygon,
  selectionEdges,
  setStorefront,
  spaceToPolygonForm,
  templateToPolygon,
  unmappedOpenings,
  verticesToEdges,
} from './space-form.ts'
import type {
  ArcOptions,
  EdgeRow,
  EdgeSelection,
  EntranceSide,
  ObstacleRow,
  OpeningKind,
  OpeningRow,
  PolygonForm,
  RectangleForm,
  TemplateForm,
  TemplateKind,
  VertexRow,
} from './space-form.ts'

interface SpaceEditorProps {
  /** Existing space to start from (editing creates a new space node). */
  initial?: Space | undefined
  submitting: boolean
  /** Name the new space node starts with; the user may change it. */
  initialName?: string | undefined
  onSubmit: (space: Space, name: string) => void
  onCancel?: (() => void) | undefined
}

type Mode = 'rectangle' | 'template' | 'polygon'

const DEFAULT_RECTANGLE: RectangleForm = {
  widthMm: 8000,
  depthMm: 6000,
  heightMm: 3200,
  entranceSide: 'front',
  entranceWidthMm: 0,
}

const MODES: [Mode, string][] = [
  ['rectangle', '矩形'],
  ['template', '模板'],
  ['polygon', '多边形'],
]

const SLANT_LABELS: Record<TemplateForm['slant'], string> = { left: '左侧', right: '右侧' }
const BUMP_LABELS: Record<TemplateForm['bump'], string> = {
  out: '后墙向外凸出',
  in: '后墙向内凹进',
}

const mod = (i: number, n: number) => ((i % n) + n) % n
/** Storefront ends on an arc or a diagonal edge are fractional; shown to 0.1 mm. */
const roundMm = (mm: number) => Math.round(mm * 10) / 10

/** The key sizes of each template; the shape is regenerated on every change. */
function TemplateFields({
  template,
  onChange,
}: {
  template: TemplateForm
  onChange: (patch: Partial<TemplateForm>) => void
}) {
  const t = template
  const size = (label: string, key: keyof TemplateForm & `${string}Mm`) => (
    <NumberInput key={key} label={label} value={t[key]} onChange={(v) => onChange({ [key]: v })} />
  )
  switch (t.kind) {
    case 'l':
      return (
        <>
          {size('总宽（左右）', 'widthMm')}
          {size('总深（前后）', 'depthMm')}
          <ChoiceInput
            label="缺口位置"
            value={t.corner}
            options={CORNER_LABELS}
            onChange={(corner) => onChange({ corner })}
          />
          {size('缺口宽（左右）', 'cutWidthMm')}
          {size('缺口深（前后）', 'cutDepthMm')}
        </>
      )
    case 'trapezoid':
      return (
        <>
          {size('后边宽', 'widthMm')}
          {size('前边宽（入口一侧）', 'frontWidthMm')}
          {size('深（前后）', 'depthMm')}
          <ChoiceInput
            label="斜墙在"
            value={t.slant}
            options={SLANT_LABELS}
            onChange={(slant) => onChange({ slant })}
          />
        </>
      )
    case 'chamfer':
      return (
        <>
          {size('总宽（左右）', 'widthMm')}
          {size('总深（前后）', 'depthMm')}
          <ChoiceInput
            label="切角位置"
            value={t.corner}
            options={CORNER_LABELS}
            onChange={(corner) => onChange({ corner })}
          />
          {size('切角宽（左右）', 'cutWidthMm')}
          {size('切角深（前后）', 'cutDepthMm')}
        </>
      )
    case 'bump':
      return (
        <>
          {size('宽（左右）', 'widthMm')}
          {size('主体深（不含凸出）', 'depthMm')}
          <ChoiceInput
            label="后墙"
            value={t.bump}
            options={BUMP_LABELS}
            onChange={(bump) => onChange({ bump })}
          />
          {size('凸出或凹进部分宽', 'cutWidthMm')}
          {size('凸出或凹进部分深', 'cutDepthMm')}
          {size('距左墙', 'offsetMm')}
        </>
      )
  }
}

function ObstacleFields({
  row,
  index,
  onChange,
  onDelete,
}: {
  row: ObstacleRow
  index: number
  onChange: (patch: Partial<ObstacleRow>) => void
  onDelete: () => void
}) {
  const name = row.label.trim() || `障碍物 ${index + 1}`
  const remove = (
    <button type="button" aria-label={`删除${name}`} onClick={onDelete}>
      删除
    </button>
  )
  if (row.polygon)
    return (
      <div className="space-obstacle">
        <div className="row">
          <span>
            {name}（{OBSTACLE_KIND_LABELS[row.kind]}，{row.polygon.length} 个顶点
            {row.heightMm === null ? '，通高' : `，高 ${row.heightMm} mm`}）
          </span>
          {remove}
        </div>
        <p className="hint">该障碍物为多边形，只能删除或原样保留</p>
      </div>
    )
  return (
    <div className="row space-obstacle">
      <label className="field">
        名称
        <input
          value={row.label}
          onChange={(e) => onChange({ label: e.target.value })}
          maxLength={100}
        />
      </label>
      <ChoiceInput
        label="类型"
        value={row.kind}
        options={OBSTACLE_KIND_LABELS}
        onChange={(kind) => onChange({ kind })}
      />
      <NumberInput label="x" value={row.xMm} onChange={(v) => onChange({ xMm: v })} />
      <NumberInput label="z" value={row.zMm} onChange={(v) => onChange({ zMm: v })} />
      <NumberInput label="宽" value={row.wMm} onChange={(v) => onChange({ wMm: v })} />
      <NumberInput label="深" value={row.dMm} onChange={(v) => onChange({ dMm: v })} />
      <label className="field">
        高度（空 = 通高）
        <input
          type="number"
          step={10}
          min={0}
          value={row.heightMm ?? ''}
          onChange={(e) =>
            onChange({ heightMm: e.target.value === '' ? null : Number(e.target.value) })
          }
        />
      </label>
      {remove}
    </div>
  )
}

export function SpaceEditor({
  initial,
  submitting,
  initialName,
  onSubmit,
  onCancel,
}: SpaceEditorProps) {
  const [mode, setMode] = useState<Mode>(initial ? 'polygon' : 'rectangle')
  const [rectangle, setRectangle] = useState(DEFAULT_RECTANGLE)
  const [template, setTemplate] = useState<TemplateForm | null>(null)
  const [entry, setEntry] = useState<BoundaryEntry>('edges')
  // The edge rows are kept as typed, so editing one edge does not round the others; any other
  // change of the vertices derives them again.
  const [shape, setShape] = useState(() => {
    const form = initial ? spaceToPolygonForm(initial) : rectangleToPolygon(DEFAULT_RECTANGLE)
    return { form, edges: verticesToEdges(form.vertices) }
  })
  // Start on the edges of the main entrance (or the first storefront).
  const [selection, setSelection] = useState<EdgeSelection>(() => {
    const { openings } = shape.form
    const row = openings.find((o) => o.kind === 'main') ?? openings[0]
    return { from: row?.edge ?? 0, to: row?.toEdge ?? 0, startMm: 0, endMm: null }
  })
  const [message, setMessage] = useState<string | null>(null)
  const [name, setName] = useState(initialName ?? (initial ? '空间（修改）' : '空间'))
  const lost = useMemo(() => (initial ? unmappedOpenings(initial) : 0), [initial])

  const { form, edges } = shape
  const n = form.vertices.length
  const sel: EdgeSelection =
    selection.from < n && selection.to < n ? selection : { from: 0, to: 0, startMm: 0, endMm: null }
  const parsed = useMemo(() => polygonToSpace(form), [form])
  const space = parsed.success ? parsed.data : null
  const issues = useMemo(() => (space ? validateSpace(space) : []), [space])
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = useMemo(() => formWarnings(form), [form])

  const commit = (next: PolygonForm, nextEdges?: EdgeRow[]) =>
    setShape((prev) => ({
      form: next,
      edges:
        nextEdges ??
        (next.vertices === prev.form.vertices ? prev.edges : verticesToEdges(next.vertices)),
    }))
  const selectEdges = (from: number, to: number) =>
    setSelection({ from, to, startMm: 0, endMm: null })

  const setRect = (patch: Partial<RectangleForm>) => {
    const next = { ...rectangle, ...patch }
    setRectangle(next)
    commit(rectangleToPolygon(next))
  }
  const setTpl = (next: TemplateForm) => {
    setTemplate(next)
    const shaped = templateToPolygon(next)
    commit(shaped)
    const front = shaped.openings[0]?.edge ?? 0
    selectEdges(front, front)
  }
  const setEdge = (index: number, patch: Partial<EdgeRow>) => {
    const nextEdges = edges.map((e, k) => (k === index ? { ...e, ...patch } : e))
    // The last edge only closes the ring; its values are compared, not drawn.
    const vertices = index >= n - 1 ? form.vertices : applyEdges(form.vertices, nextEdges, index)
    commit({ ...form, vertices }, nextEdges)
  }
  const setStart = (patch: Partial<VertexRow>) => {
    const first = form.vertices[0] ?? { xMm: 0, zMm: 0 }
    const dx = (patch.xMm ?? first.xMm) - first.xMm
    const dz = (patch.zMm ?? first.zMm) - first.zMm
    const vertices = form.vertices.map((v) => ({ xMm: v.xMm + dx, zMm: v.zMm + dz }))
    commit({ ...form, vertices }, edges)
  }
  const setVertex = (index: number, patch: Partial<VertexRow>) =>
    commit({
      ...form,
      vertices: form.vertices.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    })
  const insert = (edge: number) => {
    const next = insertVertex(form, edge)
    if (next === form) return setMessage('顶点已达上限，无法再插入')
    commit(next)
    selectEdges(edge, edge + 1)
    setMessage(null)
  }
  const remove = (vertex: number) => {
    commit(deleteVertex(form, vertex))
    setMessage(null)
  }
  const storefront = (kind: OpeningKind | 'wall') => {
    const { form: next, replaced, parts } = setStorefront(form, sel, kind)
    if (next === form) return setMessage('选中的范围长度为 0，请检查起点和终点')
    commit(next)
    const notes = [
      replaced &&
        `一个空间只有一段主入口：原来的主入口（其余 ${replaced} 段）已恢复为墙，需要的话可再设为次入口`,
      parts > 1 &&
        `选中的店面超过周长的一半，已拆成 ${parts} 段写入（一段店面只按两端之间较短的一侧理解）`,
    ].filter(Boolean)
    setMessage(notes.length ? notes.join('；') : null)
  }
  const arc = (options: ArcOptions) => {
    const result = arcEdge(form, sel.from, options)
    if (!result.ok) return setMessage(result.message)
    commit(result.form)
    const segments = Math.round(options.segments)
    selectEdges(sel.from, sel.from + segments - 1)
    setMessage(`边 ${sel.from + 1} 已改为 ${segments} 段弧线，并已选中，可直接设为店面`)
  }
  const clickEdge = (edge: number, extend: boolean) => {
    if (!extend) return selectEdges(edge, edge)
    // Grow the stretch on whichever end needs fewer edges.
    const forward = mod(edge - sel.from, n)
    const backward = mod(sel.to - edge, n)
    if (forward <= backward) selectEdges(sel.from, edge)
    else selectEdges(edge, sel.to)
  }
  const setOpening = (index: number, patch: Partial<OpeningRow>) =>
    commit({
      ...form,
      openings: form.openings.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    })
  const setObstacle = (index: number, patch: Partial<ObstacleRow>) =>
    commit({
      ...form,
      obstacles: form.obstacles.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (space && !errors.length && name.trim()) onSubmit(space, name.trim())
  }

  // Recognised values are to the millimetre; the browser must not block them for the 10 mm step.
  return (
    <form className="space-editor" onSubmit={submit} aria-label="空间编辑" noValidate>
      <div className="space-editor-fields">
        <div className="tabs" role="group" aria-label="输入方式">
          {MODES.map(([value, text]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {text}
            </button>
          ))}
        </div>

        {mode === 'rectangle' && (
          <fieldset>
            <legend>矩形空间（毫米）</legend>
            <NumberInput
              label="宽（左右）"
              value={rectangle.widthMm}
              onChange={(v) => setRect({ widthMm: v })}
            />
            <NumberInput
              label="深（前后）"
              value={rectangle.depthMm}
              onChange={(v) => setRect({ depthMm: v })}
            />
            <NumberInput
              label="层高"
              value={rectangle.heightMm}
              onChange={(v) => setRect({ heightMm: v })}
            />
            <ChoiceInput
              label="主入口所在边"
              value={rectangle.entranceSide}
              options={ENTRANCE_SIDE_LABELS}
              onChange={(entranceSide: EntranceSide) => setRect({ entranceSide })}
            />
            <NumberInput
              label="入口宽度（0 = 整边开敞）"
              value={rectangle.entranceWidthMm}
              onChange={(v) => setRect({ entranceWidthMm: v })}
            />
            <p className="hint">
              L
              形、斜墙、缺角等常见店形可用“模板”；需要逐边调整或加柱子时，切换到“多边形”在此基础上修改。
            </p>
          </fieldset>
        )}

        {mode === 'template' && (
          <fieldset>
            <legend>模板（毫米）</legend>
            <label className="field">
              模板
              <select
                value={template?.kind ?? ''}
                onChange={(e) => {
                  const kind = e.target.value as TemplateKind
                  setTpl({ ...DEFAULT_TEMPLATES[kind], heightMm: template?.heightMm ?? 3200 })
                }}
              >
                {!template && (
                  <option value="" disabled>
                    请选择模板
                  </option>
                )}
                {(Object.entries(TEMPLATE_LABELS) as [TemplateKind, string][]).map(
                  ([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ),
                )}
              </select>
            </label>
            {template ? (
              <>
                <TemplateFields
                  template={template}
                  onChange={(patch) => setTpl({ ...template, ...patch })}
                />
                <NumberInput
                  label="层高"
                  value={template.heightMm}
                  onChange={(heightMm) => setTpl({ ...template, heightMm })}
                />
                <p className="hint">
                  选模板会替换当前边界；整条前边默认为主入口。生成后可切换到“多边形”逐边或逐点微调。
                </p>
              </>
            ) : (
              <p className="hint">
                选择模板后填写几个关键尺寸即可生成边界，当前边界在选择前保持不变。
              </p>
            )}
          </fieldset>
        )}

        {mode === 'polygon' && (
          <>
            <fieldset>
              <legend>边界（毫米，按顺序围合）</legend>
              <SpaceBoundaryFields
                form={form}
                edges={edges}
                entry={entry}
                onEntry={setEntry}
                onEdge={setEdge}
                onStart={setStart}
                onVertex={setVertex}
                onInsert={insert}
                onDelete={remove}
                onFocusEdge={(edge) => {
                  if (sel.from !== edge || sel.to !== edge) selectEdges(edge, edge)
                }}
              />
              <NumberInput
                label="层高"
                value={form.heightMm}
                onChange={(v) => commit({ ...form, heightMm: v })}
              />
            </fieldset>

            <SpaceEdgeTools
              form={form}
              selection={sel}
              onSelection={setSelection}
              onStorefront={storefront}
              onArc={arc}
              onInsert={insert}
              message={message}
            />

            <fieldset>
              <legend>店面（入口与开放边）</legend>
              <p className="hint">
                一段店面可跨多条边，沿边界顺序从起点走到终点。主入口只能有一段连续店面；开放边不砌墙，也不算入口。
              </p>
              {form.openings.length === 0 && (
                <p className="hint">还没有入口：在“选中的边”里选好范围后设为主入口。</p>
              )}
              {form.openings.map((o, i) => {
                const range = openingRange(o)
                const edgeSelect = (label: string, value: number, key: 'edge' | 'toEdge') => (
                  <label className="field">
                    {label}
                    <select
                      value={value}
                      onChange={(event) => setOpening(i, { [key]: Number(event.target.value) })}
                    >
                      {form.vertices.map((_, k) => (
                        <option key={k} value={k}>
                          边 {k + 1}（顶点 {k + 1} → {((k + 1) % n) + 1}）
                        </option>
                      ))}
                    </select>
                  </label>
                )
                return (
                  <div key={i}>
                    <div className="row">
                      <strong>
                        {OPENING_KIND_LABELS[o.kind]}：{range}
                      </strong>
                      <button
                        type="button"
                        aria-label={`选中${range}的${OPENING_KIND_LABELS[o.kind]}`}
                        onClick={() =>
                          setSelection({
                            from: o.edge,
                            to: o.toEdge,
                            startMm: o.startMm,
                            endMm: o.endMm,
                          })
                        }
                      >
                        选中
                      </button>
                      <button
                        type="button"
                        aria-label={`删除${range}的${OPENING_KIND_LABELS[o.kind]}`}
                        onClick={() =>
                          commit({ ...form, openings: form.openings.filter((_, k) => k !== i) })
                        }
                      >
                        删除
                      </button>
                    </div>
                    <div className="row">
                      {edgeSelect('起于', o.edge, 'edge')}
                      <NumberInput
                        label="起点（距该边起点）"
                        value={roundMm(o.startMm)}
                        onChange={(v) => setOpening(i, { startMm: v })}
                      />
                      {edgeSelect('止于', o.toEdge, 'toEdge')}
                      <NumberInput
                        label="终点（距该边起点）"
                        value={roundMm(o.endMm)}
                        onChange={(v) => setOpening(i, { endMm: v })}
                      />
                      <ChoiceInput
                        label="类型"
                        value={o.kind}
                        options={OPENING_KIND_LABELS}
                        onChange={(kind) => setOpening(i, { kind })}
                      />
                    </div>
                  </div>
                )
              })}
            </fieldset>

            <fieldset>
              <legend>柱子与障碍物（毫米）</legend>
              {form.obstacles.map((o, i) => (
                <ObstacleFields
                  key={i}
                  row={o}
                  index={i}
                  onChange={(patch) => setObstacle(i, patch)}
                  onDelete={() =>
                    commit({ ...form, obstacles: form.obstacles.filter((_, k) => k !== i) })
                  }
                />
              ))}
              <button
                type="button"
                onClick={() =>
                  commit({
                    ...form,
                    obstacles: [
                      ...form.obstacles,
                      {
                        kind: 'column',
                        label: `柱 ${form.obstacles.length + 1}`,
                        heightMm: null,
                        xMm: 1000,
                        zMm: 1000,
                        wMm: 500,
                        dMm: 500,
                        polygon: null,
                      },
                    ],
                  })
                }
              >
                添加柱子
              </button>
            </fieldset>
          </>
        )}

        <label className="field">
          节点名称
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </label>
        {lost > 0 && (
          <div className="notice">
            原空间有 {lost} 段入口或开放边不在边界上，无法编辑，保存时将被去掉。
          </div>
        )}
        {!parsed.success && (
          <div className="error" role="alert">
            尺寸或顶点不完整：至少 3 个顶点，层高 1.5–20 m
          </div>
        )}
        {issues.map((issue, i) => (
          <div
            key={i}
            className={issue.severity === 'error' ? 'error' : 'notice'}
            role={issue.severity === 'error' ? 'alert' : undefined}
          >
            {issue.message}
          </div>
        ))}
        {warnings.map((warning, i) => (
          <div key={`w${i}`} className="notice">
            {warning}
          </div>
        ))}
        <div className="toolbar">
          <button
            type="submit"
            className="primary"
            disabled={submitting || !space || errors.length > 0 || !name.trim()}
          >
            保存空间
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel}>
              取消
            </button>
          )}
        </div>
      </div>
      <div className="space-editor-preview">
        {space ? (
          <SpacePreview
            space={space}
            selected={mode === 'polygon' ? selectionEdges(sel, n) : []}
            onEdgeClick={mode === 'polygon' ? clickEdge : undefined}
          />
        ) : (
          <p className="notice">输入完整后显示预览</p>
        )}
      </div>
    </form>
  )
}
