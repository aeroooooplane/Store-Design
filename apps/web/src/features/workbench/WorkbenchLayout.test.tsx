import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LeftTabContext, WorkbenchLayout } from './WorkbenchLayout.tsx'
import type { LeftTab } from './WorkbenchLayout.tsx'

afterEach(cleanup)

function Stage({
  stage,
  models = true,
  cameras = true,
}: {
  stage: string
  models?: boolean
  cameras?: boolean
}) {
  const [tab, setTab] = useState<LeftTab | null>(null)
  return (
    <LeftTabContext.Provider value={{ tab, setTab }}>
      <WorkbenchLayout
        key={stage}
        left={<p>历史内容</p>}
        center={<p>{stage}</p>}
        models={models ? <input aria-label="模型搜索" /> : undefined}
        cameras={cameras ? <p>视角内容</p> : undefined}
        background={cameras ? <p>背景内容</p> : undefined}
        defaultTab="models"
      />
    </LeftTabContext.Provider>
  )
}

const mainTabs = () => within(screen.getByRole('tablist', { name: '左栏' }))

describe('fixed workbench navigation', () => {
  it('retains all four positions and disables unavailable panels', () => {
    render(<Stage stage="空间" models={false} cameras={false} />)
    expect(
      mainTabs()
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['历史', '空间', '模型', '视角'])
    for (const name of ['模型', '视角']) {
      const tab = mainTabs().getByRole<HTMLButtonElement>('tab', { name })
      expect(tab.disabled).toBe(true)
      expect(tab.title).toContain('当前阶段不提供')
      fireEvent.click(tab)
      expect(mainTabs().getByRole('tab', { name: '历史' }).getAttribute('aria-selected')).toBe(
        'true',
      )
    }
  })

  it('keeps the chosen panel across stage remounts and falls back when unavailable', () => {
    const view = render(<Stage stage="方案" />)
    fireEvent.click(mainTabs().getByRole('tab', { name: '视角' }))
    view.rerender(<Stage stage="渲染" models={false} />)
    expect(mainTabs().getByRole('tab', { name: '视角' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('视角内容')).toBeTruthy()
    view.rerender(<Stage stage="新空间" models={false} cameras={false} />)
    expect(mainTabs().getByRole('tab', { name: '历史' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('历史内容')).toBeTruthy()
  })

  it('keeps model input mounted and places background tools inside the view panel', () => {
    render(<Stage stage="方案" />)
    fireEvent.change(screen.getByLabelText('模型搜索'), { target: { value: '柜' } })
    fireEvent.click(mainTabs().getByRole('tab', { name: '视角' }))
    fireEvent.click(screen.getByRole('tab', { name: '背景编辑' }))
    expect(mainTabs().getAllByRole('tab')).toHaveLength(4)
    expect(mainTabs().getByRole('tab', { name: '视角' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('背景内容')).toBeTruthy()
    fireEvent.click(mainTabs().getByRole('tab', { name: '模型' }))
    expect(screen.getByLabelText<HTMLInputElement>('模型搜索').value).toBe('柜')
    expect(screen.queryByText('背景内容')?.closest('[hidden]')).toBeTruthy()
  })
})
