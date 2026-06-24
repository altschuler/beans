import {createFileRoute} from '@tanstack/react-router'
import {LedgerAccountDetail} from '@/components/ledger/ledger-account-detail'

export const Route = createFileRoute('/_protected/app/accounts/$accountId')({
  component: AccountDetailRoute,
})

function AccountDetailRoute() {
  const {accountId} = Route.useParams()
  return <LedgerAccountDetail accountId={accountId} />
}
