import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'
import {TransactionTable} from '@/components/transaction-table'
import type {TransactionTableRow} from '@/components/transaction-table'

vi.mock('@/components/ui/button', async () => {
  const ReactModule = await import('react')
  return {
    Button: ({children, ...props}: React.ButtonHTMLAttributes<HTMLButtonElement>) => ReactModule.createElement('button', props, children),
  }
})

const row: TransactionTableRow = {
  id: 'ledger-transaction-1',
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
        isAiRequestPending: false,
        onCategorizeTransaction: vi.fn(),
        onConfirmTransaction: vi.fn(),
        onAiCategorizeOne: vi.fn(),
        onSaveSplit: vi.fn(async () => true),
      }),
    )

    expect(markup).toContain('min-h-0 flex-1 overflow-auto')
    expect(markup).toContain('sticky top-0 z-10 bg-muted')
    expect(markup).not.toContain('bg-muted/60')
    expect(markup).toContain('<tbody>')
  })
})
