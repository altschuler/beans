import {createFileRoute} from '@tanstack/react-router'
import {LedgerDashboard} from '@/components/ledger/ledger-dashboard'

export const Route = createFileRoute('/_protected/app/bank-accounts/$bankAccountId')({
  component: BankAccountTransactionsPage,
})

function BankAccountTransactionsPage() {
  const {bankAccountId} = Route.useParams()
  return <LedgerDashboard view="bankAccountTransactions" bankAccountId={bankAccountId} />
}
