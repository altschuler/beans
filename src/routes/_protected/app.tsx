import {createFileRoute, Outlet, useRouterState} from '@tanstack/react-router'
import {LedgerDashboard} from '@/components/ledger/ledger-dashboard'

export const Route = createFileRoute('/_protected/app')({
  component: AppPage,
})

function AppPage() {
  const pathname = useRouterState({select: state => state.location.pathname})

  if (pathname === '/app' || pathname === '/app/') {
    return <LedgerDashboard />
  }

  return <Outlet />
}
