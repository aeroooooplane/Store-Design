import { useId, useState } from 'react'
import {
  FacadeSchema,
  FACADE_PRESET_LABELS,
  SI1_FACADE_GRADES,
  SI1_FACADE_PRESETS,
  SI2_FACADE_GRADES,
  SI2_FACADE_PRESETS,
  facadeEdgeSize,
  facadeRun,
  facadeSpan,
  facadeWordmark,
  mToMm,
  mmToM,
  reviewFacade,
  roundM,
  suggestedFacadeEdge,
} from '@store/shared'
import type { Facade, Market, SiStyle, Space } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { useUpdateNodeSpace } from '../workbench/api.ts'
import { facadeColors, facadePieces } from './appearance.ts'
import type { FacadePreview } from './appearance.ts'

export function FacadeCard({
  space,
  siStyle,
  market,
  onEdit,
  disabled,
}: {
  space: Space
  siStyle: SiStyle
  market: Market
  onEdit: () => void
  disabled: boolean
}) {
  const reviewed = space.facade && reviewFacade(space, space.facade, siStyle, market)
  return (
    <details className="space-info-card">
      <summary>门头</summary>
      <div className="facade-card-body">
        {reviewed && space.facade ? (
          <>
            <span>常规直边 · {FACADE_PRESET_LABELS[reviewed.preset]}</span>
            <small>
              总宽 {mToMm(reviewed.frame.width)} mm · 净高 {mToMm(space.facade.clearHeight)} mm
            </small>
            {reviewed.issues.length > 0 && <small>待复核 {reviewed.issues.length} 项</small>}
          </>
        ) : (
          <small>{space.facade ? '需要重新定位到直边' : '尚未设置'}</small>
        )}
        <button type="button" onClick={onEdit} disabled={disabled}>
          设置门头
        </button>
      </div>
    </details>
  )
}

type Dimensions = Record<
  | 'offset'
  | 'width'
  | 'openingWidth'
  | 'clearHeight'
  | 'fasciaHeight'
  | 'screenInset'
  | 'screenWidth',
  string
>
type Settings = Pick<Facade, 'si1' | 'si2'>

function initialDraft(space: Space) {
  const facade = space.facade
  const run = facade && facadeRun(space.boundary, facade)
  const edge = run ? run.edge : suggestedFacadeEdge(space)
  const info = facadeEdgeSize(space, edge)
  const mm = (value: number) => String(mToMm(value))
  return {
    edge,
    dims: {
      offset: mm(run ? run.offset : 0),
      width: mm(run ? run.width : info.length),
      openingWidth: mm(facade?.openingWidth ?? info.openingWidth),
      fasciaHeight: mm(facade?.fasciaHeight ?? 0.6),
      clearHeight: mm(facade?.clearHeight ?? Math.max(0.1, space.height - 0.6)),
      screenInset: mm(facade?.screenInset ?? 0.05),
      screenWidth: facade?.screenWidth === undefined ? '' : mm(facade.screenWidth),
    },
    settings: {
      ...(facade?.si1 ? { si1: facade.si1 } : {}),
      ...(facade?.si2 ? { si2: facade.si2 } : {}),
    },
  }
}

function parseFacade(space: Space, edge: number, dims: Dimensions, settings: Settings) {
  const metres = (key: keyof Dimensions) => (dims[key] === '' ? NaN : mmToM(Number(dims[key])))
  const span = facadeSpan(space.boundary, edge, metres('offset'), metres('width'))
  if (!span) return { error: '门头起点和总宽必须落在同一条直边上。' }
  const parsed = FacadeSchema.safeParse({
    ...span,
    ...(settings.si1?.grade || settings.si1?.preset ? { si1: settings.si1 } : {}),
    ...(settings.si2?.grade || settings.si2?.preset ? { si2: settings.si2 } : {}),
    openingWidth: metres('openingWidth'),
    clearHeight: metres('clearHeight'),
    fasciaHeight: metres('fasciaHeight'),
    screenInset: metres('screenInset'),
    ...(dims.screenWidth === '' ? {} : { screenWidth: metres('screenWidth') }),
  })
  if (!parsed.success)
    return {
      error: '检查尺寸。入口净宽和净高至少 100 mm，面高和填写的屏宽至少 50 mm，内退为 0–2000 mm。',
    }
  if (parsed.data.openingWidth > metres('width')) return { error: '入口净宽不能超过门头总宽。' }
  return { facade: parsed.data }
}

