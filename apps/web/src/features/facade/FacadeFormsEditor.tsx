import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  FACADE_KIND_LABELS,
  facadeCornerEdges,
  facadePlacementError,
  hangingLogoSuggestion,
  islandFacadeEdges,
  reviewFacadeConfig,
  mToMm,
} from '@store/shared'
import type { FacadeConfig, FacadeKind, Market, SiStyle, Space } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { useUpdateNodeSpace } from '../workbench/api.ts'
import { FacadeNumber, FacadeSideSelect, FacadeStyleFields } from './FacadeFields.tsx'
import { FacadeFormsElevation, FacadeFormsPlan } from './FacadeFormsPreview.tsx'
import {
  defaultCornerB,
  defaultDoubleOpenings,
  facadeMm,
  initialFormDraft,
  moveFacadeSpan,
  parseFormDraft,
  placeFacadeFace,
  validFacadeEdges,
} from './facade-draft.ts'
import type { DoubleDraft, FaceDraft, FormsDraft, IslandDraft, SpanDraft } from './facade-draft.ts'

function PositionFields({
  space,
  draft,
  options,
  onEdit,
  onEdge,
  widthLabel = '门头总宽（mm）',
  sideLabel,
}: {
  space: Space
  draft: SpanDraft
  options: number[]
  onEdit: (changes: Partial<SpanDraft>) => void
  onEdge: (edge: number) => void
  widthLabel?: string
  sideLabel?: string
}) {
  return (
    <>
      <FacadeSideSelect
        space={space}
        edge={draft.edge}
        options={options}
        onChange={onEdge}
        label={sideLabel}
      />
      <FacadeNumber
        label="沿边起点（mm）"
        value={draft.offset}
        onChange={(offset) => onEdit({ offset })}
      />
      <FacadeNumber
        label={widthLabel}
        value={draft.width}
        onChange={(width) => onEdit({ width })}
      />
    </>
  )
}

function CornerFaceFields({
  label,
  face,
  space,
  si,
  options,
  onEdit,
  onEdge,
}: {
  label: string
  face: FaceDraft
  space: Space
  si: SiStyle
  options: number[]
  onEdit: (changes: Partial<FaceDraft>) => void
  onEdge: (edge: number) => void
}) {
  return (
    <fieldset className="facade-fields facade-form-group">
      <legend>{label}</legend>
      <PositionFields
        space={space}
        draft={face}
        options={options}
        onEdit={onEdit}
        onEdge={onEdge}
      />
      <FacadeNumber
        label="入口距本面左端（mm）"
        value={face.openingOffset}
        placeholder="自动定位"
        onChange={(openingOffset) => onEdit({ openingOffset })}
      />
      <FacadeNumber
        label="入口净宽（mm）"
        value={face.openingWidth}
        onChange={(openingWidth) => onEdit({ openingWidth })}
      />
      <FacadeNumber
        label="通行净高（mm）"
        value={face.clearHeight}
        onChange={(clearHeight) => onEdit({ clearHeight })}
      />
      <FacadeNumber
        label="门楣面高（mm）"
        value={face.fasciaHeight}
        onChange={(fasciaHeight) => onEdit({ fasciaHeight })}
      />
      <FacadeStyleFields si={si} settings={face} onChange={onEdit} />
      <FacadeNumber
        label="LED 屏宽（mm）"
        placeholder="按该面可用宽度"
        value={face.screenWidth}
        onChange={(screenWidth) => onEdit({ screenWidth })}
      />
      <FacadeNumber
        label="LED 内退（mm）"
        value={face.screenInset}
        onChange={(screenInset) => onEdit({ screenInset })}
      />
      <label className="facade-checkbox">
        <input
          type="checkbox"
          checked={face.logo}
          onChange={(event) => onEdit({ logo: event.currentTarget.checked })}
        />
        显示本面居中 LOGO
      </label>
    </fieldset>
  )
}

