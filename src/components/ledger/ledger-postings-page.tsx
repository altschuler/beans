import {useRef} from 'react'
import {useQuery} from '@rocicorp/zero/react'
import {useVirtualizer} from '@tanstack/react-virtual'
import {Currency} from '@/components/currency'
import {PageLayout} from '@/components/page-layout'
import {queries} from '@/zero/queries'

type LedgerPostingRow = {
  id: string
  ledgerTransactionId: string
  accountName: string
  date: string
  amount: number
  currency: string
  bankTransactionId: string
  sortOrder: number | null
}

export function LedgerPostingsPage() {
  const [postings, postingsStatus] = useQuery(queries.domain.ledgerPostingsWithRelations())

  const rows = buildLedgerPostingRows({postings})
  const postingsComplete = postingsStatus.type === 'complete'
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 40,
    getItemKey: index => rows[index]?.id ?? index,
    overscan: 10,
    initialRect: {width: 1000, height: 600},
  })
  const virtualRows = rowVirtualizer.getVirtualItems()

  return (
    <PageLayout breadcrumbs={[{title: 'Ledger'}]} contentClassName="p-0">
      <div className="flex h-full min-h-0 flex-col">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground md:p-6 lg:p-8">{postingsComplete ? 'No ledger postings yet.' : 'Syncing ledger postings…'}</p>
        ) : (
          <div ref={scrollContainerRef} className="h-full min-h-0 flex-1 overflow-auto rounded-md border">
            <table className="grid w-full min-w-[980px] text-sm">
              <thead className="sticky top-0 z-10 grid bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="grid grid-cols-[7rem_minmax(12rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_8rem_6rem_minmax(10rem,1fr)_6rem]">
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
              <tbody className="relative grid" style={{height: `${rowVirtualizer.getTotalSize()}px`}}>
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index]
                  if (!row) return null

                  return (
                    <tr
                      key={row.id}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      className="grid grid-cols-[7rem_minmax(12rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_8rem_6rem_minmax(10rem,1fr)_6rem] border-t"
                      style={{position: 'absolute', transform: `translateY(${virtualRow.start}px)`, width: '100%'}}
                    >
                      <td className="px-3 py-2 whitespace-nowrap">{row.date}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.ledgerTransactionId}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.id}</td>
                      <td className="px-3 py-2">{row.accountName}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        <Currency amount={row.amount} currency={row.currency} />
                      </td>
                      <td className="px-3 py-2">{row.currency}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.bankTransactionId}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.sortOrder ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageLayout>
  )
}

function buildLedgerPostingRows(input: {
  postings: ReadonlyArray<{
    id: string
    ledgerTransactionId: string
    accountId: string
    amount: number
    currency: string
    bankTransactionId?: string | null
    sortOrder: number | null
    account?: {id: string; name: string} | undefined
    ledgerTransaction?: {id: string; date: string | null} | undefined
    bankTransaction?: {id: string; bookingDate: string | null; valueDate: string | null} | undefined
  }>
}): LedgerPostingRow[] {
  return input.postings
    .map((posting) => {
      const ledgerTransaction = posting.ledgerTransaction
      const bankTransaction = posting.bankTransaction
      return {
        id: posting.id,
        ledgerTransactionId: posting.ledgerTransactionId,
        accountName: posting.account?.name ?? 'Unknown account',
        date: ledgerTransaction?.date ?? bankTransaction?.bookingDate ?? bankTransaction?.valueDate ?? '—',
        amount: posting.amount,
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
