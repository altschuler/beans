import {describe, expect, it} from 'vitest'
import type {CategorizationAccountOption, SplitLine, TransactionTableRow} from '@/components/transaction-table'
import {addSplitLine, fillRemainingSplitAmount, getInitialSplitLines, removeSplitLine} from '@/components/transaction-table/split-lines'

const accounts: CategorizationAccountOption[] = [
  {id: 'groceries', name: 'Groceries'},
  {id: 'household', name: 'Household'},
]

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

describe('transaction table split line helpers', () => {
  it('starts a non-split transaction with two lines', () => {
    expect(getInitialSplitLines(row, accounts)).toEqual([
      {accountId: 'groceries', amount: '100.00'},
      {accountId: 'groceries', amount: ''},
    ])
  })

  it('copies existing split lines and preserves at least two lines', () => {
    const existingLines: SplitLine[] = [
      {accountId: 'groceries', amount: '60.00'},
      {accountId: 'household', amount: '40.00'},
    ]

    const initialLines = getInitialSplitLines({...row, isSplit: true, splitLines: existingLines}, accounts)

    expect(initialLines).toEqual(existingLines)
    expect(initialLines).not.toBe(existingLines)
  })

  it('does not remove a split line when only two lines remain', () => {
    const lines: SplitLine[] = [
      {accountId: 'groceries', amount: '60.00'},
      {accountId: 'household', amount: '40.00'},
    ]

    expect(removeSplitLine(lines, 0)).toEqual(lines)
  })

  it('removes a split line when more than two lines remain', () => {
    const lines: SplitLine[] = [
      {accountId: 'groceries', amount: '50.00'},
      {accountId: 'household', amount: '30.00'},
      {accountId: 'groceries', amount: '20.00'},
    ]

    expect(removeSplitLine(lines, 1)).toEqual([
      {accountId: 'groceries', amount: '50.00'},
      {accountId: 'groceries', amount: '20.00'},
    ])
  })

  it('adds a line with the first available category', () => {
    expect(addSplitLine([{accountId: 'groceries', amount: '100.00'}], accounts)).toEqual([
      {accountId: 'groceries', amount: '100.00'},
      {accountId: 'groceries', amount: ''},
    ])
  })

  it('overwrites the selected line with the remaining transaction amount', () => {
    const lines: SplitLine[] = [
      {accountId: 'groceries', amount: '25.00'},
      {accountId: 'household', amount: '10.00'},
      {accountId: 'groceries', amount: '5.00'},
    ]

    expect(fillRemainingSplitAmount(lines, 1, '-100.00')).toEqual([
      {accountId: 'groceries', amount: '25.00'},
      {accountId: 'household', amount: '70.0000'},
      {accountId: 'groceries', amount: '5.00'},
    ])
  })

  it('treats empty or invalid other amounts as zero when filling remaining', () => {
    const lines: SplitLine[] = [
      {accountId: 'groceries', amount: ''},
      {accountId: 'household', amount: '10.00'},
      {accountId: 'groceries', amount: 'abc'},
    ]

    expect(fillRemainingSplitAmount(lines, 1, '-100.00')[1]).toEqual({accountId: 'household', amount: '100.0000'})
  })
})
