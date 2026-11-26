import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, createBrowserRouter, createHashRouter, redirect, RouterProvider } from 'react-router'
import type { LoaderFunctionArgs, RouteObject } from 'react-router'
import { isBoldSite, isFullWorkbench, isProjectPilot } from '../api/deployment.ts'
import { AppLayout } from '../components/AppNav.tsx'
import { DisplayTaskPage } from '../features/display/DisplayTaskPage.tsx'
import { DisplayTasksPage } from '../features/display/DisplayTasksPage.tsx'
import { ProjectListPage } from '../features/projects/ProjectListPage.tsx'
import { ProjectPage } from '../features/projects/ProjectPage.tsx'
import { SettingsPage } from '../features/settings/SettingsPage.tsx'
import { CloudConnection } from './CloudConnection.tsx'

function NotFoundPage() {
  return (
    <main className="page">
      <p className="notice">
        页面不存在。<Link to="/">返回项目列表</Link>
      </p>
    </main>
  )
}

function PilotUnavailablePage() {
  return (
    <main className="page">
      <p className="notice">
        此入口暂未开放。<Link to="/">返回项目列表</Link>
      </p>
    </main>
  )
}

const pages: RouteObject[] = [
  { path: '/', element: <ProjectListPage /> },
  { path: '/projects/:projectId', element: <ProjectPage /> },
  ...(isProjectPilot
    ? [
        {
          path: '/projects/:projectId/design',
          lazy: async () => ({
            Component: (await import('../features/projects/PilotLayoutPage.tsx')).PilotLayoutPage,
          }),
        },
      ]
    : isFullWorkbench
      ? [
          {
            path: '/projects/:projectId/design',
            loader: ({ params }: LoaderFunctionArgs) =>
              redirect(`/projects/${encodeURIComponent(params.projectId ?? '')}`),
          },
        ]
      : []),
  { path: '/settings', element: isProjectPilot ? <PilotUnavailablePage /> : <SettingsPage /> },
  { path: '/display', element: isProjectPilot ? <PilotUnavailablePage /> : <DisplayTasksPage /> },
  {
    path: '/display/:taskId',
    element: isProjectPilot ? <PilotUnavailablePage /> : <DisplayTaskPage />,
  },
  { path: '*', element: <NotFoundPage /> },
]
const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: isBoldSite ? [{ element: <CloudConnection />, children: pages }] : pages,
  },
]
const router = isBoldSite ? createHashRouter(routes) : createBrowserRouter(routes)

export function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
