import '@tanstack/react-start/server-only'

import {startFlueCategorizeNeedsReviewWorkflow, startFlueCategorizeTransactionWorkflow} from './flue-categorization-workflow.server'

export type AiCategorizeTransactionInput = {
  bankTransactionId: string
}

export type AiCategorizeNeedsReviewBatchInput = {
  limit?: number
}

export async function runAiCategorizeTransactionForUser(userId: string, data: AiCategorizeTransactionInput) {
  return startFlueCategorizeTransactionWorkflow({userId, bankTransactionId: data.bankTransactionId})
}

export async function runAiCategorizeNeedsReviewBatchForUser(userId: string, data: AiCategorizeNeedsReviewBatchInput = {}) {
  void data
  return startFlueCategorizeNeedsReviewWorkflow({userId})
}
