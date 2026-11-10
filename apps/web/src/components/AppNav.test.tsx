import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Route, Routes } from 'react-router'
import { renderWithClient } from '../test-utils/render.tsx'
import { AppLayout, ProjectNavSlot } from './AppNav.tsx'

afterEach(cleanup)

it('puts project actions in the project menu and project information after settings', async () => {
  renderWithClient(
    <Routes>
      <Route element={<AppLayout />}>
        <Route
          path="/projects/:projectId"
          element={
            <main>
              <ProjectNavSlot slot="actions">
                <a href="/project-export" download>
                  导出项目
                </a>
              </ProjectNavSlot>
              <ProjectNavSlot slot="info">
                <span>测试门店 · 国内 · 48 m²</span>
              </ProjectNavSlot>
              <p>工作区域</p>
            </main>
          }
        />
      </Route>
    </Routes>,
    { router: { initialEntries: ['/projects/example'] } },
  )
  const info = await screen.findByText('测试门店 · 国内 · 48 m²')
  const nav = screen.getByRole('navigation', { name: '主导航' })
  expect(nav.contains(info)).toBe(true)
  expect(screen.getByRole('main').contains(info)).toBe(false)
  expect(
    within(nav).getByRole('link', { name: '设置' }).compareDocumentPosition(info) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  const menu = nav.querySelector('details')!
  expect(menu.open).toBe(false)
  fireEvent.click(within(nav).getByText('项目', { selector: 'summary span' }))
  expect(menu.open).toBe(true)
  expect(within(menu).getByRole('link', { name: '项目列表' }).getAttribute('href')).toBe('/')
  expect(within(menu).getByRole('link', { name: '导出项目' }).getAttribute('href')).toBe(
    '/project-export',
  )
  fireEvent.keyDown(within(menu).getByRole('link', { name: '导出项目' }), { key: 'Escape' })
  expect(menu.open).toBe(false)
  fireEvent.click(within(nav).getByText('项目', { selector: 'summary span' }))
  fireEvent.pointerDown(screen.getByText('工作区域'))
  expect(menu.open).toBe(false)
})