function FacadePlan({ space, facade }: { space: Space; facade?: Facade | undefined }) {
  const xs = space.boundary.map((p) => p[0])
  const zs = space.boundary.map((p) => p[1])
  const w = Math.max(...xs) - Math.min(...xs)
  const d = Math.max(...zs) - Math.min(...zs)
  const pad = Math.max(w, d) * 0.08
  return (
    <svg
      className="facade-position"
      role="img"
      aria-label="门头平面定位"
      viewBox={[Math.min(...xs) - pad, Math.min(...zs) - pad, w + 2 * pad, d + 2 * pad].join(' ')}
    >
      <polygon
        className="facade-position-boundary"
        points={space.boundary.map((p) => p.join(',')).join(' ')}
      />
      {space.entrances.map((e, i) => (
        <line
          key={i}
          className="facade-position-entrance"
          x1={e.a[0]}
          y1={e.a[1]}
          x2={e.b[0]}
          y2={e.b[1]}
        />
      ))}
      {facade && (
        <>
          <line
            className="facade-plan-span"
            x1={facade.a[0]}
            y1={facade.a[1]}
            x2={facade.b[0]}
            y2={facade.b[1]}
          />
          <circle
            className="facade-position-start"
            cx={facade.a[0]}
            cy={facade.a[1]}
            r={pad * 0.19}
          >
            <title>沿边起点</title>
          </circle>
        </>
      )}
    </svg>
  )
}

function FacadeElevation({
  facade,
  preview,
  siStyle,
  market,
}: {
  facade: Facade
  preview: FacadePreview
  siStyle: SiStyle
  market: Market
}) {
  const gradient = useId().replace(/:/g, '')
  const top = facade.clearHeight + facade.fasciaHeight
  const { width, openingStart, openingEnd } = preview.frame
  const font = Math.max(0.16, Math.max(width, top) * 0.033)
  const pad = font * 3.5
  const colors = facadeColors(siStyle)
  const logo = facadeWordmark(market)
  const logoScale = preview.logoHeight / logo.height
  const logoY = top - facade.clearHeight - preview.logoOffset - preview.logoHeight
  const right = width + font * 1.5
  const left = -font * 1.5
  const dimension = (x: number, y: number, height: number, label: string) => (
    <g>
      <path
        d={`M${x - font * 0.2},${y}h${font * 0.4} M${x},${y}v${height} m${-font * 0.2},0h${font * 0.4}`}
      />
      <text
        x={x}
        y={y + height / 2}
        transform={`rotate(-90 ${x} ${y + height / 2})`}
        dy={-font * 0.3}
      >
        {label}
      </text>
    </g>
  )
  return (
    <svg
      className="facade-elevation"
      role="img"
      aria-label="门头正立面"
      data-facade-preset={preview.preset}
      viewBox={[
        -pad,
        Math.min(0, logoY) - pad,
        width + 2 * pad,
        top + 2 * pad - Math.min(0, logoY),
      ].join(' ')}
    >
      <defs>
        <linearGradient id={gradient} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop stopColor="#344d63" />
          <stop offset="1" stopColor="#849eac" />
        </linearGradient>
      </defs>
      <rect
        x={openingStart}
        y={facade.fasciaHeight}
        width={openingEnd - openingStart}
        height={facade.clearHeight}
        className="facade-elevation-opening"
      />
      {facadePieces(facade, preview).map((p, i) => (
        <rect
          key={i}
          x={p.x}
          y={top - p.y - p.h}
          width={p.w}
          height={p.h}
          fill={p.finish === 'screen' ? `url(#${gradient})` : colors[p.finish]}
        />
      ))}
      <g
        fill="#fffdf4"
        transform={`translate(${(width - preview.logoWidth) / 2} ${logoY}) scale(${logoScale})`}
      >
        {logo.paths.map((part, index) => (
          <path key={index} d={part.d} fillRule={part.evenOdd ? 'evenodd' : 'nonzero'} />
        ))}
      </g>
      <g className="facade-elevation-dims" fontSize={font} textAnchor="middle">
        <path
          d={`M0,${top}h${width} M0,${-font * 1.1}h${width} M0,${-font * 1.35}v${font * 0.5} M${width},${-font * 1.35}v${font * 0.5}`}
        />
        <text x={width / 2} y={-font * 1.38}>
          {mToMm(width)} mm
        </text>
        {dimension(
          left,
          facade.fasciaHeight,
          facade.clearHeight,
          `净高 ${mToMm(facade.clearHeight)}`,
        )}
        {dimension(right, 0, facade.fasciaHeight, `面高 ${mToMm(facade.fasciaHeight)}`)}
        <path d={`M${openingStart},${top + font * 0.8}H${openingEnd}`} />
        <text x={(openingStart + openingEnd) / 2} y={top + font * 1.8}>
          净宽 {mToMm(facade.openingWidth)} mm
        </text>
      </g>
    </svg>
  )
}

