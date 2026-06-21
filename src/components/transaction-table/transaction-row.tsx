import {type CSSProperties} from 'react'
import {LoaderCircle} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {CategorySelector} from './category-selector'
import type {CategorizationAccountOption, CategorySelection, SplitLine, TransactionTableRow as TransactionTableRowData, TransferAccountOption} from './types'

type TransactionRowProps = {
  row: TransactionTableRowData
  categorizationAccounts: CategorizationAccountOption[]
  transferAccounts: TransferAccountOption[]
  isAiRequestPending: boolean
  onCategorizeBankTransaction: (bankTransactionId: string, selection: CategorySelection) => void
  onConfirmTransaction: (bankTransactionId: string) => void
  onAiCategorizeOne: (bankTransactionId: string) => void
  onSaveSplit: (row: TransactionTableRowData, splitLines: SplitLine[]) => Promise<boolean>
  rowStyle?: CSSProperties
  rowIndex?: number
}

export function TransactionRow({
  row,
  categorizationAccounts,
  transferAccounts,
  isAiRequestPending,
  onCategorizeBankTransaction,
  onConfirmTransaction,
  onAiCategorizeOne,
  onSaveSplit,
  rowStyle,
  rowIndex,
}: TransactionRowProps) {
  const ledgerTransactionId = row.ledgerTransactionId

  return (
    <tr data-index={rowIndex} style={rowStyle} className="grid grid-cols-[minmax(14rem,1fr)_8rem_10rem_minmax(18rem,1fr)_5rem_8rem] border-t align-middle">
      <td className="px-3 py-3 font-medium">{row.description}</td>
      <td className="px-3 py-3 text-muted-foreground">{row.date ?? 'No date'}</td>
      <td className="px-3 py-3 text-muted-foreground">{row.bankAccountName}</td>
      <td className="px-3 py-3">
        <div className="flex min-w-[14rem] items-center gap-2">
          <CategorySelector
            row={row}
            categorizationAccounts={categorizationAccounts}
            transferAccounts={transferAccounts}
            isAiRequestPending={isAiRequestPending}
            onSelect={onCategorizeBankTransaction}
            onAiCategorizeOne={onAiCategorizeOne}
            onSaveSplit={onSaveSplit}
          />
        </div>
      </td>
      <td className="px-3 py-3 text-center">
        {row.statusIndicator.kind === 'processing' ? (
          <span
            title={row.statusIndicator.title}
            aria-label={row.statusIndicator.ariaLabel}
            role="status"
            className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground"
          >
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span className="sr-only">{row.statusIndicator.ariaLabel}</span>
          </span>
        ) : ledgerTransactionId && row.canCategorize && row.statusIndicator.canConfirm ? (
          <Button
            type="button"
            variant="ghost"
            title={row.statusIndicator.title}
            aria-label={`Confirm category for ${row.description}. ${row.statusIndicator.ariaLabel}`}
            className="h-2.5 w-2.5 cursor-pointer rounded-full bg-transparent p-0 transition-[box-shadow] hover:bg-transparent hover:ring-2 hover:ring-ring/70 hover:ring-offset-2 hover:ring-offset-background"
            onClick={() => onConfirmTransaction(row.bankTransactionId)}
          >
            <span className={`block h-2.5 w-2.5 rounded-full ${row.statusIndicator.className}`} aria-hidden="true" />
            <span className="sr-only">{row.statusIndicator.ariaLabel}</span>
          </Button>
        ) : (
          <span title={row.statusIndicator.title} aria-label={row.statusIndicator.ariaLabel} role="img" className={`inline-block h-2.5 w-2.5 rounded-full ${row.statusIndicator.className}`} />
        )}
      </td>
      <td className="px-3 py-3 text-right font-mono">
        {row.amount} {row.currency}
      </td>
    </tr>
  )
}
