import {defineMutator, defineMutators} from '@rocicorp/zero'
import {z} from 'zod'

export const categorySelectionInput = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('category'), accountId: z.string().min(1)}),
  z.object({kind: z.literal('transfer'), accountId: z.string().min(1)}),
])

export const categorizeTransactionInput = z.object({
  bankTransactionId: z.string().min(1),
  selection: categorySelectionInput,
})

export const splitTransactionInput = z.object({
  bankTransactionId: z.string().min(1),
  lines: z
    .array(
      z.object({
        accountId: z.string().min(1),
        amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
      }),
    )
    .min(2),
})

export const confirmTransactionInput = z.object({
  bankTransactionId: z.string().min(1),
})

export const clearCategorizationsInput = z.object({})

export const mutators = defineMutators({
  ledger: {
    categorizeTransaction: defineMutator(categorizeTransactionInput, async () => {}),
    splitTransaction: defineMutator(splitTransactionInput, async () => {}),
    confirmTransaction: defineMutator(confirmTransactionInput, async () => {}),
    clearCategorizations: defineMutator(clearCategorizationsInput, async () => {}),
  },
})
