import {useQuery} from '@rocicorp/zero/react'
import {PageLayout} from '@/components/page-layout'
import {queries} from '@/zero/queries'

type LedgerPostingRow = {
  id: string
  ledgerTransactionId: string
  accountName: string
  date: string
  amount: string
  currency: string
  bankTransactionId: string
  sortOrder: number | null
}

export function LedgerPostingsPage() {
  const [accounts] = useQuery(queries.domain.ledgerAccounts())
  const [ledgerTransactions] = useQuery(queries.domain.ledgerTransactions())
  const [postings] = useQuery(queries.domain.ledgerPostings())
  const [bankTransactions] = useQuery(queries.domain.bankTransactions())

  const rows = buildLedgerPostingRows({accounts, ledgerTransactions, postings, bankTransactions})

  return (
    <PageLayout breadcrumbs={[{title: 'Ledger'}]} contentClassName="p-0">
      <div className="flex h-full min-h-0 flex-col">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground md:p-6 lg:p-8">No ledger postings yet.</p>
        ) : (
          <div className="h-full min-h-0 flex-1 overflow-auto rounded-md border">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Date</th>
                  <th className="px-3 py-2 text-left font-semibold">Transaction ID</th>
                  <th className="px-3 py-2 text-left font-semibold">Posting ID</th>
                  <th className="px-3 py-2 text-left font-semibold">Account</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                  <th className="px-3 py-2 text-left font-semibold">Currency</th>
                  <th className="px-3 py-2 text-left font-semibold">Bank transaction</th>
                  <th className="px-3 py-2 text-right font-semibold">Sort order</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">{row.date}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.ledgerTransactionId}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.id}</td>
                    <td className="px-3 py-2">{row.accountName}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.amount}</td>
                    <td className="px-3 py-2">{row.currency}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.bankTransactionId}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.sortOrder ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageLayout>
  )
}

function buildLedgerPostingRows(input: {
  accounts: ReadonlyArray<{id: string; name: string}>
  ledgerTransactions: ReadonlyArray<{id: string; date: string | null}>
  postings: ReadonlyArray<{
    id: string
    ledgerTransactionId: string
    accountId: string
    amount: string | number
    currency: string
    bankTransactionId?: string | null
    sortOrder: number | null
  }>
  bankTransactions: ReadonlyArray<{id: string; bookingDate: string | null; valueDate: string | null}>
}): LedgerPostingRow[] {
  const accountsById = new Map(input.accounts.map((account) => [account.id, account]))
  const ledgerTransactionsById = new Map(input.ledgerTransactions.map((transaction) => [transaction.id, transaction]))
  const bankTransactionsById = new Map(input.bankTransactions.map((transaction) => [transaction.id, transaction]))

  return input.postings
    .map((posting) => {
      const ledgerTransaction = ledgerTransactionsById.get(posting.ledgerTransactionId)
      const bankTransaction = posting.bankTransactionId ? bankTransactionsById.get(posting.bankTransactionId) : undefined
      return {
        id: posting.id,
        ledgerTransactionId: posting.ledgerTransactionId,
        accountName: accountsById.get(posting.accountId)?.name ?? 'Unknown account',
        date: ledgerTransaction?.date ?? bankTransaction?.bookingDate ?? bankTransaction?.valueDate ?? '—',
        amount: String(posting.amount),
        currency: posting.currency,
        bankTransactionId: posting.bankTransactionId ?? '—',
        sortOrder: posting.sortOrder,
      }
    })
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) ||
        left.ledgerTransactionId.localeCompare(right.ledgerTransactionId) ||
        (left.sortOrder ?? 0) - (right.sortOrder ?? 0),
    )
}
