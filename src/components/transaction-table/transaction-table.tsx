import {TransactionRow} from './transaction-row'
import type {CategorizationAccountOption, SplitLine, TransactionTableRow as TransactionTableRowData} from './types'

type TransactionTableProps = {
  rows: TransactionTableRowData[]
  categorizationAccounts: CategorizationAccountOption[]
  isAiRequestPending: boolean
  onCategorizeTransaction: (ledgerTransactionId: string, accountId: string) => void
  onConfirmTransaction: (ledgerTransactionId: string) => void
  onAiCategorizeOne: (ledgerTransactionId: string) => void
  onSaveSplit: (row: TransactionTableRowData, splitLines: SplitLine[]) => Promise<boolean>
}

export function TransactionTable({
  rows,
  categorizationAccounts,
  isAiRequestPending,
  onCategorizeTransaction,
  onConfirmTransaction,
  onAiCategorizeOne,
  onSaveSplit,
}: TransactionTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No imported ledger transactions yet.</p>
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="sticky top-0 z-10 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Description</th>
            <th className="px-3 py-2 text-left font-semibold">Date</th>
            <th className="px-3 py-2 text-left font-semibold">Bank account</th>
            <th className="px-3 py-2 text-left font-semibold">Category</th>
            <th className="px-3 py-2 text-center font-semibold">Status</th>
            <th className="px-3 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <TransactionRow
              key={row.id}
              row={row}
              categorizationAccounts={categorizationAccounts}
              isAiRequestPending={isAiRequestPending}
              onCategorizeTransaction={onCategorizeTransaction}
              onConfirmTransaction={onConfirmTransaction}
              onAiCategorizeOne={onAiCategorizeOne}
              onSaveSplit={onSaveSplit}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
