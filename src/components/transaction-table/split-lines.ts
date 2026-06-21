import {formatScaledUnits, parseMoneyToScaledUnits} from '@/ledger/categorization'
import type {CategorizationAccountOption, SplitLine, TransactionTableRow} from './types'

const MINIMUM_SPLIT_LINES = 2

export function getInitialSplitLines(row: TransactionTableRow, categorizationAccounts: CategorizationAccountOption[]): SplitLine[] {
  const fallbackAccountId = row.categoryAccountId ?? categorizationAccounts[0]?.id ?? ''

  if (row.splitLines.length >= MINIMUM_SPLIT_LINES) {
    return row.splitLines.map(line => ({...line}))
  }

  return normalizeSplitLines(
    [
      {accountId: fallbackAccountId, amount: row.amount.replace(/^-/, '')},
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

export function fillRemainingSplitAmount(splitLines: SplitLine[], indexToFill: number, transactionAmount: string): SplitLine[] {
  const transactionTotal = absoluteBigInt(parseMoneyToScaledUnits(transactionAmount))
  const otherLinesTotal = splitLines.reduce((total, line, lineIndex) => {
    if (lineIndex === indexToFill) return total
    return total + parseOptionalMoneyToScaledUnits(line.amount)
  }, 0n)
  const remainingAmount = transactionTotal - otherLinesTotal

  return splitLines.map((line, lineIndex) => (lineIndex === indexToFill ? {...line, amount: formatScaledUnits(remainingAmount)} : line))
}

function parseOptionalMoneyToScaledUnits(value: string) {
  if (value.trim() === '') return 0n

  try {
    return parseMoneyToScaledUnits(value)
  } catch {
    return 0n
  }
}

function absoluteBigInt(value: bigint) {
  return value < 0n ? -value : value
}
