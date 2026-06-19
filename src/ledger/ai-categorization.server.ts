import '@tanstack/react-start/server-only'

import {openai} from '@ai-sdk/openai'
import {generateObject} from 'ai'
import {and, desc, eq, inArray, isNull} from 'drizzle-orm'
import type {DrizzleTransaction as ZeroDrizzleTransaction} from '@rocicorp/zero/server/adapters/drizzle'
import {z} from 'zod'
import type {Database} from '@/db/client'
import {bankAccounts, bankTransactions, ledgerAccountGroups, ledgerAccounts, ledgerTransactions, teamMembers} from '@/db/schema'
import {categorizeLedgerTransaction} from './categorization.server'

export const AI_CATEGORIZATION_MODEL = 'gpt-5.4-nano'
export const AI_CATEGORIZATION_CONFIRM_THRESHOLD = 0.9
export const MAX_AI_CATEGORIZATION_BATCH_SIZE = 25

const suggestionSchema = z.object({
  ledgerTransactionId: z.string().min(1),
  categoryAccountId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().nullable(),
})

const suggestionsSchema = z.object({
  suggestions: z.array(suggestionSchema),
})

export type AiCategorizationCategory = {
  id: string
  name: string
  type: string
  groupName: string
  description: string
}

export type AiCategorizationTransaction = {
  id: string
  date: string | null
  description: string
  amount: string
  currency: string
  bankAccountName: string
  counterpartyName: string | null
}

export type AiCategorizationModelInput = {
  categories: AiCategorizationCategory[]
  transactions: AiCategorizationTransaction[]
}

export type AiCategorizationSuggestion = z.infer<typeof suggestionSchema>

export type AiCategorizationResult = {
  requested: number
  suggested: number
  applied: number
  confirmed: number
  stillNeedsReview: number
  skipped: number
}

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DrizzleTransaction = DatabaseTransaction | ZeroDrizzleTransaction<Database>

type AiCategorizeLedgerTransactionsInput = {
  userId: string
  ledgerTransactionIds?: string[]
  limit?: number
}

type CategorizeWithModel = (input: AiCategorizationModelInput) => Promise<AiCategorizationSuggestion[]>

type LoadedAiCategorizationCategory = AiCategorizationCategory & {teamId: string}
type LoadedAiCategorizationTransaction = AiCategorizationTransaction & {teamId: string}

