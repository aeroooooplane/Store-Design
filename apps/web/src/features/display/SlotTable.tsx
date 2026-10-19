import { useMemo, useState } from 'react'
import { DISPLAY_ORIENTATION_LABELS } from '@store/shared'
import { photoOf } from './photos.ts'
import { UnitPicker } from './UnitPicker.tsx'
import type { PickerTarget } from './UnitPicker.tsx'
import { Table3DCard } from './table3d/Table3DCard.tsx'
import type { TableViewContext } from './table3d/shots.ts'
import type {
  DisplayEdits,
  DisplayRules,
  DisplayRulesView,
  DisplayTable,
  SiStyle,
} from '@store/shared'

interface SlotTableProps {
  rules: DisplayRules
  /** Tray photos of the rules, shown in each slot. */
  photos: DisplayRulesView['photos']
  si: SiStyle
  tables: DisplayTable[]
  edits: DisplayEdits
  onChange: (edits: DisplayEdits) => void
  disabled?: boolean
}

const tableTitle = (t: DisplayTable) =>
  t.kind === 'side'
    ? '边桌'
    : `${t.seat ?? '加桌'} 中岛桌 · ${DISPLAY_ORIENTATION_LABELS[t.orientation]}`

/**
 * What every slot of every table holds, drawn the way the table stands (as on the PPT page):
 * portrait — L1–L3 left, R1–R3 right, the modules between, the end E towards the entrance;
 * landscape — T1–T3 on top, B1–B3 below, E at the chosen end; side — S1–S3 along the wall.
 * Each slot can be changed (or emptied) and the modules rewritten. Changes are kept per table.
 */
