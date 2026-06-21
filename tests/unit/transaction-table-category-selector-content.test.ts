import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'
import {CategorySelectorContent} from '@/components/transaction-table/category-selector-content'
import type {CategorySelection, SplitLine, TransactionTableRow} from '@/components/transaction-table'

const renderedButtons = vi.hoisted(
  () =>
    [] as Array<{
      children: React.ReactNode
      disabled?: boolean
      onClick?: () => void
      title?: string
      ariaLabel?: string
    }>,
)

type MockButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string
  size?: string
}

vi.mock('@/components/ui/button', async () => {
  const ReactModule = await import('react')
  return {
    Button: ({children, disabled, onClick, title, 'aria-label': ariaLabel, type}: MockButtonProps) => {
      renderedButtons.push({children, disabled, onClick: onClick ? () => onClick({} as React.MouseEvent<HTMLButtonElement>) : undefined, title, ariaLabel})
      return ReactModule.createElement('button', {disabled, onClick, title, 'aria-label': ariaLabel, type}, children)
    },
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

describe('CategorySelectorContent', () => {
  it('renders search with AI and split actions in select mode', () => {
    renderedButtons.length = 0
    const onChoose = vi.fn<(selection: CategorySelection) => void>()

    const markup = renderToStaticMarkup(
      React.createElement(CategorySelectorContent, {
        mode: 'select',
        row,
        categorizationAccounts: [
          {id: 'groceries', name: 'Groceries'},
          {id: 'restaurants', name: 'Restaurants'},
        ],
        transferAccounts: [{id: 'savings-ledger', bankAccountId: 'bank-account-2', name: 'Savings'}],
        search: '',
        setSearch: vi.fn(),
        splitLines: [],
        setSplitLines: vi.fn(),
        isAiDisabled: false,
        onChoose,
        onStartAi: vi.fn(),
        onOpenSplit: vi.fn(),
        onBackToSelect: vi.fn(),
        onCancelSplit: vi.fn(),
        onSaveSplit: vi.fn(),
      }),
    )

    expect(markup).toContain('placeholder="Search categories or transfers…"')
    expect(findButtonByLabel('AI categorize transaction')?.disabled).toBe(false)
    expect(findButtonByLabel('Split transaction')?.disabled).toBeFalsy()
    expect(markup).toContain('Transfer to: Savings')
    expect(markup).toContain('Groceries')
    expect(markup).toContain('Restaurants')
  })

  it('calls the AI callback from the select-mode action', () => {
    renderedButtons.length = 0
    const onStartAi = vi.fn()

    renderToStaticMarkup(
      React.createElement(CategorySelectorContent, {
        mode: 'select',
        row,
        categorizationAccounts: [{id: 'groceries', name: 'Groceries'}],
        transferAccounts: [],
        search: '',
        setSearch: vi.fn(),
        splitLines: [],
        setSplitLines: vi.fn(),
        isAiDisabled: false,
        onChoose: vi.fn(),
        onStartAi,
        onOpenSplit: vi.fn(),
        onBackToSelect: vi.fn(),
        onCancelSplit: vi.fn(),
        onSaveSplit: vi.fn(),
      }),
    )

    findButtonByLabel('AI categorize transaction')?.onClick?.()

    expect(onStartAi).toHaveBeenCalledOnce()
  })

  it('renders split mode in the same content boundary', () => {
    renderedButtons.length = 0
    const splitLines: SplitLine[] = [
      {accountId: 'groceries', amount: '60.00'},
      {accountId: 'restaurants', amount: '40.00'},
    ]

    const markup = renderToStaticMarkup(
      React.createElement(CategorySelectorContent, {
        mode: 'split',
        row,
        categorizationAccounts: [
          {id: 'groceries', name: 'Groceries'},
          {id: 'restaurants', name: 'Restaurants'},
        ],
        transferAccounts: [],
        search: '',
        setSearch: vi.fn(),
        splitLines,
        setSplitLines: vi.fn(),
        isAiDisabled: false,
        onChoose: vi.fn(),
        onStartAi: vi.fn(),
        onOpenSplit: vi.fn(),
        onBackToSelect: vi.fn(),
        onCancelSplit: vi.fn(),
        onSaveSplit: vi.fn(),
      }),
    )

    expect(markup).toContain('Split transaction')
    expect(findButtonByLabel('Back to categories')).toBeDefined()
    expect(findButtonByLabel('Fill remaining amount for split line 1')).toBeDefined()
    expect(markup).not.toContain('Search categories or transfers')
  })
})

function findButtonByLabel(label: string) {
  return renderedButtons.find(button => button.ariaLabel === label)
}
