import '@tanstack/react-start/server-only'

import {startEveCategorizeNeedsReviewTask, startEveCategorizeTransactionTask} from './eve-categorization-session.server'

export type AiCategorizeTransactionInput = {
  bankTransactionId: string
}

export type AiCategorizeNeedsReviewBatchInput = {
  limit?: number
}

export async function runAiCategorizeTransactionForUser(userId: string, data: AiCategorizeTransactionInput) {
  return startEveCategorizeTransactionTask({userId, bankTransactionId: data.bankTransactionId})
}

export async function runAiCategorizeNeedsReviewBatchForUser(userId: string, data: AiCategorizeNeedsReviewBatchInput = {}) {
  void data
  return startEveCategorizeNeedsReviewTask({userId})
}
