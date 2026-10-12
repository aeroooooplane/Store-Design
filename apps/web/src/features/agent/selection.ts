import { createContext, useContext } from 'react'

/** The props selected on the plan, handed to the agent as context with each message. */
export interface AgentSelection {
  ids: string[]
  set: (ids: string[]) => void
}

export const AgentSelectionContext = createContext<AgentSelection>({ ids: [], set: () => {} })

export function useAgentSelection(): AgentSelection {
  return useContext(AgentSelectionContext)
}
