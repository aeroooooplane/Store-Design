import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DisplayRules } from '@store/shared'
import { UnitPicker } from './UnitPicker.tsx'

afterEach(cleanup)
it('无图片也显示托盘规格和状态，SI切换不混入另一版本，点击传回确切组合', () => {
  const id = 'unit'
  const rules: DisplayRules = {
    version: '2026-10-30',
    source: '',
    notes: [],
    products: [],
    trays: [],
    layouts: [],
    modules: [],
    seatModules: [],
    photos: [],
    expected: [],
    units: [{ id, label: '产品', products: [], tray: 'tray' }],
  }
  rules.catalog = [
    {
      si: 'SI2.0',
      source: 'source',
      row: 1,
      name: 'SI2.0 场景托盘',
      group: 'scene',
      status: '打样，待确认',
      units: [id],
    },
    {
      si: 'SI1.0',
      source: 'source',
      row: 2,
      name: '旧明星托盘',
      group: 'hero',
      status: '消耗即止',
      units: [id],
    },
  ]
  const onPick = vi.fn()
  render(
    <UnitPicker
      rules={rules}
      photos={[]}
      si="SI2.0"
      target={{ title: 'A桌', slot: 'E', current: null, at: { x: 10, y: 10 } }}
      onPick={onPick}
      onClose={() => {}}
    />,
  )
  expect(screen.getByText('SI2.0 场景托盘')).toBeTruthy()
  expect(screen.getByText('暂无图片')).toBeTruthy()
  expect(screen.getByText('打样，待确认')).toBeTruthy()
  expect(screen.queryByText('旧明星托盘')).toBeNull()
  fireEvent.click(screen.getByText('SI2.0 场景托盘'))
  expect(onPick).toHaveBeenCalledWith(id)
})
