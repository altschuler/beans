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

export const managedCategoryTypeInput = z.enum(['expense', 'income', 'savings'])

const trimmedNonEmptyString = z.string().trim().min(1)

export const createCategoryAccountInput = z.object({
  id: trimmedNonEmptyString,
  teamId: trimmedNonEmptyString,
  groupId: trimmedNonEmptyString,
  name: trimmedNonEmptyString,
  description: z.string(),
  type: managedCategoryTypeInput,
})

export const updateCategoryAccountInput = z.object({
  accountId: trimmedNonEmptyString,
  groupId: trimmedNonEmptyString,
  name: trimmedNonEmptyString,
  description: z.string(),
  type: managedCategoryTypeInput,
})

export const deleteCategoryAccountInput = z.object({
  accountId: trimmedNonEmptyString,
})

export const createCategoryGroupInput = z.object({
  id: trimmedNonEmptyString,
  teamId: trimmedNonEmptyString,
  name: trimmedNonEmptyString,
})

export const updateCategoryGroupInput = z.object({
  groupId: trimmedNonEmptyString,
  name: trimmedNonEmptyString,
})

export const deleteCategoryGroupInput = z.object({
  groupId: trimmedNonEmptyString,
})

export const mutators = defineMutators({
  ledger: {
    categorizeTransaction: defineMutator(categorizeTransactionInput, async () => {}),
    splitTransaction: defineMutator(splitTransactionInput, async () => {}),
    confirmTransaction: defineMutator(confirmTransactionInput, async () => {}),
    clearCategorizations: defineMutator(clearCategorizationsInput, async () => {}),
    createCategoryAccount: defineMutator(createCategoryAccountInput, async () => {}),
    updateCategoryAccount: defineMutator(updateCategoryAccountInput, async () => {}),
    deleteCategoryAccount: defineMutator(deleteCategoryAccountInput, async () => {}),
    createCategoryGroup: defineMutator(createCategoryGroupInput, async () => {}),
    updateCategoryGroup: defineMutator(updateCategoryGroupInput, async () => {}),
    deleteCategoryGroup: defineMutator(deleteCategoryGroupInput, async () => {}),
  },
})