function CornerFields({
  draft,
  space,
  si,
  change,
}: {
  draft: Extract<FormsDraft, { kind: 'corner' }>
  space: Space
  si: SiStyle
  change: (draft: FormsDraft) => void
}) {
  const [a, b] = draft.faces
  const pick = (face: FaceDraft, edge: number) => {
    const next = placeFacadeFace(space, edge)
    return {
      ...face,
      edge,
      offset: next.offset,
      width: next.width,
      openingWidth: next.openingWidth,
      openingOffset: next.openingOffset,
    }
  }
  return (
    <>
      <CornerFaceFields
        label="面 A"
        face={a}
        space={space}
        si={si}
        options={validFacadeEdges(space)}
        onEdit={(edit) => change({ ...draft, faces: [{ ...a, ...edit }, b] })}
        onEdge={(edge) =>
          change({
            ...draft,
            faces: [
              pick(a, edge),
              facadeCornerEdges(space, edge).includes(b.edge)
                ? b
                : pick(b, defaultCornerB(space, edge)),
            ],
          })
        }
      />
      <CornerFaceFields
        label="面 B"
        face={b}
        space={space}
        si={si}
        options={facadeCornerEdges(space, a.edge)}
        onEdit={(edit) => change({ ...draft, faces: [a, { ...b, ...edit }] })}
        onEdge={(edge) => change({ ...draft, faces: [a, pick(b, edge)] })}
      />
    </>
  )
}

function DoubleFields({
  draft,
  space,
  si,
  change,
}: {
  draft: DoubleDraft
  space: Space
  si: SiStyle
  change: (draft: FormsDraft) => void
}) {
  const edit = (patch: Partial<DoubleDraft>) => change({ ...draft, ...patch })
  const si1 = si === 'SI1.0'
  const key = si1 ? 'si1Logos' : 'si2Logos'
  return (
    <>
      <div className="facade-fields">
        <PositionFields
          space={space}
          draft={draft}
          options={validFacadeEdges(space)}
          onEdit={edit}
          onEdge={(edge) => {
            const span = moveFacadeSpan(space, edge)
            edit({ ...span, openings: defaultDoubleOpenings(space, Number(span.width) / 1000) })
          }}
        />
        <FacadeNumber
          label="门楣面高（mm）"
          value={draft.fasciaHeight}
          onChange={(fasciaHeight) => edit({ fasciaHeight })}
        />
        <FacadeNumber
          label="LED 内退（mm）"
          value={draft.screenInset}
          onChange={(screenInset) => edit({ screenInset })}
        />
        <FacadeStyleFields si={si} settings={draft} onChange={edit} />
        <label>
          中间门楣
          <select
            value={draft.joint}
            onChange={(event) => {
              const joint = event.currentTarget.value
              edit({ joint: joint === 'break' || joint === 'display' ? joint : 'continuous' })
            }}
          >
            <option value="continuous">连续保留</option>
            <option value="display">连续 · 下方留展示位</option>
            <option value="break">实际断开</option>
          </select>
        </label>
        <label>
          字标数量
          <select
            value={draft[key]}
            onChange={(event) => {
              const value = event.currentTarget.value
              edit({ [key]: value === 'single' || value === 'double' ? value : 'auto' })
            }}
          >
            <option value="auto">{si1 ? '按双字标案例预览' : '按手册建议'}</option>
            <option value="single">单 LOGO</option>
            <option value="double">双 LOGO</option>
          </select>
        </label>
        {(draft.joint !== 'continuous' || si1) && (
          <label>
            主入口
            <select
              value={draft.primary}
              onChange={(event) => {
                const primary = event.currentTarget.value
                edit({ primary: primary === 'a' || primary === 'b' ? primary : 'auto' })
              }}
            >
              <option value="auto">采用较宽开口</option>
              <option value="a">开口 A</option>
              <option value="b">开口 B</option>
            </select>
          </label>
        )}
        {draft.joint === 'break' && (
          <label className="facade-checkbox facade-field-wide">
            <input
              type="checkbox"
              checked={draft.fireBreak}
              onChange={(event) => edit({ fireBreak: event.currentTarget.checked })}
            />
            断开处为消防设施
          </label>
        )}
      </div>
      <p className="hint">从门头外正看，分别录入两个开口距同一左端的距离。</p>
      {draft.openings.map((slot, index) => {
        const set = (patch: Partial<typeof slot>) => {
          const openings: DoubleDraft['openings'] = [...draft.openings]
          openings[index] = { ...slot, ...patch }
          edit({ openings })
        }
        return (
          <fieldset key={index} className="facade-fields facade-form-group">
            <legend>{index === 0 ? '开口 A' : '开口 B'}</legend>
            <FacadeNumber
              label="距门头左端（mm）"
              value={slot.offset}
              onChange={(offset) => set({ offset })}
            />
            <FacadeNumber
              label="开口净宽（mm）"
              value={slot.width}
              onChange={(width) => set({ width })}
            />
            <FacadeNumber
              label="通行净高（mm）"
              value={slot.clearHeight}
              onChange={(clearHeight) => set({ clearHeight })}
            />
            <FacadeNumber
              label="独立 LED 屏宽（mm）"
              placeholder="按本段可用宽度"
              value={slot.screenWidth}
              onChange={(screenWidth) => set({ screenWidth })}
            />
          </fieldset>
        )
      })}
    </>
  )
}

