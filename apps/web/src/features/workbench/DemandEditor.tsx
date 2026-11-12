import { useState } from 'react'
import { DemandSchema, ITEM_FUNCTION_LABELS } from '@store/shared'
import type { Demand } from '@store/shared'

export function DemandEditor({
  demand,
  busy,
  onSave,
  onDirty,
}: {
  demand: Demand | undefined
  busy: boolean
  onSave: (value: Demand) => Promise<void>
  onDirty: (dirty: boolean) => void
}) {
  const [draft, setDraft] = useState(demand)
  const [error, setError] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(demand)
  function change(next: Demand | undefined) {
    setDraft(next)
    onDirty(JSON.stringify(next) !== JSON.stringify(demand))
  }
  async function importFile(file: File | undefined) {
    if (!file) return
    try {
      if (file.size > 500000) throw new Error('清单文件过大')
      const parsed = DemandSchema.parse(JSON.parse(await file.text()))
      if (demand?.sourceStoreId && parsed.sourceStoreId !== demand.sourceStoreId)
        throw new Error('门店编号不一致')
      change(parsed)
      setError('')
    } catch {
      setError('清单无效或门店不一致，请检查后重试。')
    }
  }
  return (
    <details open={!!draft} className="demand-editor">
      <summary>
        必配道具{draft ? ` · ${draft.entities.reduce((n, e) => n + e.quantity, 0)}件` : ' · 未设置'}
      </summary>
      <p className="hint">
        按实体计数，组合台只算一件。数量适用于本店；重新生成保留轮廓、墙柱和禁放区。
      </p>
      <label>
        导入道具清单
        <input
          aria-label="导入道具清单"
          type="file"
          accept=".json"
          disabled={busy}
          onChange={(e) => {
            void importFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </label>
      {draft && (
        <table>
          <thead>
            <tr>
              <th>道具</th>
              <th>功能</th>
              <th>数量</th>
            </tr>
          </thead>
          <tbody>
            {draft.entities.map((e, i) => (
              <tr key={e.id}>
                <td>{e.label}</td>
                <td>{e.roles.map((r) => ITEM_FUNCTION_LABELS[r]).join(' / ')}</td>
                <td>
                  <input
                    aria-label={`${e.label}数量`}
                    type="number"
                    min={0}
                    max={200}
                    value={e.quantity}
                    disabled={busy}
                    onChange={(event) =>
                      change({
                        ...draft,
                        entities: draft.entities.map((row, j) =>
                          i === j ? { ...row, quantity: Number(event.target.value) } : row,
                        ),
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {dirty && <p className="hint">数量尚未保存；保存后可重新生成。</p>}
      {dirty && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const result = DemandSchema.safeParse(draft)
              if (!result.success) {
                setError('数量须为整数，总数不超过200件。')
                return
              }
              setError('')
              void onSave(result.data).catch(() => setError('保存失败，清单仍保留，请重试。'))
            }}
          >
            保存清单为新版本
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              change(demand)
              setError('')
            }}
          >
            取消修改
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </details>
  )
}
