import { DISPLAY_ORIENTATION_LABELS } from '@store/shared'
import type { DisplayEdits, DisplayRules, DisplayTable } from '@store/shared'

interface SlotTableProps {
  rules: DisplayRules
  tables: DisplayTable[]
  edits: DisplayEdits
  onChange: (edits: DisplayEdits) => void
  disabled?: boolean
}

const tableTitle = (t: DisplayTable) =>
  t.kind === 'side'
    ? `边桌（${DISPLAY_ORIENTATION_LABELS[t.orientation]}）`
    : `${t.seat ?? '加桌'} 中岛桌（${DISPLAY_ORIENTATION_LABELS[t.orientation]}）`

/**
 * What every slot of every table holds, from the guide; each slot can be changed (or emptied)
 * and the accessory modules rewritten. Changes are kept per table id.
 */
export function SlotTable({ rules, tables, edits, onChange, disabled }: SlotTableProps) {
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

  return (
    <div className="slot-tables">
      {tables.map((t) => (
        <section key={t.sourceId} className="slot-table" aria-label={`${t.label}桌陈列`}>
          <header>
            <span className="picture-mark static">{t.label}</span>
            <strong>{tableTitle(t)}</strong>
            {t.custom && <span className="tag">单店单议</span>}
            {(edits.slots[t.sourceId] ?? edits.modules[t.sourceId]) && (
              <button
                type="button"
                className="link-button"
                disabled={disabled}
                onClick={() => reset(t)}
              >
                恢复规则
              </button>
            )}
          </header>
          <div className="slot-grid">
            {t.slots.map((s) => (
              <label key={s.slot} className={s.hero ? 'hero' : undefined}>
                <span>
                  {s.slot}
                  {s.hero ? ' · 明星位' : ''}
                </span>
                <select
                  value={s.unit ?? ''}
                  disabled={disabled}
                  onChange={(event) => setSlot(t, s.slot, event.target.value || null)}
                >
                  <option value="">待定</option>
                  {rules.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {t.kind === 'island' && (
            <label className="slot-modules">
              <span>配件模块</span>
              <input
                defaultValue={t.modules.join('、')}
                key={t.modules.join()}
                disabled={disabled}
                onBlur={(event) => {
                  if (event.target.value !== t.modules.join('、')) setModules(t, event.target.value)
                }}
              />
            </label>
          )}
          {t.notes.length > 0 && <p className="hint">{t.notes.join('；')}</p>}
        </section>
      ))}
    </div>
  )
}
