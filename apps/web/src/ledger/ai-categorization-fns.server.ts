import '@tanstack/react-start/server-only'

import {aiCategorizeBankTransactions} from './ai-categorization.server'

export type AiCategorizeTransactionInput = {
  bankTransactionId: string
}

export type AiCategorizeNeedsReviewBatchInput = {
  limit?: number
}

export async function runAiCategorizeTransactionForUser(userId: string, data: AiCategorizeTransactionInput) {
  return aiCategorizeBankTransactions({userId, bankTransactionIds: [data.bankTransactionId]})
}

export async function runAiCategorizeNeedsReviewBatchForUser(userId: string, data: AiCategorizeNeedsReviewBatchInput) {
  return aiCategorizeBankTransactions({userId, limit: data.limit})
}
