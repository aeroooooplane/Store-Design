import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, createBrowserRouter, RouterProvider } from 'react-router'
import { DisplayTaskPage } from '../features/display/DisplayTaskPage.tsx'
import { DisplayTasksPage } from '../features/display/DisplayTasksPage.tsx'
import { ProjectListPage } from '../features/projects/ProjectListPage.tsx'
import { ProjectPage } from '../features/projects/ProjectPage.tsx'
import { SettingsPage } from '../features/settings/SettingsPage.tsx'

function NotFoundPage() {
  return (
    <main className="page">
      <p className="notice">
        页面不存在。<Link to="/">返回项目列表</Link>
      </p>
    </main>
  )
}

const router = createBrowserRouter([
  { path: '/', element: <ProjectListPage /> },
  { path: '/projects/:projectId', element: <ProjectPage /> },
  { path: '/settings', element: <SettingsPage /> },
  { path: '/display', element: <DisplayTasksPage /> },
  { path: '/display/:taskId', element: <DisplayTaskPage /> },
  { path: '*', element: <NotFoundPage /> },
])

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
