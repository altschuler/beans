import {useMemo, type ReactNode} from 'react'
import {FlueProvider} from '@flue/react'
import {createFlueClient} from '@flue/sdk'

function resolveFlueBaseUrl() {
  if (typeof window !== 'undefined') return '/api/flue'
  return `${process.env.VITE_PUBLIC_APP_URL ?? 'https://localhost:3100'}/api/flue`
}

export function AppFlueProvider({children}: {children: ReactNode}) {
  const client = useMemo(() => createFlueClient({baseUrl: resolveFlueBaseUrl(), fetch: (input, init) => globalThis.fetch(input, init)}), [])
  return <FlueProvider client={client}>{children}</FlueProvider>
}
