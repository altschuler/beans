import {useMemo, type ReactNode} from 'react'
import {FlueProvider} from '@flue/react'
import {createFlueClient} from '@flue/sdk'

function resolveFlueBaseUrl() {
  if (typeof window !== 'undefined') return '/api/flue'
  return `${process.env.VITE_PUBLIC_APP_URL ?? 'https://localhost:3100'}/api/flue`
}

// Temporary Section 5/6 compatibility boundary for the existing categorization trace only.
// It deliberately has no Ask Penge request rewriting or chat context state.
export function WorkflowFlueProvider({children}: {children: ReactNode}) {
  const client = useMemo(() => createFlueClient({baseUrl: resolveFlueBaseUrl()}), [])
  return <FlueProvider client={client}>{children}</FlueProvider>
}