export async function aiCategorizeLedgerTransactions(
  tx: DrizzleTransaction,
  input: AiCategorizeLedgerTransactionsInput,
  categorizeWithModel: CategorizeWithModel = categorizeWithOpenAI,
): Promise<AiCategorizationResult> {
  const transactions = input.ledgerTransactionIds?.length
    ? await loadRequestedTransactions(tx, input.userId, input.ledgerTransactionIds)
    : await loadNeedsReviewBatch(tx, input.userId, input.limit)

  if (transactions.length === 0) {
    throw new Error('No transactions available for AI categorization')
  }

  const transactionTeams = uniqueStrings(transactions.map(transaction => transaction.teamId))
  const categories = await loadEligibleCategories(tx, input.userId, transactionTeams)
  if (categories.length === 0) {
    throw new Error('No categories available for AI categorization')
  }

  const categoryTeamsById = new Map(categories.map(category => [category.id, category.teamId]))
  const transactionTeamsById = new Map(transactions.map(transaction => [transaction.id, transaction.teamId]))
  const categorizedTransactionIds = new Set<string>()
  let suggested = 0
  let applied = 0
  let confirmed = 0
  let stillNeedsReview = 0
  let skipped = 0

  for (const teamId of transactionTeams) {
    const teamTransactions = transactions.filter(transaction => transaction.teamId === teamId)
    const teamCategories = categories.filter(category => category.teamId === teamId)

    if (teamCategories.length === 0) {
      skipped += teamTransactions.length
      continue
    }

    const teamSuggestions = await categorizeWithModel({
      categories: teamCategories.map(toModelCategory),
      transactions: teamTransactions.map(toModelTransaction),
    })
    suggested += teamSuggestions.length

    for (const suggestion of teamSuggestions) {
      const transactionTeamId = transactionTeamsById.get(suggestion.ledgerTransactionId)
      const categoryTeamId = categoryTeamsById.get(suggestion.categoryAccountId)

      if (transactionTeamId !== teamId || categoryTeamId !== teamId) {
        skipped += 1
        continue
      }

      if (categorizedTransactionIds.has(suggestion.ledgerTransactionId)) {
        skipped += 1
        continue
      }

      const currentTransaction = await loadCurrentTransactionForAiApplication(tx, input.userId, suggestion.ledgerTransactionId)
      if (!currentTransaction || currentTransaction.teamId !== transactionTeamId || currentTransaction.status !== 'needs_review') {
        categorizedTransactionIds.add(suggestion.ledgerTransactionId)
        skipped += 1
        continue
      }

      const status = suggestion.confidence >= AI_CATEGORIZATION_CONFIRM_THRESHOLD ? 'confirmed' : 'needs_review'
      const didApply = await categorizeLedgerTransaction(tx, {
        userId: input.userId,
        ledgerTransactionId: suggestion.ledgerTransactionId,
        accountId: suggestion.categoryAccountId,
        status,
        aiConfidence: formatConfidence(suggestion.confidence),
        requiredCurrentStatus: 'needs_review',
      })

      categorizedTransactionIds.add(suggestion.ledgerTransactionId)
      if (!didApply) {
        skipped += 1
        continue
      }

      applied += 1
      if (status === 'confirmed') confirmed += 1
      else stillNeedsReview += 1
    }
  }

  return {
    requested: transactions.length,
    suggested,
    applied,
    confirmed,
    stillNeedsReview,
    skipped,
  }
}

export async function categorizeWithOpenAI(input: AiCategorizationModelInput): Promise<AiCategorizationSuggestion[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for AI categorization')
  }

  const {object} = await generateObject({
    model: openai(AI_CATEGORIZATION_MODEL),
    schema: suggestionsSchema,
    system: `You categorize personal finance ledger transactions. Choose exactly one categoryAccountId from the supplied categories for each transaction. Do not invent category ids. Return a confidence from 0 to 1.

Confidence calibration:
- 0.95-1.00: exact or near-certain merchant/category match, or a clear recurring pattern
- 0.85-0.94: strong semantic match with only minor ambiguity
- 0.70-0.84: plausible but ambiguous between multiple categories
- below 0.70: weak guess that likely needs human review`,
    prompt: JSON.stringify(input, null, 2),
  })

  return object.suggestions
}

async function loadEligibleCategories(tx: DrizzleTransaction, userId: string, teamIds: string[]): Promise<LoadedAiCategorizationCategory[]> {
  if (teamIds.length === 0) return []

  const rows = await tx
    .select({
      id: ledgerAccounts.id,
      teamId: ledgerAccounts.teamId,
      name: ledgerAccounts.name,
      type: ledgerAccounts.type,
      description: ledgerAccounts.description,
      groupName: ledgerAccountGroups.name,
    })
    .from(ledgerAccounts)
    .innerJoin(ledgerAccountGroups, eq(ledgerAccountGroups.id, ledgerAccounts.groupId))
    .innerJoin(teamMembers, eq(teamMembers.teamId, ledgerAccounts.teamId))
    .where(
      and(
        eq(teamMembers.userId, userId),
        inArray(ledgerAccounts.teamId, teamIds),
        eq(ledgerAccounts.status, 'active'),
        isNull(ledgerAccounts.systemKey),
        isNull(ledgerAccounts.linkedBankAccountId),
        inArray(ledgerAccounts.type, ['income', 'expense', 'savings']),
      ),
    )
    .orderBy(ledgerAccountGroups.sortOrder, ledgerAccounts.sortOrder, ledgerAccounts.name)

  return rows.map(row => ({
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    type: row.type,
    groupName: row.groupName,
    description: row.description,
  }))
}

