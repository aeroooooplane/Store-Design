import { useId, useState } from 'react'
import {
  CeilingKindSchema,
  ceilingChoices,
  ceilingLabel,
  effectiveCeiling,
  recommendedCeiling,
} from '@store/shared'
import type { CeilingKind, ShopType, SiStyle, Space } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { useUpdateNodeSpace } from './api.ts'
import './ceiling-card.css'

export function CeilingCard({
  projectId,
  nodeId,
  space,
  shop,
  si,
  visible,
  disabled,
  flush,
  onToggle,
}: {
  projectId: string
  nodeId: string
  space: Space
  shop: ShopType
  si: SiStyle
  visible: boolean
  disabled: boolean
  flush: () => Promise<boolean>
  onToggle: (visible: boolean) => void
}) {
  const label = useId()
  const mutation = useUpdateNodeSpace(projectId, nodeId)
  const [saving, setSaving] = useState(false)
  const [flushError, setFlushError] = useState(false)
  const choices = ceilingChoices(shop)
  const current = effectiveCeiling(space, shop, si)
  const saved = space.ceiling && choices.includes(space.ceiling) ? space.ceiling : ''
  const locked = disabled || saving || mutation.isPending
  const recommended = recommendedCeiling(space, shop, si)

  async function save(kind: CeilingKind | undefined) {
    setSaving(true)
    setFlushError(false)
    try {
      if (!(await flush())) {
        setFlushError(true)
        return
      }
      const next = { ...space }
      if (kind === undefined) delete next.ceiling
      else next.ceiling = kind
      try {
        await mutation.mutateAsync({ space: next, previousSpace: space })
        if (kind === 'none') onToggle(false)
      } catch {
        // The mutation supplies the API error below.
      }
    } catch {
      setFlushError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-info-card space-ceiling-card" aria-labelledby={label}>
      <header className="space-info-heading">
        <h3 id={label}>天花</h3>
        {current !== 'none' && (
          <button
            type="button"
            aria-pressed={visible}
            disabled={locked}
            onClick={() => onToggle(!visible)}
          >
            {visible ? '隐藏天花' : '显示天花'}
          </button>
        )}
      </header>
      {choices.length ? (
        <label className="space-ceiling-choice">
          天花做法
          <select
            value={saved}
            disabled={locked}
            onChange={(event) => {
              const value = event.currentTarget.value
              const parsed = CeilingKindSchema.safeParse(value)
              if (!value || (parsed.success && choices.includes(parsed.data))) {
                void save(parsed.data)
              }
            }}
          >
            <option value="">
              {shop === 'island' ? '默认' : '自动'} · {ceilingLabel(recommended, si)}
            </option>
            {choices.map((kind) => (
              <option key={kind} value={kind}>
                {ceilingLabel(kind, si)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="hint">无天花</p>
      )}
      {flushError && <p role="alert">请先保存当前节点，再设置天花。</p>}
      <ErrorMessage error={mutation.error} />
    </section>
  )
}
