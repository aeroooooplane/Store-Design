import { closure } from './space-form.ts'
import type { EdgeRow, PolygonForm, VertexRow } from './space-form.ts'

export type BoundaryEntry = 'edges' | 'points'

const isLeft = (deg: number) => deg < 0 || Object.is(deg, -0)
const fmt = (v: number, digits = 1) => String(Number(v.toFixed(digits)))

export function turnText(deg: number): string {
  if (Math.abs(deg) < 0.005) return '直行'
  return `${deg < 0 ? '左转' : '右转'} ${fmt(Math.abs(deg), 2)}°`
}

/**
 * The boundary as edges (length and turn, the last edge closing the ring) or as vertex
 * coordinates. Both views edit the same vertices; the parent keeps them in sync.
 */
export function SpaceBoundaryFields({
  form,
  edges,
  entry,
  onEntry,
  onEdge,
  onStart,
  onVertex,
  onInsert,
  onDelete,
  onFocusEdge,
}: {
  form: PolygonForm
  edges: EdgeRow[]
  entry: BoundaryEntry
  onEntry: (entry: BoundaryEntry) => void
  onEdge: (index: number, patch: Partial<EdgeRow>) => void
  onStart: (patch: Partial<VertexRow>) => void
  onVertex: (index: number, patch: Partial<VertexRow>) => void
  /** Inserts the midpoint of an edge. */
  onInsert: (edge: number) => void
  onDelete: (vertex: number) => void
  onFocusEdge: (edge: number) => void
}) {
  const n = form.vertices.length
  const start = form.vertices[0] ?? { xMm: 0, zMm: 0 }
  const close = closure(form.vertices, edges)

  return (
    <>
      <div className="tabs" role="group" aria-label="边界录入方式">
        <button type="button" aria-pressed={entry === 'edges'} onClick={() => onEntry('edges')}>
          逐边
        </button>
        <button type="button" aria-pressed={entry === 'points'} onClick={() => onEntry('points')}>
          坐标
        </button>
      </div>

      {entry === 'edges' ? (
        <>
          <div className="row">
            <label className="field">
              起点 x
              <input
                type="number"
                step={10}
                value={start.xMm}
                onChange={(e) => onStart({ xMm: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              起点 z
              <input
                type="number"
                step={10}
                value={start.zMm}
                onChange={(e) => onStart({ zMm: Number(e.target.value) })}
              />
            </label>
          </div>
          <p className="hint">
            第 1 条边的转角相对 x
            轴正方向（向右）；之后每条边相对上一条边，沿边界顺时针走时拐向店内为右转。最后一条边自动连回起点。
          </p>
          <datalist id="space-turn-angles">
            <option value="45" />
            <option value="90" />
            <option value="135" />
          </datalist>
          <table className="rows space-edge-table">
            <thead>
              <tr>
                <th>边</th>
                <th>长度</th>
                <th>转向</th>
                <th>角度（°）</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {edges.map((edge, i) => {
                const name = `边 ${i + 1}`
                const left = isLeft(edge.turnDeg)
                return (
                  <tr key={i} onFocus={() => onFocusEdge(i)}>
                    <th scope="row">
                      {i + 1}
                      {i === n - 1 && <span className="hint">（闭合）</span>}
                    </th>
                    <td>
                      <input
                        aria-label={`${name} 长度`}
                        type="number"
                        step={10}
                        min={0}
                        value={edge.lengthMm}
                        onChange={(e) => onEdge(i, { lengthMm: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`${name} 转向`}
                        value={left ? 'left' : 'right'}
                        onChange={(e) => {
                          const angle = Math.abs(edge.turnDeg)
                          onEdge(i, { turnDeg: e.target.value === 'left' ? -angle : angle })
                        }}
                      >
                        <option value="right">{i === 0 ? '顺时针' : '右转'}</option>
                        <option value="left">{i === 0 ? '逆时针' : '左转'}</option>
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label={`${name} 角度`}
                        type="number"
                        step={1}
                        min={0}
                        max={180}
                        list="space-turn-angles"
                        value={Math.abs(edge.turnDeg)}
                        onChange={(e) => {
                          const angle = Math.abs(Number(e.target.value))
                          onEdge(i, { turnDeg: left ? -angle : angle })
                        }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={`在${name}中点插入顶点`}
                        title="在这条边的中点插入顶点"
                        onClick={() => onInsert(i)}
                      >
                        插点
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className={close.errorMm >= 1 ? 'notice' : 'hint'} role="status">
            自动闭合：最后一条边实际长 {fmt(close.lengthMm)} mm，{turnText(close.turnDeg)}
            ；闭合误差 {fmt(close.errorMm, 0)} mm
            {close.errorMm >= 1 && '（所填的最后一条边与实际闭合边不一致，请核对尺寸）'}
          </p>
        </>
      ) : (
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
                <th scope="row">{i + 1}</th>
                <td>
                  <input
                    aria-label={`顶点 ${i + 1} x`}
                    type="number"
                    step={10}
                    value={v.xMm}
                    onChange={(e) => onVertex(i, { xMm: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`顶点 ${i + 1} z`}
                    type="number"
                    step={10}
                    value={v.zMm}
                    onChange={(e) => onVertex(i, { zMm: Number(e.target.value) })}
                  />
                </td>
                <td className="space-row-actions">
                  <button
                    type="button"
                    aria-label={`在顶点 ${i + 1} 与顶点 ${((i + 1) % n) + 1} 之间插入顶点`}
                    title="在这一点与下一点之间（中点）插入顶点"
                    onClick={() => onInsert(i)}
                  >
                    插点
                  </button>
                  <button
                    type="button"
                    aria-label={`删除顶点 ${i + 1}`}
                    disabled={n <= 3}
                    onClick={() => onDelete(i)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
