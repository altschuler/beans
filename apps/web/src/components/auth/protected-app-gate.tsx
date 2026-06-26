import {useEffect, useState, type ReactNode} from 'react'
import {useRouter, useRouterState} from '@tanstack/react-router'
import {authClient} from '@/auth/client'
import {Shell} from '@/components/layout/shell'
import {AppFlueProvider} from '@/components/flue/app-flue-provider'
import {AppZeroProvider} from '@/components/zero/app-zero-provider'
import {ensureCurrentUserPersonalTeam} from '@/teams/personal-team-fns'
import {resolveAuthRedirectTarget} from './redirect'

type ProtectedUser = {
  id: string
  email: string
  name?: string | null
}

type ProtectedAppState =
  | {status: 'checking-session'}
  | {status: 'redirecting'}
  | {status: 'initializing-team'}
  | {status: 'error'; message: string}
  | {status: 'ready'; user: ProtectedUser}

type ProtectedAppViewProps = {
  children?: ReactNode
  state: ProtectedAppState
}

export function ProtectedAppGate({children}: {children: ReactNode}) {
  const router = useRouter()
  const href = useRouterState({select: state => state.location.href})
  const session = authClient.useSession()
  const user = session.data?.user
  const userId = user?.id
  const [teamState, setTeamState] = useState<{status: 'ready' | 'error'; userId?: string; message?: string}>()

  useEffect(() => {
    if (session.isPending || userId) return

    void router.navigate({to: '/login', search: {redirect: resolveAuthRedirectTarget(href)}})
  }, [href, router, session.isPending, userId])

  useEffect(() => {
    if (!userId) return

    let cancelled = false

    ensureCurrentUserPersonalTeam()
      .then(() => {
        if (!cancelled) setTeamState({status: 'ready', userId})
      })
      .catch(error => {
        if (!cancelled) {
          setTeamState({status: 'error', userId, message: error instanceof Error ? error.message : 'Unable to prepare workspace'})
        }
      })

    return () => {
      cancelled = true
    }
  }, [userId])

  if (session.isPending) {
    return <ProtectedAppView state={{status: 'checking-session'}} />
  }

  if (!user) {
    return <ProtectedAppView state={{status: 'redirecting'}} />
  }

  if (teamState?.status === 'error' && teamState.userId === user.id) {
    return <ProtectedAppView state={{status: 'error', message: teamState.message ?? 'Unable to prepare workspace'}} />
  }

  if (teamState?.status !== 'ready' || teamState.userId !== user.id) {
    return <ProtectedAppView state={{status: 'initializing-team'}} />
  }

  return <ProtectedAppView state={{status: 'ready', user}}>{children}</ProtectedAppView>
}

export function ProtectedAppView({children, state}: ProtectedAppViewProps) {
  if (state.status === 'checking-session') {
    return <FullPageStatus>Checking session…</FullPageStatus>
  }

  if (state.status === 'redirecting') {
    return <FullPageStatus>Redirecting to sign in…</FullPageStatus>
  }

  if (state.status === 'initializing-team') {
    return <FullPageStatus>Preparing your workspace…</FullPageStatus>
  }

  if (state.status === 'error') {
    return <FullPageStatus>{state.message}</FullPageStatus>
  }

  return (
    <AppZeroProvider userID={state.user.id}>
      <AppFlueProvider>
        <Shell userEmail={state.user.email} userName={state.user.name} userId={state.user.id}>
          {children}
        </Shell>
      </AppFlueProvider>
    </AppZeroProvider>
  )
}

function FullPageStatus({children}: {children: ReactNode}) {
  return <main className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-muted-foreground">{children}</main>
}
