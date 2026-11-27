import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  MARKET_LABELS,
  MARKETS,
  ProjectCreateSchema,
  STORE_TYPE_LABELS,
  STORE_TYPES,
  StoreTypeSchema,
  SI_STYLES,
} from '@store/shared'
import type { Market, ProjectCreate, SiStyle, StoreType } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'

interface ProjectFormProps {
  initial: Omit<ProjectCreate, 'storeType'> & { storeType?: StoreType | null }
  requireStoreType?: boolean
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
  requireStoreType,
}: ProjectFormProps) {
  const [name, setName] = useState(initial.name)
  const [storeType, setStoreType] = useState<StoreType | ''>(initial.storeType ?? '')
  const [market, setMarket] = useState(initial.market)
  const [siStyle, setSiStyle] = useState(initial.siStyle)
  const [formError, setFormError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = ProjectCreateSchema.safeParse({
      name,
      shopType: initial.shopType,
      storeType: storeType || undefined,
      market,
      siStyle,
    })
    if (!parsed.success) {
      setFormError('请填写项目名称（1–100 个字符）')
      return
    }
    if (requireStoreType && !storeType) {
      setFormError('请选择店铺类型')
      return
    }
    setFormError(null)
    void onSave(parsed.data).then(
      () => {
        if (clearNameOnSave) {
          setName('')
          setStoreType('')
        }
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
        店铺类型
        <select
          value={storeType}
          onChange={(event) => {
            const next = StoreTypeSchema.safeParse(event.target.value)
            if (next.success) setStoreType(next.data)
          }}
        >
          <option value="" disabled>
            请选择
          </option>
          {STORE_TYPES.map((value) => (
            <option key={value} value={value}>
              {STORE_TYPE_LABELS[value]}
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
