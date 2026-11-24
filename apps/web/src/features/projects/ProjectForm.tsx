import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  MARKET_LABELS,
  MARKETS,
  ProjectCreateSchema,
  SHOP_TYPE_LABELS,
  SHOP_TYPES,
  SI_STYLES,
} from '@store/shared'
import type { Market, ProjectCreate, ShopType, SiStyle } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'

interface ProjectFormProps {
  initial: ProjectCreate
  label: string
  saving: boolean
  error: unknown
  onSave: (project: ProjectCreate) => Promise<unknown>
  clearNameOnSave?: boolean
}

export function ProjectForm({
  initial,
  label,
  saving,
  error,
  onSave,
  clearNameOnSave,
}: ProjectFormProps) {
  const [name, setName] = useState(initial.name)
  const [shopType, setShopType] = useState(initial.shopType)
  const [market, setMarket] = useState(initial.market)
  const [siStyle, setSiStyle] = useState(initial.siStyle)
  const [formError, setFormError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = ProjectCreateSchema.safeParse({ name, shopType, market, siStyle })
    if (!parsed.success) {
      setFormError('请填写项目名称（1–100 个字符）')
      return
    }
    setFormError(null)
    void onSave(parsed.data).then(
      () => {
        if (clearNameOnSave) setName('')
      },
      () => {
        // The owning mutation exposes the error to the form.
      },
    )
  }

  return (
    <form className="create-form" onSubmit={submit} aria-label={label}>
      <label>
        项目名称
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="请输入项目名称"
          aria-invalid={formError ? true : undefined}
        />
      </label>
      <label>
        铺位形态
        <select value={shopType} onChange={(e) => setShopType(e.target.value as ShopType)}>
          {SHOP_TYPES.map((value) => (
            <option key={value} value={value}>
              {SHOP_TYPE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label>
        市场
        <select value={market} onChange={(e) => setMarket(e.target.value as Market)}>
          {MARKETS.map((value) => (
            <option key={value} value={value}>
              {MARKET_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label>
        SI 风格
        <select value={siStyle} onChange={(e) => setSiStyle(e.target.value as SiStyle)}>
          {SI_STYLES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="primary" disabled={saving}>
        {label}
      </button>
      {formError && (
        <div className="error inline" role="alert" style={{ gridColumn: '1 / -1' }}>
          {formError}
        </div>
      )}
      <div style={{ gridColumn: '1 / -1' }}>
        <ErrorMessage error={error} />
      </div>
    </form>
  )
}
