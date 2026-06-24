import {createFileRoute} from '@tanstack/react-router'
import {LedgerDashboard} from '@/components/ledger/ledger-dashboard'

export const Route = createFileRoute('/_protected/app/transactions')({
  component: TransactionsPage,
})

function TransactionsPage() {
  return <LedgerDashboard view="transactions" />
}