function HangingFields({
  draft,
  space,
  si,
  change,
}: {
  draft: IslandDraft
  space: Space
  si: SiStyle
  change: (draft: FormsDraft) => void
}) {
  const edit = (patch: Partial<IslandDraft>) => change({ ...draft, ...patch })
  const manual = si === 'SI1.0'
  const suggestion = hangingLogoSuggestion(Number(draft.top) / 1000)
  const tiltAvailable = draft.corridorRestricted && Number(draft.top) > 3000
  const edges = islandFacadeEdges(space)
  return (
    <>
      {edges.length === 0 && <p className="hint">请先在「修改空间」中设置地台开放边。</p>}
      <div className="facade-fields">
        <PositionFields
          space={space}
          draft={draft}
          options={edges}
          onEdit={edit}
          onEdge={(edge) => edit(moveFacadeSpan(space, edge, true))}
          sideLabel="地台开放边"
          widthLabel="悬吊段宽（mm）"
        />
        <FacadeNumber
          label="顶部距完成地面（mm）"
          value={draft.top}
          onChange={(top) => edit({ top })}
        />
        <FacadeNumber
          label="吊梁面高（mm）"
          value={draft.beamHeight}
          onChange={(beamHeight) => edit({ beamHeight })}
        />
        <FacadeNumber
          label="两侧立柱各宽（mm）"
          value={draft.postWidth}
          onChange={(postWidth) => edit({ postWidth })}
          placeholder="0 表示无立柱"
        />
        <label className="facade-field-wide">
          字标朝向
          <select
            value={draft.face}
            onChange={(event) =>
              edit({ face: event.currentTarget.value === 'inward' ? 'inward' : 'outward' })
            }
          >
            <option value="outward">朝开放边外</option>
            <option value="inward">朝地台内</option>
          </select>
        </label>
        {manual ? (
          <>
            <FacadeNumber
              label="手填 LOGO 字高（mm）"
              placeholder="必填"
              value={draft.si1LogoHeight}
              onChange={(si1LogoHeight) => edit({ si1LogoHeight })}
            />
            <FacadeNumber
              label="手填吊距（mm）"
              placeholder="必填"
              value={draft.si1Drop}
              onChange={(si1Drop) => edit({ si1Drop })}
            />
          </>
        ) : (
          <>
            <FacadeNumber
              label="LOGO 字高（mm）"
              value={draft.si2LogoHeight}
              placeholder={suggestion ? facadeMm(suggestion) + '（建议）' : '请手填'}
              onChange={(si2LogoHeight) => edit({ si2LogoHeight })}
            />
            <label>
              字顶距梁底（mm）
              <input type="number" value={50} readOnly />
            </label>
            <label className="facade-checkbox">
              <input
                type="checkbox"
                checked={draft.corridorRestricted}
                onChange={(event) => edit({ corridorRestricted: event.currentTarget.checked })}
              />
              走廊受限
            </label>
            <label className="facade-checkbox">
              <input
                type="checkbox"
                checked={tiltAvailable && draft.tiltInward}
                disabled={!tiltAvailable}
                onChange={(event) => edit({ tiltInward: event.currentTarget.checked })}
              />
              内倾 15°
            </label>
          </>
        )}
      </div>
      {!manual && <p className="hint">走廊受限且门头顶部高于 3000 mm 时，可选内倾 15°。</p>}
    </>
  )
}

