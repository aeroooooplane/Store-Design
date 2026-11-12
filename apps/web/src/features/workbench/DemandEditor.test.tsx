import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, it, expect, vi } from 'vitest'
import { DemandSchema } from '@store/shared'
import { DemandEditor } from './DemandEditor.tsx'
afterEach(cleanup)
it('数量修改可取消、校验并保存；保留来源与几何无关字段', async () => {
  const demand = DemandSchema.parse({
    schemaVersion: 1,
    sourceStoreId: 'test',
    entities: [{ id: 'a', label: '收银', roles: ['cashier'], quantity: 1 }],
  })
  const onSave = vi.fn().mockResolvedValue(undefined),
    onDirty = vi.fn()
  render(<DemandEditor demand={demand} busy={false} onSave={onSave} onDirty={onDirty} />)
  fireEvent.change(screen.getByLabelText('收银数量'), { target: { value: '2' } })
  expect(onDirty).toHaveBeenLastCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: '取消修改' }))
  expect(screen.getByLabelText<HTMLInputElement>('收银数量').value).toBe('1')
  fireEvent.change(screen.getByLabelText('收银数量'), { target: { value: '201' } })
  fireEvent.click(screen.getByRole('button', { name: '保存清单为新版本' }))
  expect(onSave).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('不超过200')
  fireEvent.change(screen.getByLabelText('收银数量'), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: '保存清单为新版本' }))
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      ...demand,
      entities: [{ ...demand.entities[0], quantity: 3 }],
    }),
  )
})
