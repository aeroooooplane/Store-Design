import { useState } from 'react'
import { ChoiceInput, NumberInput } from './SpaceFields.tsx'
import { MAX_ARC_SEGMENTS, edgeLengthMm, selectionEdges } from './space-form.ts'
import type { ArcOptions, EdgeSelection, OpeningKind, PolygonForm } from './space-form.ts'

const ARC_MODES: Record<ArcOptions['mode'], string> = { sagitta: '拱高', radius: '半径' }
const ARC_DIRECTIONS: Record<ArcOptions['direction'], string> = {
  out: '向店外凸',
  in: '向店内凹',
}
const STOREFRONT_BUTTONS: [OpeningKind | 'wall', string][] = [
  ['main', '设为主入口'],
  ['side', '设为次入口'],
  ['open', '设为开放边'],
  ['wall', '恢复为墙'],
]

/**
 * Tools on a stretch of consecutive edges: make it a storefront (entrance or open edge), or,
 * for a single edge, replace it by an arc or split it at its midpoint.
 */
export function SpaceEdgeTools({
  form,
  selection,
  onSelection,
  onStorefront,
  onArc,
  onInsert,
  message,
}: {
  form: PolygonForm
  selection: EdgeSelection
  onSelection: (selection: EdgeSelection) => void
  onStorefront: (kind: OpeningKind | 'wall') => void
  onArc: (options: ArcOptions) => void
  onInsert: (edge: number) => void
  /** Result of the last tool, for example why an arc could not be made. */
  message: string | null
}) {
  const [arc, setArc] = useState<ArcOptions>({
    mode: 'sagitta',
    valueMm: 1000,
    segments: 8,
    direction: 'out',
  })
  const n = form.vertices.length
  const edges = selectionEdges(selection, n)
  const single = edges.length === 1
  const lastLength = edgeLengthMm(form.vertices, selection.to)
  const total = edges.reduce((sum, e) => sum + edgeLengthMm(form.vertices, e), 0)
  const edgeOptions = form.vertices.map((_, k) => (
    <option key={k} value={k}>
      边 {k + 1}
    </option>
  ))
  const pick = (patch: Pick<EdgeSelection, 'from' | 'to'>) =>
    onSelection({ ...patch, startMm: 0, endMm: null })

  return (
    <fieldset>
      <legend>选中的边</legend>
      <div className="row">
        <label className="field">
          从
          <select
            aria-label="起始边"
            value={selection.from}
            onChange={(e) => {
              const from = Number(e.target.value)
              // Keep the stretch when it still makes sense, else select the single edge.
              pick({ from, to: edges.includes(from) ? selection.to : from })
            }}
          >
            {edgeOptions}
          </select>
        </label>
        <label className="field">
          到
          <select
            aria-label="结束边"
            value={selection.to}
            onChange={(e) => pick({ from: selection.from, to: Number(e.target.value) })}
          >
            {edgeOptions}
          </select>
        </label>
        <NumberInput
          label={single ? '起点（距边起点）' : '起点（距首边起点）'}
          value={selection.startMm}
          onChange={(v) => onSelection({ ...selection, startMm: v })}
        />
        <NumberInput
          label={single ? '终点（距边起点）' : '终点（距末边起点）'}
          value={selection.endMm ?? Math.round(lastLength)}
          onChange={(v) => onSelection({ ...selection, endMm: v })}
        />
      </div>
      <p className="hint">
        已选 {edges.length} 条边，共 {Math.round(total)}{' '}
        mm；预览中高亮显示。也可以在预览中点击边选择，按住 Shift 点击连选。
      </p>
      <div className="toolbar" role="group" aria-label="设为店面">
        {STOREFRONT_BUTTONS.map(([kind, text]) => (
          <button key={kind} type="button" onClick={() => onStorefront(kind)}>
            {text}
          </button>
        ))}
      </div>

      {single ? (
        <>
          <div className="row">
            <ChoiceInput
              label="弧线依据"
              value={arc.mode}
              options={ARC_MODES}
              onChange={(mode) => setArc({ ...arc, mode })}
            />
            <NumberInput
              label={`${ARC_MODES[arc.mode]}（毫米）`}
              value={arc.valueMm}
              onChange={(valueMm) => setArc({ ...arc, valueMm })}
            />
            <ChoiceInput
              label="方向"
              value={arc.direction}
              options={ARC_DIRECTIONS}
              onChange={(direction) => setArc({ ...arc, direction })}
            />
            <NumberInput
              label="段数"
              value={arc.segments}
              min={2}
              max={MAX_ARC_SEGMENTS}
              step={1}
              onChange={(segments) => setArc({ ...arc, segments })}
            />
          </div>
          <div className="toolbar">
            <button type="button" onClick={() => onArc(arc)}>
              改为弧线
            </button>
            <button type="button" onClick={() => onInsert(selection.from)}>
              在中点插入顶点
            </button>
          </div>
        </>
      ) : (
        <p className="hint">改为弧线、插入顶点只对一条边生效，请只选一条边。</p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </fieldset>
  )
}
