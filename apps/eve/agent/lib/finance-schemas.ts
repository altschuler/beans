import {z} from 'zod'

export const nonEmptyStringSchema = z.string().trim().min(1)
const optionalStringArraySchema = z.array(nonEmptyStringSchema).optional()
const confidenceSchema = z.union([z.literal(0), z.literal(1), z.literal(2)])
const expectedCategorizationRevisionSchema = z.number().int().nonnegative()
const displaySafeReasoningSchema = nonEmptyStringSchema.max(500)

export const chatRuntimeScopeSchema = z.object({
  purpose: z.literal('chat-session'),
  userId: nonEmptyStringSchema,
  teamId: nonEmptyStringSchema,
  chatId: nonEmptyStringSchema,
}).strict()

export const categorizationRuntimeScopeSchema = z.object({
  purpose: z.literal('categorization-task'),
  userId: nonEmptyStringSchema,
  teamId: nonEmptyStringSchema,
  appRunId: nonEmptyStringSchema,
  targetBankTransactionIds: z.array(nonEmptyStringSchema).min(1).optional(),
}).strict()

export const runtimeScopeSchema = z.discriminatedUnion('purpose', [chatRuntimeScopeSchema, categorizationRuntimeScopeSchema])
export type RuntimeScope = z.infer<typeof runtimeScopeSchema>
export type ChatRuntimeScope = z.infer<typeof chatRuntimeScopeSchema>
export type CategorizationRuntimeScope = z.infer<typeof categorizationRuntimeScopeSchema>

const reviewStatusSchema = z.enum(['uncategorized', 'needs_review', 'confirmed', 'ai_unable', 'any'])
const directionSchema = z.enum(['inflow', 'outflow'])

export const searchBankTransactionsInputSchema = z.object({
  reviewStatus: reviewStatusSchema.optional(),
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

export const getBankTransactionDetailInputSchema = z.object({
  bankTransactionId: nonEmptyStringSchema,
}).strict()

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

const autonomousInterpretationSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('unable')}).strict(),
  z.object({kind: z.literal('category'), categoryAccountId: nonEmptyStringSchema}).strict(),
  z.object({
    kind: z.literal('split'),
    lines: z.array(z.object({categoryAccountId: nonEmptyStringSchema, amount: nonEmptyStringSchema}).strict()).min(1),
  }).strict(),
  z.object({kind: z.literal('transfer'), counterBankTransactionId: nonEmptyStringSchema}).strict(),
])

export const applyCategorizationSuggestionInputSchema = z.object({
  bankTransactionId: nonEmptyStringSchema,
  expectedCategorizationRevision: expectedCategorizationRevisionSchema,
  confidence: confidenceSchema,
  reasoning: displaySafeReasoningSchema,
  interpretation: autonomousInterpretationSchema,
}).strict().superRefine((input, ctx) => {
  if (input.interpretation.kind === 'unable' && input.confidence !== 0) {
    ctx.addIssue({code: 'custom', path: ['confidence'], message: 'Unable interpretations require confidence 0'})
  }
  if ((input.interpretation.kind === 'category' || input.interpretation.kind === 'transfer') && input.confidence === 0) {
    ctx.addIssue({code: 'custom', path: ['confidence'], message: 'Category and transfer interpretations require confidence 1 or 2'})
  }
})

const chatInterpretationSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('category'), categoryAccountId: nonEmptyStringSchema}).strict(),
  z.object({
    kind: z.literal('split'),
    lines: z.array(z.object({categoryAccountId: nonEmptyStringSchema, amount: nonEmptyStringSchema}).strict()).min(1),
  }).strict(),
  z.object({kind: z.literal('transfer'), transferLedgerAccountId: nonEmptyStringSchema}).strict(),
])

const chatCategorizationSchema = z.object({
  bankTransactionId: nonEmptyStringSchema,
  expectedCategorizationRevision: expectedCategorizationRevisionSchema,
  interpretation: chatInterpretationSchema,
}).strict()

export const applyCategorizationsInputSchema = z.object({
  categorizations: z.array(chatCategorizationSchema).min(1),
}).strict()

const managedCategoryTypeSchema = z.enum(['expense', 'income', 'savings'])
const categoryManagementOperationSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('createGroup'), name: nonEmptyStringSchema}).strict(),
  z.object({kind: z.literal('updateGroup'), groupId: nonEmptyStringSchema, name: nonEmptyStringSchema}).strict(),
  z.object({kind: z.literal('deleteGroup'), groupId: nonEmptyStringSchema}).strict(),
  z.object({
    kind: z.literal('createCategory'),
    groupId: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    description: z.string(),
    type: managedCategoryTypeSchema,
  }).strict(),
  z.object({
    kind: z.literal('updateCategory'),
    accountId: nonEmptyStringSchema,
    groupId: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    description: z.string(),
    type: managedCategoryTypeSchema,
  }).strict(),
  z.object({kind: z.literal('deleteCategory'), accountId: nonEmptyStringSchema}).strict(),
])

export const manageCategoryInputSchema = z.object({operation: categoryManagementOperationSchema}).strict()

export const categorizationTaskOutputSchema = z.object({
  summary: nonEmptyStringSchema.max(1_000),
  processedCount: z.number().int().nonnegative(),
  appliedCount: z.number().int().nonnegative(),
  unableCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
}).strict()

export type SearchBankTransactionsInput = z.infer<typeof searchBankTransactionsInputSchema>
export type GetBankTransactionDetailInput = z.infer<typeof getBankTransactionDetailInputSchema>
export type SearchLedgerTransactionsInput = z.infer<typeof searchLedgerTransactionsInputSchema>
export type SearchLedgerAccountsInput = z.infer<typeof searchLedgerAccountsInputSchema>
export type ApplyCategorizationSuggestionInput = z.infer<typeof applyCategorizationSuggestionInputSchema>
export type ApplyCategorizationsInput = z.infer<typeof applyCategorizationsInputSchema>
export type ManageCategoryInput = z.infer<typeof manageCategoryInputSchema>
