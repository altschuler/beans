import {useMemo, useState, type ReactNode} from 'react'
import {ChevronDown} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {parseMoneyToScaledUnits} from '@/ledger/categorization'
import type {CategorizationAccountOption, CategorySelection, TransactionTableRow, TransferAccountOption} from './types'

type CategorySelectorProps = {
  row: TransactionTableRow
  categorizationAccounts: CategorizationAccountOption[]
  transferAccounts: TransferAccountOption[]
  onSelect: (bankTransactionId: string, selection: CategorySelection) => void
}

export function CategorySelector({row, categorizationAccounts, transferAccounts, onSelect}: CategorySelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const transferDirection = parseMoneyToScaledUnits(row.amount) < 0n ? 'to' : 'from'
  const visibleTransferAccounts = useMemo(
    () => transferAccounts.filter(account => account.bankAccountId !== row.bankAccountId),
    [row.bankAccountId, transferAccounts],
  )
  const normalizedSearch = search.trim().toLowerCase()
  const transferOptions = visibleTransferAccounts
    .map(account => ({account, label: `Transfer ${transferDirection}: ${account.name}`}))
    .filter(option => option.label.toLowerCase().includes(normalizedSearch))
  const categoryOptions = categorizationAccounts.filter(account => account.name.toLowerCase().includes(normalizedSearch))

  function choose(selection: CategorySelection) {
    onSelect(row.bankTransactionId, selection)
    setIsOpen(false)
    setSearch('')
  }

  return (
    <div className="min-w-0 flex-1">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full justify-between px-3 text-left font-normal"
            disabled={!row.canCategorize}
            aria-label={`Category for ${row.description}`}
            aria-expanded={isOpen}
          >
            <span className="truncate">{row.categoryLabel}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-2">
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search categories or transfers…"
            className="mb-2 h-9"
            autoFocus
          />
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
    <button type="button" className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none" onClick={onClick}>
      {label}
    </button>
  )
}
