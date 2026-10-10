import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { validateSpace } from '@store/shared'
import type { Space } from '@store/shared'
import { PlanView } from './PlanView.tsx'
import {
  ENTRANCE_SIDE_LABELS,
  polygonToSpace,
  rectangleToPolygon,
  spaceToPolygonForm,
} from './space-form.ts'
import type {
  ColumnRow,
  EntranceRow,
  EntranceSide,
  PolygonForm,
  RectangleForm,
  VertexRow,
} from './space-form.ts'

interface SpaceEditorProps {
  /** Existing space to start from (editing creates a new space node). */
  initial?: Space | undefined
  submitting: boolean
  onSubmit: (space: Space, name: string) => void
  onCancel?: (() => void) | undefined
}

const DEFAULT_RECTANGLE: RectangleForm = {
  widthMm: 8000,
  depthMm: 6000,
  heightMm: 3200,
  entranceSide: 'front',
  entranceWidthMm: 0,
}

function NumberInput({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
}) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        inputMode="numeric"
        step={10}
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function SpaceEditor({ initial, submitting, onSubmit, onCancel }: SpaceEditorProps) {
  const [mode, setMode] = useState<'rectangle' | 'polygon'>(initial ? 'polygon' : 'rectangle')
  const [rectangle, setRectangle] = useState(DEFAULT_RECTANGLE)
  const [form, setForm] = useState<PolygonForm>(() =>
    initial ? spaceToPolygonForm(initial) : rectangleToPolygon(DEFAULT_RECTANGLE),
  )
  const [name, setName] = useState(initial ? '空间（修改）' : '空间')

  const parsed = useMemo(() => polygonToSpace(form), [form])
  const space = parsed.success ? parsed.data : null
  const issues = useMemo(() => (space ? validateSpace(space) : []), [space])
  const errors = issues.filter((i) => i.severity === 'error')

  const setRect = (patch: Partial<RectangleForm>) => {
    const next = { ...rectangle, ...patch }
    setRectangle(next)
    setForm(rectangleToPolygon(next))
  }
  const setVertex = (index: number, patch: Partial<VertexRow>) =>
    setForm({
      ...form,
      vertices: form.vertices.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    })
  const setEntrance = (index: number, patch: Partial<EntranceRow>) =>
    setForm({
      ...form,
      entrances: form.entrances.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    })
  const setColumn = (index: number, patch: Partial<ColumnRow>) =>
    setForm({
      ...form,
      columns: form.columns.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (space && !errors.length && name.trim()) onSubmit(space, name.trim())
  }

  return (
    <form className="space-editor" onSubmit={submit} aria-label="空间编辑">
      <div className="space-editor-fields">
        <div className="tabs" role="group" aria-label="输入方式">
          <button
            type="button"
            aria-pressed={mode === 'rectangle'}
            onClick={() => setMode('rectangle')}
          >
            矩形
          </button>
          <button
            type="button"
            aria-pressed={mode === 'polygon'}
            onClick={() => setMode('polygon')}
          >
            多边形
          </button>
        </div>

        {mode === 'rectangle' ? (
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
            <label className="field">
              主入口所在边
              <select
                value={rectangle.entranceSide}
                onChange={(e) => setRect({ entranceSide: e.target.value as EntranceSide })}
              >
                {Object.entries(ENTRANCE_SIDE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <NumberInput
              label="入口宽度（0 = 整边开敞）"
              value={rectangle.entranceWidthMm}
              onChange={(v) => setRect({ entranceWidthMm: v })}
            />
            <p className="hint">需要斜边、缺角或柱子时，切换到“多边形”在此基础上修改。</p>
          </fieldset>
        ) : (
          <>
            <fieldset>
              <legend>边界顶点（毫米，按顺序围合）</legend>
              <table className="rows">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>x</th>
                    <th>z</th>
                    <th aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {form.vertices.map((v, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>
                        <input
                          aria-label={`顶点 ${i + 1} x`}
                          type="number"
                          step={10}
                          value={v.xMm}
                          onChange={(e) => setVertex(i, { xMm: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`顶点 ${i + 1} z`}
                          type="number"
                          step={10}
                          value={v.zMm}
                          onChange={(e) => setVertex(i, { zMm: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          disabled={form.vertices.length <= 3}
                          onClick={() =>
                            setForm({
                              ...form,
                              vertices: form.vertices.filter((_, k) => k !== i),
                              entrances: [],
                            })
                          }
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                onClick={() => {
                  const last = form.vertices[form.vertices.length - 1] ?? { xMm: 0, zMm: 0 }
                  setForm({
                    ...form,
                    vertices: [...form.vertices, { xMm: last.xMm, zMm: last.zMm + 1000 }],
                  })
                }}
              >
                添加顶点
              </button>
              <NumberInput
                label="层高"
                value={form.heightMm}
                onChange={(v) => setForm({ ...form, heightMm: v })}
              />
            </fieldset>

            <fieldset>
              <legend>入口（第一个为主入口）</legend>
              {form.entrances.map((e, i) => (
                <div className="row" key={i}>
                  <label className="field">
                    所在边
                    <select
                      value={e.edge}
                      onChange={(event) => setEntrance(i, { edge: Number(event.target.value) })}
                    >
                      {form.vertices.map((_, k) => (
                        <option key={k} value={k}>
                          边 {k + 1}（顶点 {k + 1} → {((k + 1) % form.vertices.length) + 1}）
                        </option>
                      ))}
                    </select>
                  </label>
                  <NumberInput
                    label="起点"
                    value={e.startMm}
                    onChange={(v) => setEntrance(i, { startMm: v })}
                  />
                  <NumberInput
                    label="终点"
                    value={e.endMm}
                    onChange={(v) => setEntrance(i, { endMm: v })}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, entrances: form.entrances.filter((_, k) => k !== i) })
                    }
                  >
                    删除
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setForm({
                    ...form,
                    entrances: [...form.entrances, { edge: 0, startMm: 0, endMm: 1500 }],
                  })
                }
              >
                添加入口
              </button>
            </fieldset>

            <fieldset>
              <legend>柱子与固定物（矩形，毫米）</legend>
              {form.columns.map((c, i) => (
                <div className="row" key={i}>
                  <label className="field">
                    名称
                    <input
                      value={c.label}
                      onChange={(e) => setColumn(i, { label: e.target.value })}
                      maxLength={100}
                    />
                  </label>
                  <NumberInput label="x" value={c.xMm} onChange={(v) => setColumn(i, { xMm: v })} />
                  <NumberInput label="z" value={c.zMm} onChange={(v) => setColumn(i, { zMm: v })} />
                  <NumberInput
                    label="宽"
                    value={c.wMm}
                    onChange={(v) => setColumn(i, { wMm: v })}
                  />
                  <NumberInput
                    label="深"
                    value={c.dMm}
                    onChange={(v) => setColumn(i, { dMm: v })}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, columns: form.columns.filter((_, k) => k !== i) })
                    }
                  >
                    删除
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setForm({
                    ...form,
                    columns: [
                      ...form.columns,
                      {
                        label: `柱 ${form.columns.length + 1}`,
                        xMm: 1000,
                        zMm: 1000,
                        wMm: 500,
                        dMm: 500,
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
          <PlanView space={space} title="空间预览" />
        ) : (
          <p className="notice">输入完整后显示预览</p>
        )}
      </div>
    </form>
  )
}
