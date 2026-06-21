import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'
import {SplitEditor} from '@/components/transaction-table/split-editor'
import type {SplitLine} from '@/components/transaction-table'

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

const accounts = [
  {id: 'groceries', name: 'Groceries'},
  {id: 'household', name: 'Household'},
]

describe('SplitEditor', () => {
  it('renders compact popover controls with accessible names', () => {
    renderedButtons.length = 0

    const markup = renderToStaticMarkup(
      React.createElement(SplitEditor, {
        splitLines: [
          {accountId: 'groceries', amount: '60.00'},
          {accountId: 'household', amount: '40.00'},
        ],
        setSplitLines: vi.fn(),
        categorizationAccounts: accounts,
        transactionAmount: '-100.00',
        onBack: vi.fn(),
        onCancel: vi.fn(),
        onSave: vi.fn(),
      }),
    )

    expect(markup).toContain('Split transaction')
    expect(findButtonByLabel('Back to categories')).toBeDefined()
    expect(findButtonByLabel('Add split line')).toBeDefined()
    expect(findButtonByLabel('Fill remaining amount for split line 1')).toBeDefined()
    expect(findButtonByLabel('Remove split line 1')?.disabled).toBe(true)
    expect(markup).toContain('Save split')
  })

  it('does not allow removing below two lines', () => {
    renderedButtons.length = 0
    const setSplitLines = vi.fn()

    renderToStaticMarkup(
      React.createElement(SplitEditor, {
        splitLines: [
          {accountId: 'groceries', amount: '60.00'},
          {accountId: 'household', amount: '40.00'},
        ],
        setSplitLines,
        categorizationAccounts: accounts,
        transactionAmount: '-100.00',
        onBack: vi.fn(),
        onCancel: vi.fn(),
        onSave: vi.fn(),
      }),
    )

    findButtonByLabel('Remove split line 1')?.onClick?.()

    expect(setSplitLines).not.toHaveBeenCalled()
  })

  it('fills the selected line with the remaining amount', () => {
    renderedButtons.length = 0
    const setSplitLines = vi.fn()

    renderToStaticMarkup(
      React.createElement(SplitEditor, {
        splitLines: [
          {accountId: 'groceries', amount: '25.00'},
          {accountId: 'household', amount: ''},
          {accountId: 'groceries', amount: '5.00'},
        ],
        setSplitLines,
        categorizationAccounts: accounts,
        transactionAmount: '-100.00',
        onBack: vi.fn(),
        onCancel: vi.fn(),
        onSave: vi.fn(),
      }),
    )

    findButtonByLabel('Fill remaining amount for split line 2')?.onClick?.()

    expect(setSplitLines).toHaveBeenCalledWith([
      {accountId: 'groceries', amount: '25.00'},
      {accountId: 'household', amount: '70.0000'},
      {accountId: 'groceries', amount: '5.00'},
    ] satisfies SplitLine[])
  })
})

function findButtonByLabel(label: string) {
  return renderedButtons.find(button => button.ariaLabel === label)
}
