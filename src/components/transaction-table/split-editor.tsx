import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import type {CategorizationAccountOption, SplitLine} from './types'

type SplitEditorProps = {
  splitLines: SplitLine[]
  setSplitLines: (lines: SplitLine[]) => void
  categorizationAccounts: CategorizationAccountOption[]
  onCancel: () => void
  onSave: () => void
}

export function SplitEditor({splitLines, setSplitLines, categorizationAccounts, onCancel, onSave}: SplitEditorProps) {
  return (
    <div className="space-y-3 rounded-md bg-muted/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Split transaction</p>
        <Button type="button" variant="outline" onClick={() => setSplitLines([...splitLines, {accountId: categorizationAccounts[0]?.id ?? '', amount: ''}])}>
          Add line
        </Button>
      </div>
      {splitLines.map((line, index) => (
        <div key={index} className="grid gap-2 md:grid-cols-[1fr_10rem_auto]">
          <select
            aria-label={`Split line ${index + 1} category`}
            className="h-10 rounded-md border bg-background px-3 text-sm"
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
            value={line.amount}
            onChange={event => setSplitLines(splitLines.map((existing, lineIndex) => (lineIndex === index ? {...existing, amount: event.target.value} : existing)))}
            placeholder="0.00"
          />
          <Button type="button" variant="outline" onClick={() => setSplitLines(splitLines.filter((_, lineIndex) => lineIndex !== index))}>
            Remove
          </Button>
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={onSave}>
          Save split
        </Button>
      </div>
    </div>
  )
}
