import {createFileRoute, Outlet, useRouterState} from '@tanstack/react-router'
import {BankingDashboard} from '@/components/banking/banking-dashboard'

export const Route = createFileRoute('/_protected/app/bank-accounts')({
  component: BankAccountsPage,
})

export function BankAccountsPage() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  if (pathname === '/app/bank-accounts' || pathname === '/app/bank-accounts/') {
    return <BankingDashboard />
  }

  return <Outlet />
}
