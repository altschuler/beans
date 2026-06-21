import {useState} from 'react'
import {ChevronDown} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {CategorySelectorContent, type CategorySelectorMode} from './category-selector-content'
import {getInitialSplitLines} from './split-lines'
import type {CategorizationAccountOption, CategorySelection, SplitLine, TransactionTableRow, TransferAccountOption} from './types'

type CategorySelectorProps = {
  row: TransactionTableRow
  categorizationAccounts: CategorizationAccountOption[]
  transferAccounts: TransferAccountOption[]
  isAiRequestPending: boolean
  onSelect: (bankTransactionId: string, selection: CategorySelection) => void
  onAiCategorizeOne: (bankTransactionId: string) => void
  onSaveSplit: (row: TransactionTableRow, splitLines: SplitLine[]) => Promise<boolean>
}

export function CategorySelector({row, categorizationAccounts, transferAccounts, isAiRequestPending, onSelect, onAiCategorizeOne, onSaveSplit}: CategorySelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<CategorySelectorMode>('select')
  const [search, setSearch] = useState('')
  const [splitLines, setSplitLines] = useState<SplitLine[]>([])
  const isAiDisabled = !row.canCategorize || !row.needsReview || isAiRequestPending || row.aiProcessing

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

  async function saveSplit() {
    const didSave = await onSaveSplit(row, splitLines)
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
            className="h-9 w-full justify-between px-3 text-left font-normal"
            disabled={!row.canCategorize}
            aria-label={`Category for ${row.description}`}
            aria-expanded={isOpen}
          >
            <span className="truncate">{row.categoryLabel}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[28rem] max-w-[calc(100vw-2rem)] p-2">
          <CategorySelectorContent
            mode={mode}
            row={row}
            categorizationAccounts={categorizationAccounts}
            transferAccounts={transferAccounts}
            search={search}
            setSearch={setSearch}
            splitLines={splitLines}
            setSplitLines={setSplitLines}
            isAiDisabled={isAiDisabled}
            onChoose={choose}
            onStartAi={startAi}
            onOpenSplit={openSplit}
            onBackToSelect={() => setMode('select')}
            onCancelSplit={closePopover}
            onSaveSplit={() => void saveSplit()}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