async function loadRequestedTransactions(tx: DrizzleTransaction, userId: string, ledgerTransactionIds: string[]): Promise<LoadedAiCategorizationTransaction[]> {
  return loadTransactions(tx, userId, uniqueStrings(ledgerTransactionIds).slice(0, MAX_AI_CATEGORIZATION_BATCH_SIZE))
}

async function loadNeedsReviewBatch(tx: DrizzleTransaction, userId: string, limit: number | undefined): Promise<LoadedAiCategorizationTransaction[]> {
  const cappedLimit = Math.min(Math.max(limit ?? MAX_AI_CATEGORIZATION_BATCH_SIZE, 1), MAX_AI_CATEGORIZATION_BATCH_SIZE)
  return loadTransactions(tx, userId, undefined, cappedLimit)
}

async function loadTransactions(
  tx: DrizzleTransaction,
  userId: string,
  ledgerTransactionIds?: string[],
  limit = MAX_AI_CATEGORIZATION_BATCH_SIZE,
): Promise<LoadedAiCategorizationTransaction[]> {
  const baseConditions = [
    eq(teamMembers.userId, userId),
    eq(ledgerTransactions.source, 'bank_import'),
    eq(ledgerTransactions.status, 'needs_review'),
  ]

  if (ledgerTransactionIds) {
    if (ledgerTransactionIds.length === 0) return []
    baseConditions.push(inArray(ledgerTransactions.id, ledgerTransactionIds))
  }

  const rows = await tx
    .select({
      id: ledgerTransactions.id,
      teamId: ledgerTransactions.teamId,
      date: ledgerTransactions.date,
      description: ledgerTransactions.description,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      bankAccountName: bankAccounts.name,
      counterpartyName: bankTransactions.counterpartyName,
    })
    .from(ledgerTransactions)
    .innerJoin(teamMembers, eq(teamMembers.teamId, ledgerTransactions.teamId))
    .innerJoin(bankTransactions, eq(bankTransactions.id, ledgerTransactions.bankTransactionId))
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .where(and(...baseConditions))
    .orderBy(desc(ledgerTransactions.date), desc(ledgerTransactions.createdAt))
    .limit(limit)

  return rows.map(row => ({
    id: row.id,
    teamId: row.teamId,
    date: row.date,
    description: row.description,
    amount: String(row.amount),
    currency: row.currency,
    bankAccountName: row.bankAccountName,
    counterpartyName: row.counterpartyName,
  }))
}

async function loadCurrentTransactionForAiApplication(tx: DrizzleTransaction, userId: string, ledgerTransactionId: string) {
  const [transaction] = await tx
    .select({teamId: ledgerTransactions.teamId, status: ledgerTransactions.status})
    .from(ledgerTransactions)
    .innerJoin(teamMembers, eq(teamMembers.teamId, ledgerTransactions.teamId))
    .where(and(eq(ledgerTransactions.id, ledgerTransactionId), eq(teamMembers.userId, userId)))
    .limit(1)

  return transaction
}

function toModelCategory(category: LoadedAiCategorizationCategory): AiCategorizationCategory {
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    groupName: category.groupName,
    description: category.description,
  }
}

function toModelTransaction(transaction: LoadedAiCategorizationTransaction): AiCategorizationTransaction {
  return {
    id: transaction.id,
    date: transaction.date,
    description: transaction.description,
    amount: transaction.amount,
    currency: transaction.currency,
    bankAccountName: transaction.bankAccountName,
    counterpartyName: transaction.counterpartyName,
  }
}

function formatConfidence(confidence: number) {
  return confidence.toFixed(4)
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}
