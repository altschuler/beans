import {createFileRoute, Outlet, useRouterState} from '@tanstack/react-router'
import {BankingDashboard} from '@/components/banking/banking-dashboard'

export const Route = createFileRoute('/_protected/app/banks')({
  component: BanksPage,
})

export function BanksPage() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  if (pathname === '/app/banks' || pathname === '/app/banks/') {
    return <BankingDashboard />
  }

  return <Outlet />
}
