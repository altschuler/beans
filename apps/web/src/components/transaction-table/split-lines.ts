import {sum} from 'lodash-es'
import {absoluteMoneyAmount, DEFAULT_CURRENCY, formatMoneyDecimal, parseDecimalMoneyToAmount} from '@penge/domain/money'
import type {CategorizationAccountOption, SplitLine, TransactionTableRow} from './types'

const MINIMUM_SPLIT_LINES = 2

export function getInitialSplitLines(row: TransactionTableRow, categorizationAccounts: CategorizationAccountOption[]): SplitLine[] {
  const fallbackAccountId = row.categoryAccountId ?? categorizationAccounts[0]?.id ?? ''

  if (row.splitLines.length >= MINIMUM_SPLIT_LINES) {
    return row.splitLines.map(line => ({...line}))
  }

  return [
    {accountId: fallbackAccountId, amount: formatMoneyDecimal(absoluteMoneyAmount(row.amount), row.currency)},
    {accountId: categorizationAccounts[0]?.id ?? fallbackAccountId, amount: ''},
  ]
}

export function addSplitLine(splitLines: SplitLine[], categorizationAccounts: CategorizationAccountOption[]): SplitLine[] {
  return [...splitLines, {accountId: categorizationAccounts[0]?.id ?? splitLines[0]?.accountId ?? '', amount: ''}]
}

export function removeSplitLine(splitLines: SplitLine[], indexToRemove: number): SplitLine[] {
  if (splitLines.length <= MINIMUM_SPLIT_LINES) return splitLines
  return splitLines.filter((_, lineIndex) => lineIndex !== indexToRemove)
}

export function fillRemainingSplitAmount(splitLines: SplitLine[], indexToFill: number, transactionAmount: number, currency = DEFAULT_CURRENCY): SplitLine[] {
  const transactionTotal = absoluteMoneyAmount(transactionAmount)
  const otherLinesTotal = sum(splitLines.map((line, lineIndex) => (lineIndex === indexToFill ? 0 : parseOptionalMoneyToAmount(line.amount))))
  const remainingAmount = transactionTotal - otherLinesTotal

  return splitLines.map((line, lineIndex) => (lineIndex === indexToFill ? {...line, amount: formatMoneyDecimal(remainingAmount, currency)} : line))
}

function parseOptionalMoneyToAmount(value: string) {
  if (value.trim() === '') return 0

  try {
    return parseDecimalMoneyToAmount(value)
  } catch {
    return 0
  }
}