export function FacadeFormsEditor({
  space,
  projectId,
  nodeId,
  siStyle,
  market,
  onClose,
  kind,
  formPicker,
}: {
  space: Space
  projectId: string
  nodeId: string
  siStyle: SiStyle
  market: Market
  onClose: () => void
  kind: Exclude<FacadeKind, 'straight'>
  formPicker?: ReactNode
}) {
  const [initial] = useState(space)
  const [draft, change] = useState<FormsDraft>(() => initialFormDraft(initial, kind))
  const [remove, setRemove] = useState(false)
  const mutation = useUpdateNodeSpace(projectId, nodeId)
  const config = parseFormDraft(initial, draft)
  const placementError = config ? facadePlacementError(initial, config) : '请填写有效的定位和尺寸。'
  const preview =
    config && !placementError ? reviewFacadeConfig(initial, config, siStyle, market) : null
  const hanging = draft.kind === 'island_hanging'
  const manual = hanging && siStyle === 'SI1.0'
  const clearance = preview?.clearance
  const canSave = config && preview && (!hanging || (clearance !== undefined && clearance > 0))
  function save(value: FacadeConfig | undefined) {
    const next = { ...initial }
    if (value) next.facade = value
    else delete next.facade
    void mutation
      .mutateAsync({ space: next, previousSpace: initial })
      .then(onClose, () => undefined)
  }

  return (
    <section className="wb-card facade-editor" aria-label="门头设置">
      <h2>设置门头</h2>
      {formPicker}
      <p className="hint">
        {FACADE_KIND_LABELS[kind]} · {siStyle}
        {manual ? ' · 手填预览 · 待复核' : ''}
      </p>
      <ErrorMessage error={mutation.error} />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (canSave && !mutation.isPending) save(config)
        }}
      >
        <div className="facade-editor-grid">
          <div className="facade-editor-previews">
            <section>
              <h3>平面定位</h3>
              <FacadeFormsPlan space={initial} config={config} sections={preview?.sections ?? []} />
            </section>
            {preview &&
              (draft.kind === 'corner' ? (
                preview.sections.slice(0, 2).map((section) => (
                  <section key={section.label}>
                    <h3>{section.label} 正立面</h3>
                    <FacadeFormsElevation sections={[section]} si={siStyle} market={market} />
                  </section>
                ))
              ) : (
                <section>
                  <h3>正立面预览</h3>
                  <FacadeFormsElevation sections={preview.sections} si={siStyle} market={market} />
                </section>
              ))}
          </div>
          <div className="facade-editor-fields">
            {draft.kind === 'corner' && (
              <CornerFields draft={draft} space={initial} si={siStyle} change={change} />
            )}
            {draft.kind === 'double' && (
              <DoubleFields draft={draft} space={initial} si={siStyle} change={change} />
            )}
            {draft.kind === 'island_hanging' && (
              <HangingFields draft={draft} space={initial} si={siStyle} change={change} />
            )}
            {clearance !== undefined && (
              <p className="facade-review-summary">字标最低点距完成地面 {mToMm(clearance)} mm</p>
            )}
            {hanging && clearance === undefined && (
              <p className="hint">填写字高{manual ? '和吊距' : ''}后显示悬吊字标及净空。</p>
            )}
            {draft.kind === 'double' && preview && (
              <p className="facade-review-summary">
                双开口 · {preview.sections.reduce((sum, section) => sum + section.logos.length, 0)}{' '}
                个 LOGO
              </p>
            )}
            {placementError && (
              <p className="error" role="status">
                {placementError}
              </p>
            )}
            {!!preview?.issues.length && (
              <div className="facade-review" role="status">
                <strong>待复核</strong>
                <ul>
                  {preview.issues.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
        <div className="toolbar facade-editor-actions">
          <button type="submit" className="primary" disabled={!canSave || mutation.isPending}>
            {manual ? '保存手填预览' : '保存到当前节点'}
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
