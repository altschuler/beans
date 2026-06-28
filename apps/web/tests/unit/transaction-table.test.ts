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
        onSaveSplit: vi.fn(() => true),
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
        onSaveSplit: vi.fn(() => true),
      }),
    )

    expect(markup).toContain('aria-label="Category for Netto"')
    expect(markup).toContain('data-slot="popover-trigger"')
    expect(markup).toContain('Choose category')
  })
})
