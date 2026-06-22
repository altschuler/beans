import {useEffect, type ReactNode} from 'react'
import {ZeroProvider, useZero} from '@rocicorp/zero/react'
import {mutators} from '@/zero/mutators'
import {queries} from '@/zero/queries'
import {schema} from '@/zero/schema'

const CORE_QUERY_PRELOAD_TTL = '30m'

export function AppZeroProvider({children, userID}: {children: ReactNode; userID: string}) {
  // Client optimistic mutators read ctx.userID; server endpoints re-derive the trusted user from the session.
  return (
    <ZeroProvider
      userID={userID}
      context={{userID}}
      cacheURL={import.meta.env.VITE_PUBLIC_ZERO_CACHE_URL ?? 'http://localhost:4848'}
      schema={schema}
      mutators={mutators}
    >
      <CoreZeroQueryPreloader />
      {children}
    </ZeroProvider>
  )
}

function CoreZeroQueryPreloader() {
  const zero = useZero()

  useEffect(() => {
    const preloads = [
      zero.preload(queries.domain.teams(), {ttl: CORE_QUERY_PRELOAD_TTL}),
      zero.preload(queries.domain.bankAccounts(), {ttl: CORE_QUERY_PRELOAD_TTL}),
      zero.preload(queries.domain.bankTransactions(), {ttl: CORE_QUERY_PRELOAD_TTL}),
      zero.preload(queries.domain.ledgerAccountGroups(), {ttl: CORE_QUERY_PRELOAD_TTL}),
      zero.preload(queries.domain.ledgerAccounts(), {ttl: CORE_QUERY_PRELOAD_TTL}),
      zero.preload(queries.domain.ledgerTransactions(), {ttl: CORE_QUERY_PRELOAD_TTL}),
      zero.preload(queries.domain.ledgerPostings(), {ttl: CORE_QUERY_PRELOAD_TTL}),
    ]

    return () => {
      for (const preload of preloads) {
        preload.cleanup()
      }
    }
  }, [zero])

  return null
}