export function SlotTable({
  rules,
  photos,
  si,
  tables,
  edits,
  onChange,
  disabled,
}: SlotTableProps) {
  const labelOf = new Map(rules.units.map((u) => [u.id, u.label]))
  const [look, setLook] = useState<'3d' | 'plan'>('3d')
  const [picking, setPicking] = useState<(PickerTarget & { table: DisplayTable }) | null>(null)
  const pick = (t: DisplayTable, slot: string, at: { x: number; y: number }) => {
    if (disabled) return
    const current = t.slots.find((s) => s.slot === slot)?.unit ?? null
    setPicking({ table: t, title: `${t.label}桌 ${slot}`, slot, current, at })
  }
  const end = edits.landscapeEnd
  const ctx = useMemo<TableViewContext>(
    () => ({ rules, photos, si, end }),
    [rules, photos, si, end],
  )
  const setSlot = (table: DisplayTable, slot: string, unit: string | null) =>
    onChange({
      ...edits,
      slots: { ...edits.slots, [table.sourceId]: { ...edits.slots[table.sourceId], [slot]: unit } },
    })
  const setModules = (table: DisplayTable, text: string) =>
    onChange({
      ...edits,
      modules: {
        ...edits.modules,
        [table.sourceId]: text
          .split(/[,，、\s]+/)
          .map((m) => m.trim())
          .filter(Boolean),
      },
    })
  const reset = (table: DisplayTable) => {
    const slots = { ...edits.slots }
    const modules = { ...edits.modules }
    delete slots[table.sourceId]
    delete modules[table.sourceId]
    onChange({ ...edits, slots, modules })
  }

  function cell(t: DisplayTable, code: string) {
    const s = t.slots.find((x) => x.slot === code)
    if (!s) return <div key={code} className="slot-cell missing" style={{ gridArea: code }} />
    const edited = edits.slots[t.sourceId]?.[code] !== undefined
    const photo = photoOf(photos, s.unit, si)
    const name = s.unit ? (labelOf.get(s.unit) ?? s.unit) : '待定'
    return (
      <button
        key={code}
        type="button"
        disabled={disabled}
        aria-label={`${t.label}桌 ${code}：${name}，点击更换`}
        onClick={(event) => {
          const r = event.currentTarget.getBoundingClientRect()
          pick(t, code, { x: r.left, y: r.bottom + 4 })
        }}
        className={[
          'slot-cell',
          code === 'E' && 'end',
          s.hero && 'hero',
          edited && 'edited',
          !s.unit && 'empty',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ gridArea: code }}
        title={`${code}${s.hero ? '（明星位）' : ''}：${name}`}
      >
        <span className="slot-head">
          <span className="slot-code">{code}</span>
          {s.hero && <span className="slot-badge">明星位</span>}
          {edited && <span className="slot-edited">已改</span>}
        </span>
        <span className="slot-photo">
          {photo ? <img src={photo.url} alt="" loading="lazy" /> : <span>无照片</span>}
        </span>
        <span className="slot-name">{name}</span>
      </button>
    )
  }

  /** The table top: slots placed by grid areas, the modules strip in the middle. */
  function board(t: DisplayTable) {
    const modules = (
      <div className="slot-modules-strip" style={{ gridArea: 'M' }} title="中间配件模块">
        {t.modules.length ? t.modules.map((m) => <span key={m}>{m}</span>) : <span>—</span>}
      </div>
    )
    if (t.kind === 'side') {
      return (
        <div className="slot-board side">
          <div className="slot-wall">靠墙</div>
          {['S1', 'S2', 'S3'].map((c) => cell(t, c))}
        </div>
      )
    }
    if (t.orientation === 'portrait') {
      return (
        <div className="slot-board portrait">
          {['L1', 'L2', 'L3', 'R1', 'R2', 'R3', 'E'].map((c) => cell(t, c))}
          {modules}
          <div className="slot-entrance">↓ 端头朝入口</div>
        </div>
      )
    }
    const endLeft = edits.landscapeEnd !== 'right'
    return (
      <div className={`slot-board landscape ${endLeft ? 'end-left' : 'end-right'}`}>
        {['T1', 'T2', 'T3', 'B1', 'B2', 'B3', 'E'].map((c) => cell(t, c))}
        {modules}
      </div>
    )
  }

  return (
    <>
      <div className="tabs slot-look" role="group" aria-label="陈列内容显示方式">
        {(
          [
            ['3d', '三维'],
            ['plan', '平面'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={look === value}
            onClick={() => setLook(value)}
          >
            {label}
          </button>
        ))}
        <span className="hint">
          {look === '3d' ? '拖动可旋转查看，点立牌即可更换产品' : '点格子即可更换产品'}
        </span>
      </div>
      <div className="slot-tables">
        {tables.map((t) => {
          const changed =
            Object.keys(edits.slots[t.sourceId] ?? {}).length + (edits.modules[t.sourceId] ? 1 : 0)
          return (
            <section key={t.sourceId} className="slot-table" aria-label={`${t.label}桌陈列`}>
              <header>
                <span className="picture-mark static">{t.label}</span>
                <strong>{tableTitle(t)}</strong>
                {t.custom && <span className="tag">单店单议</span>}
                {changed > 0 && (
                  <>
                    <span className="slot-changed">已改 {changed} 处</span>
                    <button
                      type="button"
                      className="link-button"
                      disabled={disabled}
                      onClick={() => reset(t)}
                    >
                      恢复规则
                    </button>
                  </>
                )}
              </header>
              {look === '3d' ? (
                <Table3DCard table={t} ctx={ctx} onSlotClick={(slot, at) => pick(t, slot, at)} />
              ) : (
                board(t)
              )}
              {t.kind === 'island' && (
                <label className="slot-modules">
                  <span>中间配件模块（用顿号分隔）</span>
                  <input
                    defaultValue={t.modules.join('、')}
                    key={t.modules.join()}
                    disabled={disabled}
                    onBlur={(event) => {
                      if (event.target.value !== t.modules.join('、'))
                        setModules(t, event.target.value)
                    }}
                  />
                </label>
              )}
              {t.notes.length > 0 && <p className="hint">{t.notes.join('；')}</p>}
            </section>
          )
        })}
      </div>
      {picking && (
        <UnitPicker
          target={picking}
          rules={rules}
          photos={photos}
          si={si}
          onPick={(unit) => {
            setSlot(picking.table, picking.slot, unit)
            setPicking(null)
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  )
}
