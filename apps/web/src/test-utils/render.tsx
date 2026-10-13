import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'

export interface RenderWithClientOptions {
  /** Defaults to a fresh client whose queries do not retry, so failures show at once. */
  client?: QueryClient
  /** Wrap in a `MemoryRouter`; pass the entries to start somewhere other than `/`. */
  router?: boolean | { initialEntries: string[] }
}

/** Renders `ui` inside a React Query provider and, when asked, a memory router. */
export function renderWithClient(ui: ReactNode, options: RenderWithClientOptions = {}) {
  const client =
    options.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { router } = options
  const routed =
    router === undefined || router === false ? (
      ui
    ) : router === true ? (
      <MemoryRouter>{ui}</MemoryRouter>
    ) : (
      <MemoryRouter initialEntries={router.initialEntries}>{ui}</MemoryRouter>
    )
  return render(<QueryClientProvider client={client}>{routed}</QueryClientProvider>)
}
