import {lazy, Suspense, type ReactNode} from 'react'
import type {ZeroOptions} from '@rocicorp/zero'
import {mutators} from '@/zero/mutators'
import {schema} from '@/zero/schema'

const LazyZeroProvider = lazy(() =>
  import('@rocicorp/zero/react').then(module => ({
    default: module.ZeroProvider,
  })),
)

export function AppZeroProvider({children, userID}: {children: ReactNode; userID: string}) {
  const opts: ZeroOptions = {
    userID,
    context: {userID},
    cacheURL: import.meta.env.VITE_PUBLIC_ZERO_CACHE_URL ?? 'http://localhost:4848',
    schema,
    mutators,
    storageKey: 'penge',
  }

  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Starting local sync…</p>}>
      <LazyZeroProvider {...opts}>{children}</LazyZeroProvider>
    </Suspense>
  )
}
