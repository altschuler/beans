import '@tanstack/react-start/server-only'

import {startFlueCategorizeNeedsReviewWorkflow, startFlueCategorizeTransactionWorkflow} from './flue-categorization-workflow.server'
import {startEveCategorizeNeedsReviewTask, startEveCategorizeTransactionTask} from './eve-categorization-session.server'

export type AiCategorizeTransactionInput = {
  bankTransactionId: string
}

export type AiCategorizeNeedsReviewBatchInput = {
  limit?: number
}

export async function runAiCategorizeTransactionForUser(userId: string, data: AiCategorizeTransactionInput) {
  if (isEveAiRuntime()) return startEveCategorizeTransactionTask({userId, bankTransactionId: data.bankTransactionId})
  return startFlueCategorizeTransactionWorkflow({userId, bankTransactionId: data.bankTransactionId})
}

export async function runAiCategorizeNeedsReviewBatchForUser(userId: string, data: AiCategorizeNeedsReviewBatchInput = {}) {
  void data
  if (isEveAiRuntime()) return startEveCategorizeNeedsReviewTask({userId})
  return startFlueCategorizeNeedsReviewWorkflow({userId})
}

function isEveAiRuntime() {
  return process.env.PENGE_AI_RUNTIME === 'eve'
}
