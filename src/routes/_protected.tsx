import {createFileRoute, Outlet, redirect} from '@tanstack/react-router'
import {getSession} from '@/auth/session'
import {Shell} from '@/components/layout/shell'
import {AppZeroProvider} from '@/components/zero/app-zero-provider'

export const Route = createFileRoute('/_protected')({
  beforeLoad: async ({location}) => {
    const session = await getSession()

    if (!session) {
      throw redirect({
        to: '/login',
        search: {redirect: location.href},
      })
    }

    return {user: session.user}
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
