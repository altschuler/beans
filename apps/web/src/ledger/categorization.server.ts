import '@tanstack/react-start/server-only'

import type {DrizzleTransaction as ZeroDrizzleTransaction} from '@rocicorp/zero/server/adapters/drizzle'
import type {Database} from '@/db/client'
import {
  CategorizationRevisionConflictError,
  categorizeBankTransaction as domainCategorizeBankTransaction,
  clearLedgerCategorizations as domainClearLedgerCategorizations,
  confirmBankTransactionInterpretation as domainConfirmBankTransactionInterpretation,
  normalizeAiReasoning,
  splitBankTransaction as domainSplitBankTransaction,
} from '@penge/domain/categorization-service'

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type WebDrizzleTransaction = DatabaseTransaction | ZeroDrizzleTransaction<Database>

export {CategorizationRevisionConflictError, normalizeAiReasoning}

export function categorizeBankTransaction(
  tx: WebDrizzleTransaction,
  input: Parameters<typeof domainCategorizeBankTransaction>[1],
) {
  return domainCategorizeBankTransaction(tx as DatabaseTransaction, input)
}

export function splitBankTransaction(
  tx: WebDrizzleTransaction,
  input: Parameters<typeof domainSplitBankTransaction>[1],
) {
  return domainSplitBankTransaction(tx as DatabaseTransaction, input)
}

export function confirmBankTransactionInterpretation(
  tx: WebDrizzleTransaction,
  input: Parameters<typeof domainConfirmBankTransactionInterpretation>[1],
) {
  return domainConfirmBankTransactionInterpretation(tx as DatabaseTransaction, input)
}

export function clearLedgerCategorizations(
  tx: WebDrizzleTransaction,
  input: Parameters<typeof domainClearLedgerCategorizations>[1],
) {
  return domainClearLedgerCategorizations(tx as DatabaseTransaction, input)
}
