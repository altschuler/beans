import '@tanstack/react-start/server-only'

import {aiCategorizeLedgerTransactions} from './ai-categorization.server'

export type AiCategorizeTransactionInput = {
  bankTransactionId: string
}

export type AiCategorizeNeedsReviewBatchInput = {
  limit?: number
}

export async function runAiCategorizeTransactionForUser(userId: string, data: AiCategorizeTransactionInput) {
  return aiCategorizeLedgerTransactions({userId, bankTransactionIds: [data.bankTransactionId]})
}

export async function runAiCategorizeNeedsReviewBatchForUser(userId: string, data: AiCategorizeNeedsReviewBatchInput) {
  return aiCategorizeLedgerTransactions({userId, limit: data.limit})
}
