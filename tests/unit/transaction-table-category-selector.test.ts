import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'
import {CategorySelector} from '@/components/transaction-table/category-selector'
import type {TransactionTableRow} from '@/components/transaction-table'

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
  asChild?: boolean
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

vi.mock('@/components/ui/popover', async () => {
  const ReactModule = await import('react')
  const passthrough = ({children}: {children: React.ReactNode}) => ReactModule.createElement(ReactModule.Fragment, null, children)
  return {
    Popover: passthrough,
    PopoverContent: passthrough,
    PopoverTrigger: passthrough,
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

describe('CategorySelector', () => {
  it('starts row AI categorization with the row bank transaction id', () => {
    renderedButtons.length = 0
    const onAiCategorizeOne = vi.fn()

    renderToStaticMarkup(
      React.createElement(CategorySelector, {
        row,
        categorizationAccounts: [{id: 'groceries', name: 'Groceries'}],
        transferAccounts: [],
        isAiRequestPending: false,
        onSelect: vi.fn(),
        onAiCategorizeOne,
        onSaveSplit: vi.fn(async () => true),
      }),
    )

    findButtonByLabel('AI categorize transaction')?.onClick?.()

    expect(onAiCategorizeOne).toHaveBeenCalledWith('bank-transaction-1')
  })
})

function findButtonByLabel(label: string) {
  return renderedButtons.find(button => button.ariaLabel === label)
}
