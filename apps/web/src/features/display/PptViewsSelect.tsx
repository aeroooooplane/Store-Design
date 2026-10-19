import { DISPLAY_PPT_VIEWS, DISPLAY_PPT_VIEW_LABELS } from '@store/shared'
import type { DisplayPptViews } from '@store/shared'

/** Which pages each table gets in the PPT: 3D, the slot diagram, or both. */
export function PptViewsSelect({
  value,
  onChange,
  disabled,
}: {
  value: DisplayPptViews
  onChange: (value: DisplayPptViews) => void
  disabled?: boolean
}) {
  return (
    <label className="ppt-views">
      <span>PPT 单桌页</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as DisplayPptViews)}
      >
        {DISPLAY_PPT_VIEWS.map((v) => (
          <option key={v} value={v}>
            {DISPLAY_PPT_VIEW_LABELS[v]}
          </option>
        ))}
      </select>
    </label>
  )
}
