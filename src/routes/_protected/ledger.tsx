import {createFileRoute} from '@tanstack/react-router'
import {LedgerPostingsPage} from '@/components/ledger/ledger-postings-page'

export const Route = createFileRoute('/_protected/ledger')({
  component: LedgerRoute,
})

function LedgerRoute() {
  return <LedgerPostingsPage />
}
