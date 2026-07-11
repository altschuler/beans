import {z} from 'zod'
import type {
  SearchBankTransactionsFilters,
  SearchLedgerAccountsFilters,
  SearchLedgerTransactionsFilters,
} from '@penge/domain/read-projections'
import {
  applyCategorizationsInputSchema,
  manageCategoryInputSchema,
  type ApplyCategorizationsInput,
  type ManageCategoryInput,
} from '@penge/domain/eve-chat-approval'

export {applyCategorizationsInputSchema, manageCategoryInputSchema}
export type {ApplyCategorizationsInput, ManageCategoryInput}

export const nonEmptyStringSchema = z.string().trim().min(1)
const optionalStringArraySchema = z.array(nonEmptyStringSchema).nullish()
const optionalTextSchema = z.string().nullish()
const optionalNumberSchema = z.number().nullish()
const optionalBooleanSchema = z.boolean().nullish()
const directionSchema = z.enum(['inflow', 'outflow']).nullish()

export const chatRuntimeScopeSchema = z.object({
  purpose: z.literal('chat-session'),
  userId: nonEmptyStringSchema,
  teamId: nonEmptyStringSchema,
  chatId: nonEmptyStringSchema,
}).strict()
export type ChatRuntimeScope = z.infer<typeof chatRuntimeScopeSchema>

export const searchBankTransactionsInputSchema = z.object({
  reviewStatus: z.enum(['uncategorized', 'needs_review', 'confirmed', 'ai_unable', 'any']).nullish(),
  bankTransactionIds: optionalStringArraySchema,
  bankAccountIds: optionalStringArraySchema,
  textContains: optionalTextSchema,
  counterpartyContains: optionalTextSchema,
  currency: optionalTextSchema,
  amountMin: optionalNumberSchema,
  amountMax: optionalNumberSchema,
  direction: directionSchema,
  dateFrom: optionalTextSchema,
  dateTo: optionalTextSchema,
  limit: optionalNumberSchema,
}).strict()

export const getBankTransactionDetailInputSchema = z.object({bankTransactionId: nonEmptyStringSchema}).strict()

export const searchLedgerTransactionsInputSchema = z.object({
  status: optionalTextSchema,
  source: optionalTextSchema,
  categorizedBy: optionalTextSchema,
  bankTransactionId: optionalTextSchema,
  categoryAccountIds: optionalStringArraySchema,
  textContains: optionalTextSchema,
  currency: optionalTextSchema,
  amountMin: optionalNumberSchema,
  amountMax: optionalNumberSchema,
  direction: directionSchema,
  dateFrom: optionalTextSchema,
  dateTo: optionalTextSchema,
  limit: optionalNumberSchema,
}).strict()

export const searchLedgerAccountsInputSchema = z.object({
  type: optionalTextSchema,
  status: optionalTextSchema,
  textContains: optionalTextSchema,
  linkedBankAccount: optionalBooleanSchema,
  eligibleCategoryOnly: optionalBooleanSchema,
  limit: optionalNumberSchema,
}).strict()

export type SearchBankTransactionsInput = z.infer<typeof searchBankTransactionsInputSchema>
export type GetBankTransactionDetailInput = z.infer<typeof getBankTransactionDetailInputSchema>
export type SearchLedgerTransactionsInput = z.infer<typeof searchLedgerTransactionsInputSchema>
export type SearchLedgerAccountsInput = z.infer<typeof searchLedgerAccountsInputSchema>

// Chat models on strict tool schemas often cannot omit unused filters and send
// sentinel values instead ([], "", 0, null, "any"). Normalize those to absent
// filters before querying — an empty id array would otherwise compile to
// `1 = 0` and make every search match nothing.
export function normalizeSearchBankTransactionsFilters(input: SearchBankTransactionsInput): SearchBankTransactionsFilters {
  return {
    reviewStatus: input.reviewStatus ?? undefined,
    bankTransactionIds: presentArray(input.bankTransactionIds),
    bankAccountIds: presentArray(input.bankAccountIds),
    textContains: presentText(input.textContains),
    counterpartyContains: presentText(input.counterpartyContains),
    currency: presentKeyword(input.currency),
    ...presentAmountBounds(input.amountMin, input.amountMax),
    direction: input.direction ?? undefined,
    dateFrom: presentText(input.dateFrom),
    dateTo: presentText(input.dateTo),
    limit: presentLimit(input.limit),
  }
}

export function normalizeSearchLedgerTransactionsFilters(input: SearchLedgerTransactionsInput): SearchLedgerTransactionsFilters {
  return {
    status: presentKeyword(input.status),
    source: presentKeyword(input.source),
    categorizedBy: presentKeyword(input.categorizedBy),
    bankTransactionId: presentText(input.bankTransactionId),
    categoryAccountIds: presentArray(input.categoryAccountIds),
    textContains: presentText(input.textContains),
    currency: presentKeyword(input.currency),
    ...presentAmountBounds(input.amountMin, input.amountMax),
    direction: input.direction ?? undefined,
    dateFrom: presentText(input.dateFrom),
    dateTo: presentText(input.dateTo),
    limit: presentLimit(input.limit),
  }
}

export function normalizeSearchLedgerAccountsFilters(input: SearchLedgerAccountsInput): SearchLedgerAccountsFilters {
  return {
    type: presentKeyword(input.type),
    status: presentKeyword(input.status),
    textContains: presentText(input.textContains),
    linkedBankAccount: input.linkedBankAccount ?? undefined,
    eligibleCategoryOnly: input.eligibleCategoryOnly ?? undefined,
    limit: presentLimit(input.limit),
  }
}

function presentText(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

// Keyword filters match exact stored values, so "any" can only be a
// model-invented wildcard — treat it as absent.
function presentKeyword(value: string | null | undefined) {
  const trimmed = presentText(value)
  return trimmed && trimmed.toLowerCase() !== 'any' ? trimmed : undefined
}

function presentArray(value: string[] | null | undefined) {
  return value && value.length > 0 ? value : undefined
}

// A 0/0 amount range is the sentinel for "no amount filter"; a genuine
// zero-amount search is not useful for bank data anyway.
function presentAmountBounds(amountMin: number | null | undefined, amountMax: number | null | undefined) {
  if (amountMin === 0 && amountMax === 0) return {amountMin: undefined, amountMax: undefined}
  return {amountMin: amountMin ?? undefined, amountMax: amountMax ?? undefined}
}

function presentLimit(value: number | null | undefined) {
  return typeof value === 'number' && value > 0 ? value : undefined
}
