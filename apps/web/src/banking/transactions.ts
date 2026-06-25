import {createHash} from 'node:crypto'
import {parseDecimalMoneyToAmount} from '@penge/domain/money'
import type {GoCardlessTransaction} from './gocardless/types'

export type BankTransactionStatus = 'booked' | 'pending'

export type NormalizedBankTransaction = {
  providerTransactionId: string
  status: BankTransactionStatus
  bookingDate?: string
  valueDate?: string
  amount: number
  currency: string
  description: string
  counterpartyName?: string
  raw: GoCardlessTransaction
}

export function normalizeGoCardlessTransaction(
  status: BankTransactionStatus,
  transaction: GoCardlessTransaction,
): NormalizedBankTransaction {
  return {
    providerTransactionId: transaction.transactionId ?? fallbackTransactionId(transaction),
    status,
    bookingDate: transaction.bookingDate,
    valueDate: transaction.valueDate,
    amount: parseDecimalMoneyToAmount(transaction.transactionAmount.amount),
    currency: transaction.transactionAmount.currency,
    description: transactionDescription(transaction),
    counterpartyName: transaction.creditorName ?? transaction.debtorName,
    raw: transaction,
  }
}

export function dateFromForNextSync(latestTransactionDate: string | null, overlapDays = 5) {
  if (!latestTransactionDate) {
    return undefined
  }

  const date = new Date(`${latestTransactionDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - overlapDays)
  return date.toISOString().slice(0, 10)
}

function transactionDescription(transaction: GoCardlessTransaction) {
  return (
    transaction.remittanceInformationUnstructured ??
    transaction.remittanceInformationUnstructuredArray?.join(' ') ??
    transaction.additionalInformation ??
    transaction.creditorName ??
    transaction.debtorName ??
    'Bank transaction'
  )
}

function fallbackTransactionId(transaction: GoCardlessTransaction) {
  return createHash('sha256').update(JSON.stringify(transaction)).digest('hex')
}