export function FacadeEditor({
  space,
  projectId,
  nodeId,
  siStyle,
  market,
  onClose,
}: {
  space: Space
  projectId: string
  nodeId: string
  siStyle: SiStyle
  market: Market
  onClose: () => void
}) {
  const [initial] = useState(space)
  const [draft, setDraft] = useState(() => initialDraft(initial))
  const [remove, setRemove] = useState(false)
  const mutation = useUpdateNodeSpace(projectId, nodeId)
  const result = parseFacade(initial, draft.edge, draft.dims, draft.settings)
  const facade = result.facade
  const preview = facade && reviewFacade(initial, facade, siStyle, market)
  const si1 = siStyle === 'SI1.0'
  const current = si1 ? draft.settings.si1 : draft.settings.si2
  const presets = si1 ? SI1_FACADE_PRESETS : SI2_FACADE_PRESETS
  const grades = si1 ? SI1_FACADE_GRADES : SI2_FACADE_GRADES

  function selectEdge(edge: number) {
    const s = facadeEdgeSize(initial, edge)
    setDraft((old) => ({
      ...old,
      edge,
      dims: {
        ...old.dims,
        offset: '0',
        width: String(mToMm(s.length)),
        openingWidth: String(mToMm(s.openingWidth)),
      },
    }))
  }

  function setGrade(value: string) {
    if (si1) {
      const grade = SI1_FACADE_GRADES.find((option) => option === value)
      setDraft((old) => ({
        ...old,
        settings: { ...old.settings, si1: { ...old.settings.si1, grade } },
      }))
    } else {
      const grade = SI2_FACADE_GRADES.find((option) => option === value)
      setDraft((old) => ({
        ...old,
        settings: { ...old.settings, si2: { ...old.settings.si2, grade } },
      }))
    }
  }

  function setPreset(value: string) {
    if (si1) {
      const preset = SI1_FACADE_PRESETS.find((option) => option === value)
      setDraft((old) => ({
        ...old,
        settings: { ...old.settings, si1: { ...old.settings.si1, preset } },
      }))
    } else {
      const preset = SI2_FACADE_PRESETS.find((option) => option === value)
      setDraft((old) => ({
        ...old,
        settings: { ...old.settings, si2: { ...old.settings.si2, preset } },
      }))
    }
  }

  function save(value: Facade | undefined) {
    const next = { ...initial }
    if (value) next.facade = value
    else delete next.facade
    void mutation
      .mutateAsync({ space: next, previousSpace: initial })
      .then(onClose, () => undefined)
  }

  const field = (label: string, key: keyof Dimensions, placeholder?: string) => (
    <label>
      {label}
      <input
        type="number"
        inputMode="numeric"
        step={1}
        value={draft.dims[key]}
        placeholder={placeholder}
        onChange={(event) => {
          const value = event.currentTarget.value
          setDraft((old) => ({ ...old, dims: { ...old.dims, [key]: value } }))
        }}
      />
    </label>
  )

  return (
    <section className="wb-card facade-editor" aria-label="门头设置">
      <h2>设置门头</h2>
      <p className="hint">常规直边边厅 · {siStyle}。先核对所在边，再录入实测门头和通行尺寸。</p>
      <ErrorMessage error={mutation.error} />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (facade && !mutation.isPending) save(facade)
        }}
      >
        <div className="facade-editor-grid">
          <div className="facade-editor-previews">
            <section>
              <h3>平面定位</h3>
              <FacadePlan space={initial} facade={facade} />
            </section>
            <section>
              <h3>正立面预览</h3>
              {facade && preview ? (
                <FacadeElevation
                  facade={facade}
                  preview={preview}
                  siStyle={siStyle}
                  market={market}
                />
              ) : (
                <p className="hint">填写有效尺寸后显示正立面。</p>
              )}
            </section>
          </div>
          <div className="facade-editor-fields">
            <div className="facade-fields">
              <label className="facade-field-wide">
                所在边
                <select
                  value={draft.edge}
                  onChange={(e) => selectEdge(Number(e.currentTarget.value))}
                >
                  {initial.boundary.map((_, i) => (
                    <option key={i} value={i} disabled={facadeEdgeSize(initial, i).length < 0.1}>
                      第 {i + 1} 边 · {mToMm(facadeEdgeSize(initial, i).length)} mm
                      {i === suggestedFacadeEdge(initial) ? '（建议）' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {field('沿边起点（mm）', 'offset')}
              {field('门头总宽（mm）', 'width')}
              {field('入口净宽（mm）', 'openingWidth')}
              {field('通行净高（mm）', 'clearHeight')}
              {field('门楣面高（mm）', 'fasciaHeight')}
            </div>
            <div className="facade-fields">
              <label>
                {siStyle} 门店等级
                <select
                  value={current?.grade ?? ''}
                  onChange={(event) => setGrade(event.currentTarget.value)}
                >
                  <option value="">未指定</option>
                  {grades.map((grade) => (
                    <option key={grade} value={grade}>
                      {grade} 级
                    </option>
                  ))}
                </select>
              </label>
              <label>
                门头款式
                <select
                  value={current?.preset ?? ''}
                  onChange={(event) => setPreset(event.currentTarget.value)}
                >
                  <option value="">自动推荐</option>
                  <optgroup label="实体面板门头">
                    {presets
                      .filter((item) => item === 'steel' || item === 'aluminium')
                      .map((item) => (
                        <option key={item} value={item}>
                          {FACADE_PRESET_LABELS[item]}
                          {si1 ? '' : '（B/C 级）'}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="LED 屏幕门头">
                    {presets
                      .filter((item) => item === 'led' || item === 'led_strip')
                      .map((item) => (
                        <option key={item} value={item}>
                          {FACADE_PRESET_LABELS[item]}
                          {si1 ? '' : item === 'led_strip' ? '（S 级）' : '（A 级）'}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </label>
              {preview?.usesLed && (
                <>
                  {field('LED 屏宽（mm）', 'screenWidth', '使用总宽')}
                  {field('LED 内退（mm）', 'screenInset')}
                </>
              )}
            </div>
            {preview && facade && (
              <p className="facade-review-summary">
                {FACADE_PRESET_LABELS[preview.preset]} · LOGO 字高 {mToMm(preview.logoHeight)} mm ·
                顶部标高 {mToMm(roundM(facade.clearHeight + facade.fasciaHeight))} mm
              </p>
            )}
            {result.error && (
              <p className="error" role="status">
                {result.error}
              </p>
            )}
            {preview?.issues.length ? (
              <div className="facade-review" role="status">
                <strong>待复核</strong>
                <ul>
                  {preview.issues.map((issue) => (
                    <li key={issue.code}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
        <div className="toolbar facade-editor-actions">
          <button type="submit" className="primary" disabled={!facade || mutation.isPending}>
            保存到当前节点
          </button>
          <button type="button" onClick={onClose} disabled={mutation.isPending}>
            取消
          </button>
          {space.facade && !remove && (
            <button type="button" onClick={() => setRemove(true)} disabled={mutation.isPending}>
              移除门头
            </button>
          )}
          {remove && (
            <button type="button" onClick={() => save(undefined)} disabled={mutation.isPending}>
              确认移除
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
