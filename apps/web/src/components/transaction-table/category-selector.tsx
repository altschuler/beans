import {useMemo, useState, type ReactNode} from 'react'
import {ChevronDown, GitBranch, Sparkles} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {getInitialSplitLines} from './split-lines'
import {SplitEditor} from './split-editor'
import type {CategorizationAccountOption, CategorySelection, SplitLine, TransactionTableRow, TransferAccountOption} from './types'

export type CategorySelectorMode = 'select' | 'split'

type CategorySelectorProps = {
  row: TransactionTableRow
  categorizationAccounts: CategorizationAccountOption[]
  transferAccounts: TransferAccountOption[]
  isAiRequestPending: boolean
  onSelect: (bankTransactionId: string, selection: CategorySelection) => void
  onAiCategorizeOne: (bankTransactionId: string) => void
  onSaveSplit: (row: TransactionTableRow, splitLines: SplitLine[]) => boolean
}

export function CategorySelector({row, categorizationAccounts, transferAccounts, isAiRequestPending, onSelect, onAiCategorizeOne, onSaveSplit}: CategorySelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<CategorySelectorMode>('select')
  const [search, setSearch] = useState('')
  const [splitLines, setSplitLines] = useState<SplitLine[]>([])
  const isAiDisabled = !row.canCategorize || !row.needsReview || isAiRequestPending
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

  function resetPopoverState() {
    setMode('select')
    setSearch('')
    setSplitLines([])
  }

  function closePopover() {
    setIsOpen(false)
    resetPopoverState()
  }

  function handleOpenChange(nextIsOpen: boolean) {
    setIsOpen(nextIsOpen)
    if (!nextIsOpen) resetPopoverState()
  }

  function choose(selection: CategorySelection) {
    onSelect(row.bankTransactionId, selection)
    closePopover()
  }

  function startAi() {
    onAiCategorizeOne(row.bankTransactionId)
    closePopover()
  }

  function openSplit() {
    setSearch('')
    setSplitLines(getInitialSplitLines(row, categorizationAccounts))
    setMode('split')
  }

  function saveSplit() {
    const didSave = onSaveSplit(row, splitLines)
    if (!didSave) return
    closePopover()
  }

  return (
    <div className="min-w-0 flex-1">
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full min-w-0 justify-between px-3 text-left font-normal"
            disabled={!row.canCategorize}
            aria-label={`Category for ${row.description}`}
            aria-expanded={isOpen}
          >
            <span className="min-w-0 flex-1 truncate">{row.categoryLabel}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[28rem] max-w-[calc(100vw-2rem)] p-2">
          {mode === 'split' ? (
            <SplitEditor
              splitLines={splitLines}
              setSplitLines={setSplitLines}
              categorizationAccounts={categorizationAccounts}
              transactionAmount={row.amount}
              currency={row.currency}
              onBack={() => setMode('select')}
              onCancel={closePopover}
              onSave={() => void saveSplit()}
            />
          ) : (
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
                  onClick={startAi}
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
                  onClick={openSplit}
                >
                  <GitBranch className="h-4 w-4" aria-hidden="true" />
                  Split
                </Button>
              </div>
              <div className="max-h-72 overflow-auto">
                {transferOptions.length > 0 ? (
                  <SelectorSection title="Transfers">
                    {transferOptions.map(option => (
                      <SelectorOption key={option.account.id} label={option.label} onClick={() => choose({kind: 'transfer', accountId: option.account.id})} />
                    ))}
                  </SelectorSection>
                ) : null}
                {categoryOptions.length > 0 ? (
                  <SelectorSection title="Categories">
                    {categoryOptions.map(account => (
                      <SelectorOption key={account.id} label={account.name} onClick={() => choose({kind: 'category', accountId: account.id})} />
                    ))}
                  </SelectorSection>
                ) : null}
                {transferOptions.length === 0 && categoryOptions.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">No matches.</p> : null}
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
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
    <Button type="button" variant="ghost" className="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-left font-normal" onClick={onClick}>
      {label}
    </Button>
  )
}
