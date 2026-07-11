import {z} from 'zod'
import {
  applyCategorizationsInputSchema,
  manageCategoryInputSchema,
  type ApplyCategorizationsInput,
  type ManageCategoryInput,
} from '@penge/domain/eve-chat-approval'

export {applyCategorizationsInputSchema, manageCategoryInputSchema}
export type {ApplyCategorizationsInput, ManageCategoryInput}

export const nonEmptyStringSchema = z.string().trim().min(1)
const optionalStringArraySchema = z.array(nonEmptyStringSchema).optional()
const directionSchema = z.enum(['inflow', 'outflow'])

export const chatRuntimeScopeSchema = z.object({
  purpose: z.literal('chat-session'),
  userId: nonEmptyStringSchema,
  teamId: nonEmptyStringSchema,
  chatId: nonEmptyStringSchema,
}).strict()
export type ChatRuntimeScope = z.infer<typeof chatRuntimeScopeSchema>

export const searchBankTransactionsInputSchema = z.object({
  reviewStatus: z.enum(['uncategorized', 'needs_review', 'confirmed', 'ai_unable', 'any']).optional(),
  bankTransactionIds: optionalStringArraySchema,
  bankAccountIds: optionalStringArraySchema,
  textContains: z.string().optional(),
  counterpartyContains: z.string().optional(),
  currency: z.string().optional(),
  amountMin: z.number().optional(),
  amountMax: z.number().optional(),
  direction: directionSchema.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.number().optional(),
}).strict()

export const getBankTransactionDetailInputSchema = z.object({bankTransactionId: nonEmptyStringSchema}).strict()

export const searchLedgerTransactionsInputSchema = z.object({
  status: z.string().optional(),
  source: z.string().optional(),
  categorizedBy: z.string().optional(),
  bankTransactionId: z.string().optional(),
  categoryAccountIds: optionalStringArraySchema,
  textContains: z.string().optional(),
  currency: z.string().optional(),
  amountMin: z.number().optional(),
  amountMax: z.number().optional(),
  direction: directionSchema.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.number().optional(),
}).strict()

export const searchLedgerAccountsInputSchema = z.object({
  type: z.string().optional(),
  status: z.string().optional(),
  textContains: z.string().optional(),
  linkedBankAccount: z.boolean().optional(),
  eligibleCategoryOnly: z.boolean().optional(),
  limit: z.number().optional(),
}).strict()

export type SearchBankTransactionsInput = z.infer<typeof searchBankTransactionsInputSchema>
export type GetBankTransactionDetailInput = z.infer<typeof getBankTransactionDetailInputSchema>
export type SearchLedgerTransactionsInput = z.infer<typeof searchLedgerTransactionsInputSchema>
export type SearchLedgerAccountsInput = z.infer<typeof searchLedgerAccountsInputSchema>
