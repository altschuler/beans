import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'
import {TransactionTable} from '@/components/transaction-table'
import type {TransactionTableRow} from '@/components/transaction-table'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({count}: {count: number}) => ({
    getTotalSize: () => count * 56,
    getVirtualItems: () => Array.from({length: Math.min(count, 8)}, (_, index) => ({index, key: index, start: index * 56, size: 56})),
    measureElement: vi.fn(),
  }),
}))

vi.mock('@/components/ui/button', async () => {
  const ReactModule = await import('react')
  return {
    Button: ({children, ...props}: React.ButtonHTMLAttributes<HTMLButtonElement>) => ReactModule.createElement('button', props, children),
  }
})

const row: TransactionTableRow = {
  id: 'bank-transaction-1',
  ledgerTransactionId: 'ledger-transaction-1',
  bankTransactionId: 'bank-transaction-1',
  bankAccountId: 'bank-account-1',
  description: 'Netto',
  date: '2026-06-18',
  bankAccountName: 'Checking',
  amount: '-100.00',
  currency: 'DKK',
  status: 'needs_review',
  needsReview: true,
  aiConfidence: 1,
  aiProcessing: false,
  canCategorize: true,
  statusIndicator: {
    kind: 'needs_review',
    title: 'Review recommended',
    ariaLabel: 'Review recommended',
    className: 'bg-yellow-600',
    canConfirm: true,
  },
  aiIndicator: {
    kind: 'needs_review',
    title: 'Review recommended',
    ariaLabel: 'Review recommended',
    className: 'bg-yellow-600',
    canConfirm: true,
  },
  categoryAccountId: 'groceries',
  categoryLabel: 'Groceries',
  isSplit: false,
  splitLines: [],
}

describe('TransactionTable', () => {
  it('owns row scrolling while keeping the table header sticky', () => {
    const markup = renderToStaticMarkup(
      React.createElement(TransactionTable, {
        rows: [row],
        categorizationAccounts: [{id: 'groceries', name: 'Groceries'}],
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
    expect(markup).not.toContain('bg-muted/60')
    expect(markup).toContain('<tbody class="relative grid"')
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
        rows: [{...row, aiProcessing: true, statusIndicator: processingStatus, aiIndicator: processingStatus}],
        categorizationAccounts: [{id: 'groceries', name: 'Groceries'}],
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
    const rows = Array.from({length: 40}, (_, index) => ({
      ...row,
      id: `bank-transaction-${index}`,
      bankTransactionId: `bank-transaction-${index}`,
      description: `Transaction ${index}`,
    }))

    const markup = renderToStaticMarkup(
      React.createElement(TransactionTable, {
        rows,
        categorizationAccounts: [{id: 'groceries', name: 'Groceries'}],
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

  it('renders the category selector button instead of a native category select', () => {
    const markup = renderToStaticMarkup(
      React.createElement(TransactionTable, {
        rows: [{...row, ledgerTransactionId: null, categoryAccountId: null, categoryLabel: 'Choose category'}],
        categorizationAccounts: [{id: 'groceries', name: 'Groceries'}, {id: 'restaurants', name: 'Restaurants'}],
        transferAccounts: [{id: 'savings-ledger', bankAccountId: 'bank-account-2', name: 'Savings'}],
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
    expect(markup).toContain('aria-label="AI categorize transaction"')
    expect(markup).not.toContain('aria-label="AI categorize transaction" disabled=""')
  })

  it('keeps transfer choices available through row props for selector filtering', () => {
    const positiveRow: TransactionTableRow = {...row, id: 'bank-transaction-2', bankTransactionId: 'bank-transaction-2', ledgerTransactionId: null, amount: '100.00', categoryAccountId: null, categoryLabel: 'Choose category'}
    const markup = renderToStaticMarkup(
      React.createElement(TransactionTable, {
        rows: [positiveRow],
        categorizationAccounts: [],
        transferAccounts: [{id: 'checking-ledger', bankAccountId: 'bank-account-1', name: 'Checking'}],
        isAiRequestPending: false,
        onCategorizeBankTransaction: vi.fn(),
        onConfirmTransaction: vi.fn(),
        onAiCategorizeOne: vi.fn(),
        onSaveSplit: vi.fn(async () => true),
      }),
    )

    expect(markup).toContain('Category for Netto')
    expect(markup).not.toContain('<select')
  })
})
