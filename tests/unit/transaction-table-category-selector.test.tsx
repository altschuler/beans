// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest'
import {render, screen, within} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {CategorySelector} from '@/components/transaction-table/category-selector'
import {buildTransactionTableRow, testCategorizationAccounts, testTransferAccounts} from '../helpers/transaction-table'

describe('CategorySelector', () => {
  it('opens category and transfer choices only from the popover trigger', async () => {
    const user = userEvent.setup()

    render(
      <CategorySelector
        row={buildTransactionTableRow()}
        categorizationAccounts={testCategorizationAccounts}
        transferAccounts={testTransferAccounts}
        isAiRequestPending={false}
        onSelect={vi.fn()}
        onAiCategorizeOne={vi.fn()}
        onSaveSplit={vi.fn(async () => true)}
      />,
    )

    expect(screen.queryByPlaceholderText('Search categories or transfers…')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', {name: 'Category for Netto'}))

    expect(screen.getByPlaceholderText('Search categories or transfers…')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Transfer to: Savings'})).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Transfer to: Checking'})).not.toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Groceries'})).toBeInTheDocument()
  })

  it('filters transfer options and chooses the clicked transfer', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <CategorySelector
        row={buildTransactionTableRow({amount: 1_000_000})}
        categorizationAccounts={testCategorizationAccounts}
        transferAccounts={testTransferAccounts}
        isAiRequestPending={false}
        onSelect={onSelect}
        onAiCategorizeOne={vi.fn()}
        onSaveSplit={vi.fn(async () => true)}
      />,
    )

    await user.click(screen.getByRole('button', {name: 'Category for Netto'}))
    await user.type(screen.getByPlaceholderText('Search categories or transfers…'), 'savings')

    expect(screen.getByRole('button', {name: 'Transfer from: Savings'})).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: 'Groceries'})).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', {name: 'Transfer from: Savings'}))

    expect(onSelect).toHaveBeenCalledWith('bank-transaction-1', {kind: 'transfer', accountId: 'savings-ledger'})
  })

  it('starts row AI categorization with the row bank transaction id', async () => {
    const user = userEvent.setup()
    const onAiCategorizeOne = vi.fn()

    render(
      <CategorySelector
        row={buildTransactionTableRow()}
        categorizationAccounts={testCategorizationAccounts}
        transferAccounts={[]}
        isAiRequestPending={false}
        onSelect={vi.fn()}
        onAiCategorizeOne={onAiCategorizeOne}
        onSaveSplit={vi.fn(async () => true)}
      />,
    )

    await user.click(screen.getByRole('button', {name: 'Category for Netto'}))
    await user.click(screen.getByRole('button', {name: 'AI categorize transaction'}))

    expect(onAiCategorizeOne).toHaveBeenCalledWith('bank-transaction-1')
  })

  it('opens split editing from the selector without exposing split controls while closed', async () => {
    const user = userEvent.setup()

    render(
      <CategorySelector
        row={buildTransactionTableRow()}
        categorizationAccounts={testCategorizationAccounts}
        transferAccounts={[]}
        isAiRequestPending={false}
        onSelect={vi.fn()}
        onAiCategorizeOne={vi.fn()}
        onSaveSplit={vi.fn(async () => true)}
      />,
    )

    expect(screen.queryByText('Split transaction')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', {name: 'Category for Netto'}))
    await user.click(screen.getByRole('button', {name: 'Split transaction'}))

    const dialog = screen.getByText('Split transaction').closest('div')?.parentElement
    expect(dialog).not.toBeNull()
    expect(within(dialog!).getByRole('button', {name: 'Back to categories'})).toBeInTheDocument()
    expect(screen.getByLabelText('Split line 1 amount')).toHaveValue('100.00')
  })
})
