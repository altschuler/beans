import {createFileRoute, Outlet} from '@tanstack/react-router'
import {ProtectedAppGate} from '@/components/auth/protected-app-gate'

export const Route = createFileRoute('/_protected')({
  component: ProtectedLayout,
})

function ProtectedLayout() {
  return (
    <ProtectedAppGate>
      <Outlet />
    </ProtectedAppGate>
  )
}
