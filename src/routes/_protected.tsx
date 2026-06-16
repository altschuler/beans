import {createFileRoute, Outlet, redirect} from '@tanstack/react-router'
import {getSession} from '@/auth/session'
import {Shell} from '@/components/layout/shell'
import {AppZeroProvider} from '@/components/zero/app-zero-provider'
import {ensureCurrentUserPersonalTeam} from '@/teams/personal-team-fns'

export const Route = createFileRoute('/_protected')({
  beforeLoad: async ({location}) => {
    const session = await getSession()

    if (!session) {
      throw redirect({
        to: '/login',
        search: {redirect: location.href},
      })
    }

    const teamId = await ensureCurrentUserPersonalTeam()

    return {user: session.user, teamId}
  },
  component: ProtectedLayout,
})

function ProtectedLayout() {
  const {user} = Route.useRouteContext()

  return (
    <AppZeroProvider userID={user.id}>
      <Shell userEmail={user.email}>
        <Outlet />
      </Shell>
    </AppZeroProvider>
  )
}
