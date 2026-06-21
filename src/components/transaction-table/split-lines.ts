import {absoluteMoneyAmount, DEFAULT_CURRENCY, formatMoneyDecimal, parseDecimalMoneyToAmount} from '@/lib/money'
import type {CategorizationAccountOption, SplitLine, TransactionTableRow} from './types'

const MINIMUM_SPLIT_LINES = 2

export function getInitialSplitLines(row: TransactionTableRow, categorizationAccounts: CategorizationAccountOption[]): SplitLine[] {
  const fallbackAccountId = row.categoryAccountId ?? categorizationAccounts[0]?.id ?? ''

  if (row.splitLines.length >= MINIMUM_SPLIT_LINES) {
    return row.splitLines.map(line => ({...line}))
  }

  return normalizeSplitLines(
    [
      {accountId: fallbackAccountId, amount: formatMoneyDecimal(absoluteMoneyAmount(row.amount), row.currency)},
      {accountId: categorizationAccounts[0]?.id ?? fallbackAccountId, amount: ''},
    ],
    categorizationAccounts,
  )
}

function normalizeSplitLines(splitLines: SplitLine[], categorizationAccounts: CategorizationAccountOption[]): SplitLine[] {
  const fallbackAccountId = categorizationAccounts[0]?.id ?? splitLines[0]?.accountId ?? ''
  const normalized = splitLines.map(line => ({...line}))

  while (normalized.length < MINIMUM_SPLIT_LINES) {
    normalized.push({accountId: fallbackAccountId, amount: ''})
  }

  return normalized
}

export function addSplitLine(splitLines: SplitLine[], categorizationAccounts: CategorizationAccountOption[]): SplitLine[] {
  return [...splitLines, {accountId: categorizationAccounts[0]?.id ?? splitLines[0]?.accountId ?? '', amount: ''}]
}

export function removeSplitLine(splitLines: SplitLine[], indexToRemove: number): SplitLine[] {
  if (splitLines.length <= MINIMUM_SPLIT_LINES) return splitLines
  return splitLines.filter((_, lineIndex) => lineIndex !== indexToRemove)
}

export function canRemoveSplitLine(splitLines: SplitLine[]) {
  return splitLines.length > MINIMUM_SPLIT_LINES
}

export function fillRemainingSplitAmount(splitLines: SplitLine[], indexToFill: number, transactionAmount: number, currency = DEFAULT_CURRENCY): SplitLine[] {
  const transactionTotal = absoluteMoneyAmount(transactionAmount)
  const otherLinesTotal = splitLines.reduce((total, line, lineIndex) => {
    if (lineIndex === indexToFill) return total
    return total + parseOptionalMoneyToAmount(line.amount)
  }, 0)
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
