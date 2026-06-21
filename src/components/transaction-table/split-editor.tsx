import {ArrowLeft, ListPlus, Minus, Trash2} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {addSplitLine, fillRemainingSplitAmount, removeSplitLine} from './split-lines'
import type {CategorizationAccountOption, SplitLine} from './types'

type SplitEditorProps = {
  splitLines: SplitLine[]
  setSplitLines: (lines: SplitLine[]) => void
  categorizationAccounts: CategorizationAccountOption[]
  transactionAmount: number
  currency: string
  onBack: () => void
  onCancel: () => void
  onSave: () => void
}

export function SplitEditor({splitLines, setSplitLines, categorizationAccounts, transactionAmount, currency, onBack, onCancel, onSave}: SplitEditorProps) {
  const canRemove = splitLines.length > 2

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 border-b pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Back to categories" title="Back to categories" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <p className="truncate text-sm font-medium">Split transaction</p>
        </div>
        <Button type="button" variant="outline" size="sm" aria-label="Add split line" title="Add split line" onClick={() => setSplitLines(addSplitLine(splitLines, categorizationAccounts))}>
          <ListPlus className="h-4 w-4" aria-hidden="true" />
          Add line
        </Button>
      </div>

      <div className="space-y-2">
        {splitLines.map((line, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto_auto] items-center gap-2">
            <select
              aria-label={`Split line ${index + 1} category`}
              className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm"
              value={line.accountId}
              onChange={event => setSplitLines(splitLines.map((existing, lineIndex) => (lineIndex === index ? {...existing, accountId: event.target.value} : existing)))}
            >
              {categorizationAccounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <Input
              aria-label={`Split line ${index + 1} amount`}
              className="h-9"
              value={line.amount}
              onChange={event => setSplitLines(splitLines.map((existing, lineIndex) => (lineIndex === index ? {...existing, amount: event.target.value} : existing)))}
              placeholder="0.00"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label={`Fill remaining amount for split line ${index + 1}`}
              title="Fill remaining amount"
              onClick={() => setSplitLines(fillRemainingSplitAmount(splitLines, index, transactionAmount, currency))}
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label={`Remove split line ${index + 1}`}
              title="Remove split line"
              disabled={!canRemove}
              onClick={() => {
                if (!canRemove) return
                setSplitLines(removeSplitLine(splitLines, index))
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 border-t pt-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onSave}>
          Save split
        </Button>
      </div>
    </div>
  )
}
