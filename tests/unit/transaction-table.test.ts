import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'
import {TransactionTable} from '@/components/transaction-table'
import {buildTransactionTableRow, testCategorizationAccounts, testTransferAccounts} from '../helpers/transaction-table'

const virtualizerOptions = vi.hoisted(() => [] as Array<{estimateSize: () => number}>)

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: {count: number; estimateSize: () => number}) => {
    virtualizerOptions.push(options)
    const rowHeight = options.estimateSize()
    return {
      getTotalSize: () => options.count * rowHeight,
      getVirtualItems: () => Array.from({length: Math.min(options.count, 8)}, (_, index) => ({index, key: index, start: index * rowHeight, size: rowHeight})),
    }
  },
}))

describe('TransactionTable', () => {
  it('owns row scrolling while keeping the table header sticky', () => {
    const markup = renderToStaticMarkup(
      React.createElement(TransactionTable, {
        rows: [buildTransactionTableRow()],
        categorizationAccounts: testCategorizationAccounts,
        transferAccounts: [],
        isAiRequestPending: false,
        onCategorizeBankTransaction: vi.fn(),
        onConfirmTransaction: vi.fn(),
        onAiCategorizeOne: vi.fn(),
        onSaveSplit: vi.fn(async () => true),
      }),
    )

    expect(markup).toContain('min-h-0 flex-1 overflow-auto')
    expect(markup).toContain('sticky top-0 z-10 bg-muted')
    expect(markup).not.toContain('Split transaction')
    expect(markup).toContain('<tbody class="relative grid"')
  })

  it('keeps virtualized rows at the fixed estimated height with truncating cells', () => {
    virtualizerOptions.length = 0

    const markup = renderToStaticMarkup(
      React.createElement(TransactionTable, {
        rows: [
          buildTransactionTableRow({
            description: 'A very long transaction description that should stay on one row instead of wrapping',
            bankAccountName: 'A very long bank account name',
            categoryLabel: 'A very long category label',
          }),
        ],
        categorizationAccounts: testCategorizationAccounts,
        transferAccounts: [],
        isAiRequestPending: false,
        onCategorizeBankTransaction: vi.fn(),
        onConfirmTransaction: vi.fn(),
        onAiCategorizeOne: vi.fn(),
        onSaveSplit: vi.fn(async () => true),
      }),
    )

    expect(virtualizerOptions.at(-1)?.estimateSize()).toBe(56)
    expect(markup).toContain('height:56px')
    expect(markup).toContain('class="grid h-14')
    expect(markup).toContain('truncate px-3 py-2 font-medium')
    expect(markup).toContain('truncate px-3 py-2 text-muted-foreground')
  })

  it('renders a loading indicator instead of a status dot while AI is processing a row', () => {
    const processingStatus = {
      kind: 'processing' as const,
      title: 'AI is currently categorizing this transaction',
      ariaLabel: 'AI is currently categorizing this transaction',
      className: 'bg-muted-foreground',
      canConfirm: false,
    }
    const markup = renderToStaticMarkup(
      React.createElement(TransactionTable, {
        rows: [buildTransactionTableRow({aiProcessing: true, statusIndicator: processingStatus, aiIndicator: processingStatus})],
        categorizationAccounts: testCategorizationAccounts,
        transferAccounts: [],
        isAiRequestPending: false,
        onCategorizeBankTransaction: vi.fn(),
        onConfirmTransaction: vi.fn(),
        onAiCategorizeOne: vi.fn(),
        onSaveSplit: vi.fn(async () => true),
      }),
    )

    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-label="AI is currently categorizing this transaction"')
    expect(markup).toContain('animate-spin')
    expect(markup).not.toContain('inline-block h-2.5 w-2.5 rounded-full bg-muted-foreground')
  })

  it('renders only the virtual window for large transaction lists', () => {
    const rows = Array.from({length: 40}, (_, index) =>
      buildTransactionTableRow({
        id: `bank-transaction-${index}`,
        bankTransactionId: `bank-transaction-${index}`,
        description: `Transaction ${index}`,
      }),
    )

    const markup = renderToStaticMarkup(
      React.createElement(TransactionTable, {
        rows,
        categorizationAccounts: testCategorizationAccounts,
        transferAccounts: [],
        isAiRequestPending: false,
        onCategorizeBankTransaction: vi.fn(),
        onConfirmTransaction: vi.fn(),
        onAiCategorizeOne: vi.fn(),
        onSaveSplit: vi.fn(async () => true),
      }),
    )

    expect(markup).toContain('height:2240px')
    expect(markup).toContain('data-index="0"')
    expect(markup).toContain('data-index="7"')
    expect(markup).toContain('Transaction 0')
    expect(markup).toContain('Transaction 7')
    expect(markup).not.toContain('Transaction 8')
    expect(markup).not.toContain('Transaction 39')
  })

  it('renders category actions through the category selector instead of separate row buttons', () => {
    const markup = renderToStaticMarkup(
      React.createElement(TransactionTable, {
        rows: [buildTransactionTableRow({ledgerTransactionId: null, categoryAccountId: null, categoryLabel: 'Choose category'})],
        categorizationAccounts: testCategorizationAccounts,
        transferAccounts: testTransferAccounts,
        isAiRequestPending: false,
        onCategorizeBankTransaction: vi.fn(),
        onConfirmTransaction: vi.fn(),
        onAiCategorizeOne: vi.fn(),
        onSaveSplit: vi.fn(async () => true),
      }),
    )

    expect(markup).toContain('aria-label="Category for Netto"')
    expect(markup).toContain('data-slot="popover-trigger"')
    expect(markup).toContain('Choose category')
    expect(markup).not.toContain('<select')
    expect(markup).not.toContain('aria-label="AI categorize transaction"')
    expect(markup).not.toContain('aria-label="Split transaction"')
  })
})
