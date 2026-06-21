import {useRef} from 'react'
import {useVirtualizer} from '@tanstack/react-virtual'
import {TransactionRow} from './transaction-row'
import type {CategorizationAccountOption, CategorySelection, SplitLine, TransactionTableRow as TransactionTableRowData, TransferAccountOption} from './types'

type TransactionTableProps = {
  rows: TransactionTableRowData[]
  categorizationAccounts: CategorizationAccountOption[]
  transferAccounts: TransferAccountOption[]
  isAiRequestPending: boolean
  onCategorizeBankTransaction: (bankTransactionId: string, selection: CategorySelection) => void
  onConfirmTransaction: (bankTransactionId: string) => void
  onAiCategorizeOne: (bankTransactionId: string) => void
  onSaveSplit: (row: TransactionTableRowData, splitLines: SplitLine[]) => Promise<boolean>
}

export function TransactionTable({
  rows,
  categorizationAccounts,
  transferAccounts,
  isAiRequestPending,
  onCategorizeBankTransaction,
  onConfirmTransaction,
  onAiCategorizeOne,
  onSaveSplit,
}: TransactionTableProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 56,
    getItemKey: index => rows[index]?.id ?? index,
    overscan: 8,
    initialRect: {width: 1000, height: 600},
  })
  const virtualRows = rowVirtualizer.getVirtualItems()

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No imported bank transactions yet.</p>
  }

  return (
    <div ref={scrollContainerRef} className="h-full min-h-0 flex-1 overflow-auto rounded-md border">
      <table className="grid w-full min-w-[860px] text-sm">
        <thead className="sticky top-0 z-10 bg-muted grid text-xs uppercase tracking-wide text-muted-foreground">
          <tr className="grid grid-cols-[minmax(14rem,1fr)_8rem_10rem_minmax(18rem,1fr)_5rem_8rem]">
            <th className="px-3 py-2 text-left font-semibold">Description</th>
            <th className="px-3 py-2 text-left font-semibold">Date</th>
            <th className="px-3 py-2 text-left font-semibold">Bank account</th>
            <th className="px-3 py-2 text-left font-semibold">Category</th>
            <th className="px-3 py-2 text-center font-semibold">Status</th>
            <th className="px-3 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody className="relative grid" style={{height: `${rowVirtualizer.getTotalSize()}px`}}>
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index]
            if (!row) return null

            return (
              <TransactionRow
                key={row.id}
                row={row}
                rowRef={rowVirtualizer.measureElement}
                rowStyle={{position: 'absolute', transform: `translateY(${virtualRow.start}px)`, width: '100%'}}
                rowIndex={virtualRow.index}
                categorizationAccounts={categorizationAccounts}
                transferAccounts={transferAccounts}
                isAiRequestPending={isAiRequestPending}
                onCategorizeBankTransaction={onCategorizeBankTransaction}
                onConfirmTransaction={onConfirmTransaction}
                onAiCategorizeOne={onAiCategorizeOne}
                onSaveSplit={onSaveSplit}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
