import {Fragment, useState} from 'react'
import {GitBranch, Sparkles} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {SplitEditor} from './split-editor'
import type {CategorizationAccountOption, SplitLine, TransactionTableRow as TransactionTableRowData} from './types'

type TransactionRowProps = {
  row: TransactionTableRowData
  categorizationAccounts: CategorizationAccountOption[]
  isAiRequestPending: boolean
  onCategorizeTransaction: (ledgerTransactionId: string, accountId: string) => void
  onConfirmTransaction: (ledgerTransactionId: string) => void
  onAiCategorizeOne: (ledgerTransactionId: string) => void
  onSaveSplit: (row: TransactionTableRowData, splitLines: SplitLine[]) => Promise<boolean>
}

export function TransactionRow({
  row,
  categorizationAccounts,
  isAiRequestPending,
  onCategorizeTransaction,
  onConfirmTransaction,
  onAiCategorizeOne,
  onSaveSplit,
}: TransactionRowProps) {
  const [isSplitEditorOpen, setIsSplitEditorOpen] = useState(false)
  const [splitLines, setSplitLines] = useState<SplitLine[]>([])

  function openSplitEditor() {
    setSplitLines(getInitialSplitLines(row, categorizationAccounts))
    setIsSplitEditorOpen(true)
  }

  async function saveSplit() {
    const didSave = await onSaveSplit(row, splitLines)
    if (!didSave) return

    setIsSplitEditorOpen(false)
    setSplitLines([])
  }

  return (
    <Fragment>
      <tr className="border-t align-middle">
        <td className="px-3 py-3 font-medium">{row.description}</td>
        <td className="px-3 py-3 text-muted-foreground">{row.date ?? 'No date'}</td>
        <td className="px-3 py-3 text-muted-foreground">{row.bankAccountName}</td>
        <td className="px-3 py-3">
          <div className="flex min-w-[14rem] items-center gap-2">
            <select
              id={`category-${row.id}`}
              aria-label={`Category for ${row.description}`}
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
              value={row.isSplit ? '' : (row.categoryAccountId ?? '')}
              onChange={event => onCategorizeTransaction(row.id, event.target.value)}
            >
              <option value="" disabled>
                {row.isSplit ? 'Split transaction' : 'Choose category'}
              </option>
              {categorizationAccounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              title="AI categorize transaction"
              aria-label="AI categorize transaction"
              disabled={!row.needsReview || isAiRequestPending || row.aiProcessing}
              onClick={() => onAiCategorizeOne(row.id)}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="outline" size="sm" title="Split transaction" aria-label="Split transaction" onClick={openSplitEditor}>
              <GitBranch className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </td>
        <td className="px-3 py-3 text-center">
          {row.statusIndicator.canConfirm ? (
            <Button
              type="button"
              variant="ghost"
              title={row.statusIndicator.title}
              aria-label={`Confirm category for ${row.description}. ${row.statusIndicator.ariaLabel}`}
              className="h-2.5 w-2.5 cursor-pointer rounded-full bg-transparent p-0 transition-[box-shadow] hover:bg-transparent hover:ring-2 hover:ring-ring/70 hover:ring-offset-2 hover:ring-offset-background"
              onClick={() => onConfirmTransaction(row.id)}
            >
              <span className={`block h-2.5 w-2.5 rounded-full ${row.statusIndicator.className}`} aria-hidden="true" />
              <span className="sr-only">{row.statusIndicator.ariaLabel}</span>
            </Button>
          ) : (
            <span
              title={row.statusIndicator.title}
              aria-label={row.statusIndicator.ariaLabel}
              role={row.statusIndicator.kind === 'processing' ? 'status' : 'img'}
              className={`inline-block h-2.5 w-2.5 rounded-full ${row.statusIndicator.className}`}
            />
          )}
        </td>
        <td className="px-3 py-3 text-right font-mono">
          {row.amount} {row.currency}
        </td>
      </tr>
      {isSplitEditorOpen ? (
        <tr className="border-t">
          <td colSpan={6} className="px-3 py-3">
            <SplitEditor
              splitLines={splitLines}
              setSplitLines={setSplitLines}
              categorizationAccounts={categorizationAccounts}
              onCancel={() => setIsSplitEditorOpen(false)}
              onSave={() => void saveSplit()}
            />
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
}

function getInitialSplitLines(row: TransactionTableRowData, categorizationAccounts: CategorizationAccountOption[]): SplitLine[] {
  if (row.splitLines.length > 1) {
    return row.splitLines.map(line => ({...line}))
  }

  return [{accountId: row.categoryAccountId ?? categorizationAccounts[0]?.id ?? '', amount: row.amount.replace(/^-/, '')}]
}
