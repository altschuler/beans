import type {ReactNode} from 'react'
import {ZeroProvider} from '@rocicorp/zero/react'
import {mutators} from '@/zero/mutators'
import {schema} from '@/zero/schema'

export function AppZeroProvider({children, userID}: {children: ReactNode; userID: string}) {
  return (
    <ZeroProvider
      userID={userID}
      context={{userID}}
      cacheURL={import.meta.env.VITE_PUBLIC_ZERO_CACHE_URL ?? 'http://localhost:4848'}
      schema={schema}
      mutators={mutators}
      storageKey="penge"
    >
      {children}
    </ZeroProvider>
  )
}
