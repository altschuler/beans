import {useMemo, type ReactNode} from 'react'
import {GitBranch, Sparkles} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {SplitEditor} from './split-editor'
import type {CategorizationAccountOption, CategorySelection, SplitLine, TransactionTableRow, TransferAccountOption} from './types'

export type CategorySelectorMode = 'select' | 'split'

type CategorySelectorContentProps = {
  mode: CategorySelectorMode
  row: TransactionTableRow
  categorizationAccounts: CategorizationAccountOption[]
  transferAccounts: TransferAccountOption[]
  search: string
  setSearch: (search: string) => void
  splitLines: SplitLine[]
  setSplitLines: (lines: SplitLine[]) => void
  isAiDisabled: boolean
  onChoose: (selection: CategorySelection) => void
  onStartAi: () => void
  onOpenSplit: () => void
  onBackToSelect: () => void
  onCancelSplit: () => void
  onSaveSplit: () => void
}

export function CategorySelectorContent({
  mode,
  row,
  categorizationAccounts,
  transferAccounts,
  search,
  setSearch,
  splitLines,
  setSplitLines,
  isAiDisabled,
  onChoose,
  onStartAi,
  onOpenSplit,
  onBackToSelect,
  onCancelSplit,
  onSaveSplit,
}: CategorySelectorContentProps) {
  const transferDirection = row.amount < 0 ? 'to' : 'from'
  const visibleTransferAccounts = useMemo(
    () => transferAccounts.filter(account => account.bankAccountId !== row.bankAccountId),
    [row.bankAccountId, transferAccounts],
  )
  const normalizedSearch = search.trim().toLowerCase()
  const transferOptions = visibleTransferAccounts
    .map(account => ({account, label: `Transfer ${transferDirection}: ${account.name}`}))
    .filter(option => option.label.toLowerCase().includes(normalizedSearch))
  const categoryOptions = categorizationAccounts.filter(account => account.name.toLowerCase().includes(normalizedSearch))

  if (mode === 'split') {
    return (
      <SplitEditor
        splitLines={splitLines}
        setSplitLines={setSplitLines}
        categorizationAccounts={categorizationAccounts}
        transactionAmount={row.amount}
        currency={row.currency}
        onBack={onBackToSelect}
        onCancel={onCancelSplit}
        onSave={onSaveSplit}
      />
    )
  }

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search categories or transfers…" className="h-9 min-w-0 flex-1" autoFocus />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          title="AI categorize transaction"
          aria-label="AI categorize transaction"
          disabled={isAiDisabled}
          onClick={onStartAi}
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0 px-2"
          title="Split transaction"
          aria-label="Split transaction"
          disabled={!row.canCategorize}
          onClick={onOpenSplit}
        >
          <GitBranch className="h-4 w-4" aria-hidden="true" />
          Split
        </Button>
      </div>
      <div className="max-h-72 overflow-auto">
        {transferOptions.length > 0 ? (
          <SelectorSection title="Transfers">
            {transferOptions.map(option => (
              <SelectorOption key={option.account.id} label={option.label} onClick={() => onChoose({kind: 'transfer', accountId: option.account.id})} />
            ))}
          </SelectorSection>
        ) : null}
        {categoryOptions.length > 0 ? (
          <SelectorSection title="Categories">
            {categoryOptions.map(account => (
              <SelectorOption key={account.id} label={account.name} onClick={() => onChoose({kind: 'category', accountId: account.id})} />
            ))}
          </SelectorSection>
        ) : null}
        {transferOptions.length === 0 && categoryOptions.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">No matches.</p> : null}
      </div>
    </>
  )
}

function SelectorSection({title, children}: {title: string; children: ReactNode}) {
  return (
    <div className="py-1">
      <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function SelectorOption({label, onClick}: {label: string; onClick: () => void}) {
  return (
    <button type="button" className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none" onClick={onClick}>
      {label}
    </button>
  )
}
