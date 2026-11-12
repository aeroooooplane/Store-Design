import { boundaryPath } from '@store/shared'
import { useQueryClient } from '@tanstack/react-query'
import { workbenchKeys } from '../workbench/api.ts'
import { useEffect, useRef, useState } from 'react'
import type { PlanUpload } from '@store/shared'
import { api, unwrap } from '../../api/client.ts'
import type { FineDraft, FineRecord, Px } from './fine-model.ts'
import { resizeFine } from './fine-model.ts'
import './fine-geometry.css'
export function FineGeometryPanel({
  upload,
  onCreated,
}: {
  upload: PlanUpload
  onCreated: (id: string) => void
}) {
  const client = useQueryClient()
  const importInput = useRef<HTMLInputElement>(null)
  const [record, setRecord] = useState<FineRecord | null>(null),
    [draft, setDraft] = useState<FineDraft | null>(null),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(''),
    [tool, setTool] = useState<'select' | 'boundary' | 'rectangle' | 'calibrate' | 'entrance'>(
      'select',
    ),
    [points, setPoints] = useState<Px[]>([]),
    [distance, setDistance] = useState(''),
    [zoom, setZoom] = useState(100),
    [omissions, setOmissions] = useState<{ id: string; label: string; reason: string }[] | null>(
      null,
    ),
    [ack, setAck] = useState(false),
    [showAll, setShowAll] = useState(false)
  const svg = useRef<SVGSVGElement>(null),
    undo = useRef<FineDraft[]>([]),
    redo = useRef<FineDraft[]>([]),
    drag = useRef<{ index: number; before: FineDraft } | null>(null)
  const dirty = !!draft && !!record && JSON.stringify(draft) !== JSON.stringify(record.draft)
  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const load = (r: FineRecord | null, recover = false) => {
    if (
      r &&
      (!r.raw || !Array.isArray(r.raw.candidates) || !r.draft || !Array.isArray(r.draft.objects))
    )
      throw Error('识别草稿格式无效，请重新读取')
    if (r && !recover) sessionStorage.removeItem('fine-draft-' + r.uploadId)
    setRecord(r)
    let next = r ? structuredClone(r.draft) : null
    if (r && recover && !r.confirmedNodeId) {
      try {
        const local = JSON.parse(sessionStorage.getItem('fine-draft-' + r.uploadId) || 'null') as {
          revision: number
          draft: FineDraft
        } | null
        if (local && local.revision === r.revision) {
          next = local.draft
          setSaved('已恢复此标签页未保存草稿')
        } else if (local) {
          setError('服务器已有更新，本地旧草稿未覆盖它，请保留当前页并检查版本')
        }
      } catch {
        setError('本地恢复记录不可读，已加载服务器草稿')
      }
    }
    setDraft(next)
    undo.current = []
    redo.current = []
    setOmissions(null)
  }
  useEffect(() => {
    let active = true
    void api
      .GET('/api/v1/uploads/{uploadId}/fine', { params: { path: { uploadId: upload.id } } })
      .then((r) => {
        if (active) load(unwrap(r) as FineRecord | null, true)
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
    }
  }, [upload.id])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => {
    if (!record || !draft) return
    try {
      const key = 'fine-draft-' + record.uploadId
      if (dirty) sessionStorage.setItem(key, JSON.stringify({ revision: record.revision, draft }))
      else {
        const local = JSON.parse(sessionStorage.getItem(key) || 'null') as {
          revision: number
        } | null
        if (local && local.revision === record.revision) sessionStorage.removeItem(key)
      }
    } catch {
      /* 显式服务端保存仍可用；浏览器恢复不是持久化依据。 */
    }
  }, [draft, record, dirty])
  const change = (next: FineDraft) => {
    if (draft) {
      undo.current.push(structuredClone(draft))
      redo.current = []
    }
    setDraft(next)
    setOmissions(null)
    setSaved('未保存')
  }
  const patch = (fields: Partial<FineDraft>) => {
    if (draft) change({ ...draft, ...fields })
  }
  const restore = (reverse = false) => {
    if (!draft) return
    const source = reverse ? redo.current : undo.current,
      target = reverse ? undo.current : redo.current,
      next = source.pop()
    if (next) {
      target.push(structuredClone(draft))
      setDraft(next)
      setOmissions(null)
      setSaved('未保存')
    }
  }
  const object = draft?.objects.find((o) => o.id === selected)
  const original = record?.raw.candidates.find((c) => c.id === object?.candidateId)
  const contribution = !object
    ? ''
    : !original
      ? '手工补点'
      : JSON.stringify(original.geometry.points) === JSON.stringify(object.points)
        ? original.kind === object.kind
          ? '几何与类别保留（名称/高度需核对）'
          : '自动几何保留，类别已改'
        : '自动候选经人工修边'
  const changeObject = (fields: Partial<NonNullable<typeof object>>) => {
    if (draft && object)
      patch({ objects: draft.objects.map((o) => (o.id === selected ? { ...o, ...fields } : o)) })
  }
  const pixel = (e: React.PointerEvent): Px => {
    const s = svg.current!,
      p = new DOMPoint(e.clientX, e.clientY).matrixTransform(s.getScreenCTM()!.inverse())
    return [
      Math.max(0, Math.min(upload.width, Math.round(p.x))),
      Math.max(0, Math.min(upload.height, Math.round(p.y))),
    ]
  }
  const addPoint = (p: Px) => {
    if (!draft || record?.confirmedNodeId || tool === 'select') return
    const next = [...points, p]
    setPoints(next)
    if (tool === 'rectangle' && next.length === 2) {
      const [a, b] = next as [Px, Px]
      patch({
        objects: [
          ...draft.objects,
          {
            id: 'M-' + crypto.randomUUID(),
            candidateId: null,
            kind: 'unknown',
            label: '手工对象',
            points: [
              [a[0], a[1]],
              [b[0], a[1]],
              [b[0], b[1]],
              [a[0], b[1]],
            ],
            status: 'keep',
            heightMm: null,
          },
        ],
      })
      setSelected('')
      setPoints([])
      setTool('select')
    }
    if (tool === 'entrance' && next.length === 2) {
      patch({ entrances: [...draft.entrances, { a: next[0]!, b: next[1]!, kind: 'main' }] })
      setPoints([])
      setTool('select')
    }
  }
  const mmPerPixel = draft?.calibration
    ? draft.calibration.mm /
      Math.hypot(
        draft.calibration.b[0] - draft.calibration.a[0],
        draft.calibration.b[1] - draft.calibration.a[1],
      )
    : null
  const save = () =>
    act(async () => {
      if (!record || !draft) return
      const r = unwrap(
        await api.PUT('/api/v1/uploads/{uploadId}/fine', {
          params: { path: { uploadId: upload.id } },
          body: { revision: record.revision, draft },
        }),
      ) as FineRecord
      setRecord(r)
      sessionStorage.removeItem('fine-draft-' + r.uploadId)
      setSaved('已保存到项目')
    })
  return (
    <section
      className="fine-panel"
      aria-label="原图精细识别"
      onKeyDown={(e) => {
        if (
          (e.ctrlKey || e.metaKey) &&
          e.key.toLowerCase() === 'z' &&
          !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)
        ) {
          e.preventDefault()
          restore(e.shiftKey)
        }
      }}
      tabIndex={0}
    >
      <div className="toolbar">
        <strong>原图精细识别 · 本地</strong>
        <button
          disabled={busy || !!record}
          onClick={() =>
            void act(async () =>
              load(
                unwrap(
                  await api.POST('/api/v1/uploads/{uploadId}/fine', {
                    params: { path: { uploadId: upload.id } },
                  }),
                ) as FineRecord,
              ),
            )
          }
        >
          {busy ? '处理中…' : '提取几何'}
        </button>
        {record && (
          <>
            <button disabled={busy} onClick={() => void save()}>
              保存草稿
            </button>
            <button onClick={() => restore()}>撤销</button>
            <button onClick={() => restore(true)}>重做</button>
            <button
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify({ ...record, draft }, null, 2)], {
                    type: 'application/json',
                  }),
                )
                const a = document.createElement('a')
                a.href = url
                a.download = '精细识别审核包.json'
                a.click()
                setTimeout(() => URL.revokeObjectURL(url), 1000)
              }}
            >
              导出记录
            </button>
          </>
        )}
      </div>
      <input
        ref={importInput}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="导入精细审核草稿"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file && record)
            void act(async () => {
              const imported = JSON.parse(await file.text()) as {
                sourceSha256?: string
                draft?: FineDraft
              }
              if (imported.sourceSha256 !== record.sourceSha256 || !imported.draft)
                throw Error('审核包与当前原图不一致，未导入')
              const r = unwrap(
                await api.PUT('/api/v1/uploads/{uploadId}/fine', {
                  params: { path: { uploadId: upload.id } },
                  body: { revision: record.revision, draft: imported.draft },
                }),
              ) as FineRecord
              load(r)
              setSaved('已导入并保存人工审核草稿；自动原始结果保留')
            })
        }}
      />
      {record && !record.confirmedNodeId && (
        <button disabled={busy} onClick={() => importInput.current?.click()}>
          导入审核草稿
        </button>
      )}
      <p className="hint">
        按原图像素提取，数据留在本机。先确认候选，再量尺、定范围。圆角为外接框，未知项需要复核。
      </p>
      {error && <p role="alert">{error}</p>}
      <span role="status">{saved}</span>
      {record && draft && (
        <>
          <p>
            {record.raw.candidates.length} 个候选 · 自动 {record.elapsedSeconds.toFixed(2)} 秒 ·
            已保留 {draft.objects.filter((o) => o.status === 'keep').length} 个 · 版本{' '}
            {record.revision}
          </p>
          {record.confirmedNodeId && (
            <button onClick={() => onCreated(record.confirmedNodeId!)}>打开已生成空间</button>
          )}
          <fieldset disabled={busy || !!record.confirmedNodeId} className="fine-edit-fields">
            <>
              <div className="toolbar">
                {(['select', 'boundary', 'rectangle', 'calibrate', 'entrance'] as const).map(
                  (v, i) => (
                    <button
                      key={v}
                      aria-pressed={tool === v}
                      onClick={() => {
                        setTool(v)
                        setPoints([])
                      }}
                    >
                      {['选择', '描范围', '补矩形', '两点量尺', '加入口'][i]}
                    </button>
                  ),
                )}{' '}
                <button
                  disabled={tool !== 'boundary' || points.length < 3}
                  onClick={() => {
                    patch({
                      boundary: points,
                      openEdges: [],
                      entrances: [],
                      structureReviewed: false,
                    })
                    setPoints([])
                    setTool('select')
                  }}
                >
                  完成范围
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={showAll}
                    onChange={(e) => setShowAll(e.target.checked)}
                  />
                  显示未分类候选
                </label>
                <label>
                  缩放
                  <input
                    aria-label="原图缩放"
                    type="range"
                    min="50"
                    max="250"
                    value={zoom}
                    onChange={(e) => setZoom(+e.target.value)}
                  />
                </label>
              </div>
              {tool === 'calibrate' && (
                <label>
                  已知长度（毫米）
                  <input value={distance} onChange={(e) => setDistance(e.target.value)} />
                  <button
                    disabled={points.length !== 2 || !(+distance > 0)}
                    onClick={() => {
                      patch({
                        calibration: { a: points[0]!, b: points[1]!, mm: +distance },
                        structureReviewed: false,
                      })
                      setTool('select')
                      setPoints([])
                    }}
                  >
                    确定量尺
                  </button>
                </label>
              )}
              {tool === 'entrance' && (
                <p>
                  点击范围边界上的两个端点。可重复添加多个入口；折线入口沿较短边界路径连接。中岛开敞边单独标记。
                </p>
              )}
              <div className="fine-grid">
                <div className="fine-canvas">
                  <svg
                    ref={svg}
                    viewBox={'0 0 ' + upload.width + ' ' + upload.height}
                    style={{ width: zoom + '%', minWidth: zoom + '%' }}
                    onPointerDown={(e) => addPoint(pixel(e))}
                    onPointerMove={(e) => {
                      if (!drag.current || !draft || !object || record.confirmedNodeId) return
                      const p = pixel(e)
                      setDraft({
                        ...draft,
                        objects: draft.objects.map((o) =>
                          o.id === selected
                            ? {
                                ...o,
                                points: o.points.map((q, i) => (i === drag.current!.index ? p : q)),
                              }
                            : o,
                        ),
                      })
                    }}
                    onPointerUp={() => {
                      if (drag.current) {
                        undo.current.push(drag.current.before)
                        redo.current = []
                        drag.current = null
                        setOmissions(null)
                        setSaved('未保存')
                      }
                    }}
                    onPointerCancel={() => {
                      if (drag.current) {
                        setDraft(drag.current.before)
                        drag.current = null
                      }
                    }}
                  >
                    <image href={upload.url} width={upload.width} height={upload.height} />
                    {draft.objects
                      .filter(
                        (o) =>
                          o.status !== 'reject' &&
                          (showAll ||
                            o.status === 'keep' ||
                            o.kind !== 'unknown' ||
                            o.id === selected),
                      )
                      .map((o) => (
                        <polygon
                          key={o.id}
                          data-object={o.id}
                          points={o.points.map((p) => p.join(',')).join(' ')}
                          fill={o.id === selected ? '#ffd20055' : 'transparent'}
                          stroke={
                            o.id === selected ? '#aa7400' : o.status === 'keep' ? '#0c9a63' : '#777'
                          }
                          strokeWidth={o.id === selected ? 4 : 2}
                          onPointerDown={(e) => {
                            if (tool === 'select' && !record.confirmedNodeId) {
                              e.stopPropagation()
                              setSelected(o.id)
                            }
                          }}
                        >
                          <title>
                            {o.id} · {o.label} ·{' '}
                            {{ keep: '已保留', reject: '已排除', pending: '待确认' }[o.status]}
                          </title>
                        </polygon>
                      ))}
                    {draft.boundary.length > 0 && (
                      <polygon
                        points={draft.boundary.map((p) => p.join(',')).join(' ')}
                        fill="none"
                        stroke="#d2a600"
                        strokeWidth="4"
                      />
                    )}
                    {draft.entrances.flatMap((v, i) => {
                      const pieces = boundaryPath(
                        draft.boundary,
                        v.a,
                        v.b,
                        mmPerPixel ? 20 / mmPerPixel : 1,
                      )
                      return (pieces ?? [{ a: v.a, b: v.b }]).map((piece, j) => (
                        <line
                          key={i + '-' + j}
                          data-entrance={i}
                          x1={piece.a[0]}
                          y1={piece.a[1]}
                          x2={piece.b[0]}
                          y2={piece.b[1]}
                          stroke={pieces ? '#ae54ac' : '#d44032'}
                          strokeWidth="5"
                        />
                      ))
                    })}
                    {draft.calibration && (
                      <line
                        x1={draft.calibration.a[0]}
                        y1={draft.calibration.a[1]}
                        x2={draft.calibration.b[0]}
                        y2={draft.calibration.b[1]}
                        stroke="#bd3326"
                        strokeWidth="3"
                      />
                    )}
                    <polyline
                      points={points.map((p) => p.join(',')).join(' ')}
                      fill="none"
                      stroke="#d2a600"
                      strokeWidth="4"
                    />
                    {points.map((p, i) => (
                      <circle key={i} cx={p[0]} cy={p[1]} r="6" fill="#d2a600" />
                    ))}
                    {object &&
                      !record.confirmedNodeId &&
                      tool === 'select' &&
                      object.points.map((p, i) => (
                        <circle
                          key={i}
                          cx={p[0]}
                          cy={p[1]}
                          r="7"
                          fill="#ffd200"
                          stroke="#111"
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            drag.current = { index: i, before: structuredClone(draft) }
                            svg.current!.setPointerCapture(e.pointerId)
                          }}
                        />
                      ))}
                  </svg>
                </div>
                <aside>
                  <label>
                    对象
                    <select
                      aria-label="选择候选对象"
                      value={selected}
                      onChange={(e) => setSelected(e.target.value)}
                    >
                      <option value="">请选择</option>
                      {draft.objects.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.id} · {o.label} · {o.status}
                        </option>
                      ))}
                    </select>
                  </label>
                  {object && (
                    <>
                      <label>
                        <span>{contribution}</span>
                        <br />
                        名称
                        <input
                          aria-label="对象名称"
                          value={object.label}
                          onChange={(e) => changeObject({ label: e.target.value })}
                        />
                      </label>
                      <label>
                        类别
                        <select
                          aria-label="对象类别"
                          value={object.kind}
                          onChange={(e) =>
                            changeObject({ kind: e.target.value as typeof object.kind })
                          }
                        >
                          {[
                            'unknown',
                            'furniture',
                            'column',
                            'wall-display',
                            'service',
                            'sign',
                          ].map((k, i) => (
                            <option key={k} value={k}>
                              {['待定', '家具', '柱', '墙面屏/灯箱', '服务设施', '标牌'][i]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button onClick={() => changeObject({ status: 'keep' })}>保留对象</button>
                      <button onClick={() => changeObject({ status: 'reject' })}>排除对象</button>
                      {object.points.length === 4 &&
                        mmPerPixel &&
                        (['w', 'd'] as const).map((axis, i) => (
                          <label key={selected + axis}>
                            外框{axis === 'w' ? '宽' : '深'}（毫米）
                            <input
                              aria-label={'对象' + (axis === 'w' ? '宽' : '深')}
                              type="number"
                              key={JSON.stringify(object.points) + axis}
                              defaultValue={Math.round(
                                Math.hypot(
                                  object.points[i === 0 ? 1 : 3]![0] - object.points[0]![0],
                                  object.points[i === 0 ? 1 : 3]![1] - object.points[0]![1],
                                ) * mmPerPixel,
                              )}
                              onBlur={(e) => {
                                if (+e.target.value > 0) {
                                  try {
                                    changeObject({
                                      points: resizeFine(
                                        object.points,
                                        axis,
                                        +e.target.value / mmPerPixel,
                                      ),
                                    })
                                  } catch (err) {
                                    setError(String(err))
                                  }
                                }
                              }}
                            />
                          </label>
                        ))}
                      <label>
                        道具高度（毫米）
                        <input
                          aria-label="对象高度"
                          type="number"
                          value={object.heightMm ?? ''}
                          onChange={(e) =>
                            changeObject({ heightMm: e.target.value ? +e.target.value : null })
                          }
                        />
                      </label>
                      <small>未匹配真实模型时仅生成占位体；屏幕保留二维，不生成嵌墙实体。</small>
                    </>
                  )}
                  <label>
                    空间层高（毫米）
                    <input
                      aria-label="空间层高"
                      type="number"
                      value={draft.heightMm ?? ''}
                      onChange={(e) =>
                        patch({
                          heightMm: e.target.value ? +e.target.value : null,
                          structureReviewed: false,
                        })
                      }
                    />
                  </label>
                  <details>
                    <summary>开敞边与入口</summary>
                    <button
                      onClick={() =>
                        patch({
                          openEdges: draft.boundary.map((_, i) => i),
                          structureReviewed: false,
                        })
                      }
                    >
                      中岛：各边开敞
                    </button>
                    {draft.boundary.map((_, i) => (
                      <label key={i}>
                        <input
                          type="checkbox"
                          checked={draft.openEdges.includes(i)}
                          onChange={(e) =>
                            patch({
                              openEdges: e.target.checked
                                ? [...draft.openEdges, i]
                                : draft.openEdges.filter((k) => k !== i),
                              structureReviewed: false,
                            })
                          }
                        />
                        边 {i + 1} 开敞
                      </label>
                    ))}
                    <button onClick={() => patch({ entrances: [], structureReviewed: false })}>
                      清空入口
                    </button>
                  </details>
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.structureReviewed}
                      onChange={(e) => patch({ structureReviewed: e.target.checked })}
                    />
                    范围、量尺、层高与开敞边已核对
                  </label>
                  <label>
                    审核人
                    <input
                      value={draft.reviewer}
                      onChange={(e) => {
                        patch({ reviewer: e.target.value })
                        localStorage.setItem('recognition-reviewer', e.target.value)
                      }}
                      onFocus={() => {
                        if (!draft.reviewer)
                          patch({ reviewer: localStorage.getItem('recognition-reviewer') || '' })
                      }}
                    />
                  </label>
                  <label>
                    待确认/备注
                    <textarea
                      value={draft.notes}
                      onChange={(e) => patch({ notes: e.target.value })}
                    />
                  </label>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const v = unwrap(
                          await api.POST('/api/v1/uploads/{uploadId}/fine/preview', {
                            params: { path: { uploadId: upload.id } },
                            body: { revision: record.revision, draft },
                          }),
                        ) as { omissions: { id: string; label: string; reason: string }[] }
                        setOmissions(v.omissions)
                        setAck(false)
                      })
                    }
                  >
                    检查空间转换
                  </button>
                  {omissions && (
                    <>
                      <p>{omissions.length} 项只保留二维：</p>
                      <div className="fine-omissions">
                        {omissions.map((o) => (
                          <p key={o.id}>
                            {o.id} {o.label}：{o.reason}
                          </p>
                        ))}
                      </div>
                      <label>
                        <input
                          type="checkbox"
                          checked={ack}
                          onChange={(e) => setAck(e.target.checked)}
                        />
                        已核对以上清单，仅将可转换对象建模
                      </label>
                      <button
                        disabled={busy || !ack}
                        onClick={() =>
                          void act(async () => {
                            const r = unwrap(
                              await api.POST('/api/v1/uploads/{uploadId}/fine/confirm', {
                                params: { path: { uploadId: upload.id } },
                                body: {
                                  revision: record.revision,
                                  draft,
                                  name: '原图精细识别空间',
                                  acknowledgedOmissions: omissions.map((o) => o.id),
                                },
                              }),
                            ) as FineRecord
                            setRecord(r)
                            sessionStorage.removeItem('fine-draft-' + r.uploadId)
                            setSaved('已保存并生成空间')
                            if (r.confirmedNodeId) {
                              await client.invalidateQueries({
                                queryKey: workbenchKeys.tree(upload.projectId),
                              })
                              onCreated(r.confirmedNodeId)
                            }
                          })
                        }
                      >
                        生成空间并返回工作台
                      </button>
                    </>
                  )}
                </aside>
              </div>
            </>
          </fieldset>
        </>
      )}
    </section>
  )
}
