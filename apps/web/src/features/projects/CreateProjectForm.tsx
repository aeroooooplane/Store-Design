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
import type { Market, ShopType, SiStyle } from '@store/shared'
import { ErrorMessage } from '../../components/ErrorMessage.tsx'
import { useCreateProject } from './queries.ts'

export function CreateProjectForm() {
  const [name, setName] = useState('')
  const [shopType, setShopType] = useState<ShopType>('side_hall')
  const [market, setMarket] = useState<Market>('domestic')
  const [siStyle, setSiStyle] = useState<SiStyle>('SI1.0')
  const [formError, setFormError] = useState<string | null>(null)
  const create = useCreateProject()

  function submit(event: FormEvent) {
    event.preventDefault()
    // Same rules as the server; the server still validates on its own.
    const parsed = ProjectCreateSchema.safeParse({ name, shopType, market, siStyle })
    if (!parsed.success) {
      setFormError('请填写项目名称（1–100 个字符）')
      return
    }
    setFormError(null)
    create.mutate(parsed.data, { onSuccess: () => setName('') })
  }

  return (
    <form className="create-form" onSubmit={submit} aria-label="新建项目">
      <label>
        项目名称
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="例如：南京德基广场"
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
      <button type="submit" className="primary" disabled={create.isPending}>
        新建项目
      </button>
      {formError ? (
        <div className="error" role="alert" style={{ gridColumn: '1 / -1' }}>
          {formError}
        </div>
      ) : null}
      <div style={{ gridColumn: '1 / -1' }}>
        <ErrorMessage error={create.error} />
      </div>
    </form>
  )
}
