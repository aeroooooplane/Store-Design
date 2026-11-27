import {
  FACADE_PRESET_LABELS,
  SI1_FACADE_GRADES,
  SI1_FACADE_PRESETS,
  SI2_FACADE_GRADES,
  SI2_FACADE_PRESETS,
  facadeEdgeSize,
  mToMm,
} from '@store/shared'
import type { Facade, SiStyle, Space } from '@store/shared'

export type FacadeSettings = Pick<Facade, 'si1' | 'si2'>

export function FacadeStyleFields({
  si,
  settings,
  onChange,
}: {
  si: SiStyle
  settings: FacadeSettings
  onChange: (settings: FacadeSettings) => void
}) {
  const si1 = si === 'SI1.0'
  const current = si1 ? settings.si1 : settings.si2
  const grades = si1 ? SI1_FACADE_GRADES : SI2_FACADE_GRADES
  const presets = si1 ? SI1_FACADE_PRESETS : SI2_FACADE_PRESETS
  return (
    <>
      <label>
        {si} 门店等级
        <select
          value={current?.grade ?? ''}
          onChange={(event) => {
            const value = event.currentTarget.value
            onChange(
              si1
                ? {
                    ...settings,
                    si1: {
                      ...settings.si1,
                      grade: SI1_FACADE_GRADES.find((grade) => grade === value),
                    },
                  }
                : {
                    ...settings,
                    si2: {
                      ...settings.si2,
                      grade: SI2_FACADE_GRADES.find((grade) => grade === value),
                    },
                  },
            )
          }}
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
          onChange={(event) => {
            const value = event.currentTarget.value
            onChange(
              si1
                ? {
                    ...settings,
                    si1: {
                      ...settings.si1,
                      preset: SI1_FACADE_PRESETS.find((preset) => preset === value),
                    },
                  }
                : {
                    ...settings,
                    si2: {
                      ...settings.si2,
                      preset: SI2_FACADE_PRESETS.find((preset) => preset === value),
                    },
                  },
            )
          }}
        >
          <option value="">自动推荐</option>
          <optgroup label="实体面板门头">
            {presets
              .filter((preset) => preset === 'steel' || preset === 'aluminium')
              .map((preset) => (
                <option key={preset} value={preset}>
                  {FACADE_PRESET_LABELS[preset]}
                  {si1 ? '' : '（B/C 级）'}
                </option>
              ))}
          </optgroup>
          <optgroup label="LED 屏幕门头">
            {presets
              .filter((preset) => preset === 'led' || preset === 'led_strip')
              .map((preset) => (
                <option key={preset} value={preset}>
                  {FACADE_PRESET_LABELS[preset]}
                  {si1 ? '' : preset === 'led_strip' ? '（S 级）' : '（A 级）'}
                </option>
              ))}
          </optgroup>
        </select>
      </label>
    </>
  )
}

export function FacadeNumber({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string | undefined
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        inputMode="numeric"
        step={1}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  )
}

export function FacadeSideSelect({
  space,
  edge,
  onChange,
  options,
  label = '所在边',
}: {
  space: Space
  edge: number
  onChange: (edge: number) => void
  options: number[]
  label?: string
}) {
  return (
    <label className="facade-field-wide">
      {label}
      <select value={edge} onChange={(event) => onChange(Number(event.currentTarget.value))}>
        {!options.includes(edge) && (
          <option value={edge} disabled>
            请选择有效边
          </option>
        )}
        {options.map((option) => (
          <option key={option} value={option}>
            第 {option + 1} 边 · {mToMm(facadeEdgeSize(space, option).length)} mm
          </option>
        ))}
      </select>
    </label>
  )
}
