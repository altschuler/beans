import {defineMutator, defineMutators} from '@rocicorp/zero'
import {z} from 'zod'

export const categorizeTransactionInput = z.object({
  ledgerTransactionId: z.string().min(1),
  accountId: z.string().min(1),
})

export const splitTransactionInput = z.object({
  ledgerTransactionId: z.string().min(1),
  lines: z
    .array(
      z.object({
        accountId: z.string().min(1),
        amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
      }),
    )
    .min(2),
})

export const aiCategorizeTransactionInput = z.object({
  ledgerTransactionId: z.string().min(1),
})

export const aiCategorizeNeedsReviewBatchInput = z.object({
  limit: z.number().int().positive().optional(),
})

export const mutators = defineMutators({
  ledger: {
    categorizeTransaction: defineMutator(categorizeTransactionInput, async () => {}),
    splitTransaction: defineMutator(splitTransactionInput, async () => {}),
    aiCategorizeTransaction: defineMutator(aiCategorizeTransactionInput, async () => {}),
    aiCategorizeNeedsReviewBatch: defineMutator(aiCategorizeNeedsReviewBatchInput, async () => {}),
  },
})
