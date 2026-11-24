import { useQuery } from '@tanstack/react-query'
import { Outlet } from 'react-router'
import { apiHref } from '../api/deployment'

type Connection = 'online' | 'preview' | 'unavailable'

async function connection(): Promise<Connection> {
  try {
    const result = await fetch(apiHref('/api/v1/health'), {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (result.status === 404 || result.status === 405) return 'preview'
    if (!result.ok) return 'unavailable'
    if (!result.headers.get('content-type')?.includes('application/json')) return 'preview'
    const data: unknown = await result.json()
    if (!data || typeof data !== 'object') return 'unavailable'
    // The separate deployment diagnostic has a different data contract from the workbench.
    if ('db_ok' in data && !('database' in data)) return 'preview'
    return 'status' in data && data.status === 'ok' && 'database' in data && data.database === 'ok'
      ? 'online'
      : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

export function CloudConnection() {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['cloud-connection'],
    queryFn: connection,
    staleTime: Infinity,
    retry: false,
  })
  if (data === 'online') return <Outlet />
  return (
    <main className="page">
      <p className="notice" role="status">
        {isFetching
          ? '正在连接工作台服务…'
          : data === 'preview'
            ? '预览模式，部署后数据可用。'
            : '暂时无法连接工作台服务。若正在使用平台预览，部署后数据可用。'}
      </p>
      {!isFetching && (
        <button type="button" className="button" onClick={() => void refetch()}>
          重新连接
        </button>
      )}
    </main>
  )
}
