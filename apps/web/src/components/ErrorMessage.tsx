import { ApiRequestError } from '../api/client.ts'

/** Shows an API failure with its request id so problems can be traced in the server log. */
export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : '发生未知错误'
  const requestId = error instanceof ApiRequestError ? error.requestId : undefined
  return (
    <div className="error" role="alert">
      {message}
      {requestId ? <small> （请求编号 {requestId}）</small> : null}
    </div>
  )
}
