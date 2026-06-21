import {describe, expect, it} from 'vitest'
import type {SplitLine} from '@/components/transaction-table'
import {addSplitLine, fillRemainingSplitAmount, getInitialSplitLines, removeSplitLine} from '@/components/transaction-table/split-lines'
import {buildTransactionTableRow, testCategorizationAccounts} from '../helpers/transaction-table'

describe('transaction table split line helpers', () => {
  it('starts a non-split transaction with two lines', () => {
    expect(getInitialSplitLines(buildTransactionTableRow(), testCategorizationAccounts)).toEqual([
      {accountId: 'groceries', amount: '100.00'},
      {accountId: 'groceries', amount: ''},
    ])
  })

  it('copies existing split lines', () => {
    const existingLines: SplitLine[] = [
      {accountId: 'groceries', amount: '60.00'},
      {accountId: 'household', amount: '40.00'},
    ]

    const initialLines = getInitialSplitLines(buildTransactionTableRow({isSplit: true, splitLines: existingLines}), testCategorizationAccounts)

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
    expect(addSplitLine([{accountId: 'groceries', amount: '100.00'}], testCategorizationAccounts)).toEqual([
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

    expect(fillRemainingSplitAmount(lines, 1, -1_000_000, 'DKK')).toEqual([
      {accountId: 'groceries', amount: '25.00'},
      {accountId: 'household', amount: '70.00'},
      {accountId: 'groceries', amount: '5.00'},
    ])
  })

  it('treats empty or invalid other amounts as zero when filling remaining', () => {
    const lines: SplitLine[] = [
      {accountId: 'groceries', amount: ''},
      {accountId: 'household', amount: '10.00'},
      {accountId: 'groceries', amount: 'abc'},
    ]

    expect(fillRemainingSplitAmount(lines, 1, -1_000_000, 'DKK')[1]).toEqual({accountId: 'household', amount: '100.00'})
  })
})
