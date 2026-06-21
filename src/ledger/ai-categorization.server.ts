import '@tanstack/react-start/server-only'

import {openai} from '@ai-sdk/openai'
import {generateObject} from 'ai'
import {and, desc, eq, inArray, isNull, lt, or} from 'drizzle-orm'
import {z} from 'zod'
import {db, type Database} from '@/db/client'
import {formatMoneyDecimal} from '@/lib/money'
import {bankAccounts, bankTransactions, ledgerAccountGroups, ledgerAccounts, ledgerPostings, ledgerTransactions, teamMembers} from '@/db/schema'
import {categorizeBankTransaction, normalizeAiReasoning} from './categorization.server'
import {loadSimilarCategorizationExamples, type AiCategorizationSimilarExample} from './similar-categorization-examples.server'

export const AI_CATEGORIZATION_MODEL = 'gpt-5.4-nano'
export const MAX_AI_CATEGORIZATION_BATCH_SIZE = 25
const AI_PROCESSING_STALE_AFTER_MS = 30 * 60 * 1000

const aiConfidenceSchema = z.union([z.literal(0), z.literal(1), z.literal(2)])

const suggestionSchema = z.object({
  bankTransactionId: z.string().min(1),
  categoryAccountId: z.string().min(1).nullable(),
  confidence: aiConfidenceSchema,
  reasoning: z.string().min(1).regex(/\S/),
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
  similarConfirmedExamples: AiCategorizationSimilarExample[]
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
type DrizzleTransaction = DatabaseTransaction

type AiCategorizeBankTransactionsInput = {
  userId: string
  bankTransactionIds?: string[]
  limit?: number
}

type CategorizeWithModel = (input: AiCategorizationModelInput) => Promise<AiCategorizationSuggestion[]>

type LoadedAiCategorizationCategory = AiCategorizationCategory & {teamId: string}
type LoadedAiCategorizationTransaction = Omit<AiCategorizationTransaction, 'amount' | 'similarConfirmedExamples'> & {teamId: string; amount: number}

type ClaimedAiCategorizationWork = {
  transactions: LoadedAiCategorizationTransaction[]
  categories: LoadedAiCategorizationCategory[]
  processingStartedAt: Date
}

type ApplySuggestionContext = {
  categoryTeamsById: Map<string, string>
  transactionTeamsById: Map<string, string>
  categorizedTransactionIds: Set<string>
  processingStartedAt: Date
}

export async function aiCategorizeBankTransactions(
  input: AiCategorizeBankTransactionsInput,
  categorizeWithModel: CategorizeWithModel = categorizeWithOpenAI,
): Promise<AiCategorizationResult> {
  const work = await db.transaction(tx => claimAiCategorizationWork(tx, input))
  const bankTransactionIds = work.transactions.map(transaction => transaction.id)

  try {
    const similarExamplesByTransactionId = await db.transaction(tx =>
      loadSimilarCategorizationExamples(tx, {
        userId: input.userId,
        transactions: work.transactions,
      }),
    )

    let suggested = 0
    let applied = 0
    let confirmed = 0
    let stillNeedsReview = 0
    let skipped = 0
    const categoryTeamsById = new Map(work.categories.map(category => [category.id, category.teamId]))
    const transactionTeamsById = new Map(work.transactions.map(transaction => [transaction.id, transaction.teamId]))
    const categorizedTransactionIds = new Set<string>()

    for (const teamId of uniqueStrings(work.transactions.map(transaction => transaction.teamId))) {
      const teamTransactions = work.transactions.filter(transaction => transaction.teamId === teamId)
      const teamCategories = work.categories.filter(category => category.teamId === teamId)

      if (teamCategories.length === 0) {
        skipped += teamTransactions.length
        continue
      }

      const teamSuggestions = await categorizeWithModel({
        categories: teamCategories.map(toModelCategory),
        transactions: teamTransactions.map(transaction => toModelTransaction(transaction, similarExamplesByTransactionId.get(transaction.id) ?? [])),
      })
      suggested += teamSuggestions.length

      const applyResult = await db.transaction(tx =>
        applyAiCategorizationSuggestions(tx, input.userId, teamId, teamSuggestions, {
          categoryTeamsById,
          transactionTeamsById,
          categorizedTransactionIds,
          processingStartedAt: work.processingStartedAt,
        }),
      )
      applied += applyResult.applied
      confirmed += applyResult.confirmed
      stillNeedsReview += applyResult.stillNeedsReview
      skipped += applyResult.skipped
    }

    return {requested: work.transactions.length, suggested, applied, confirmed, stillNeedsReview, skipped}
  } finally {
    await clearAiProcessingStartedAt(input.userId, bankTransactionIds, work.processingStartedAt)
  }
}

export async function categorizeWithOpenAI(input: AiCategorizationModelInput): Promise<AiCategorizationSuggestion[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for AI categorization')
  }

  const {object} = await generateObject({
    model: openai(AI_CATEGORIZATION_MODEL),
    schema: suggestionsSchema,
    system: `You categorize personal finance ledger transactions. For each transaction, return one suggestion with confidence 0, 1, or 2.

Use only supplied category ids. Do not invent category ids.

Each transaction may include similarConfirmedExamples from already-categorized same-team transactions. User-confirmed similar examples are strong evidence. Near-identical merchant or counterparty examples should usually use the same category. AI-confirmed examples are useful but weaker than user-confirmed examples. Do not blindly copy an example if amount direction, currency, merchant context, or description indicates a different category. If similar user-confirmed examples disagree, lower confidence.

Confidence calibration:
- 0: very low confidence; cannot categorize reliably. Use categoryAccountId null.
- 1: plausible category but needs user review. Use a supplied categoryAccountId.
- 2: confident category match. Use a supplied categoryAccountId.

Include concise user-readable reasoning for every suggestion. Mention merchant/counterparty patterns or similar confirmed examples when relevant. Do not expose private chain-of-thought; provide only a short display-safe explanation suitable for a tooltip.

If confidence is 0, categoryAccountId must be null. If confidence is 1 or 2, categoryAccountId must be one supplied category id.`,
    prompt: JSON.stringify(input, null, 2),
  })

  return object.suggestions
}

async function claimAiCategorizationWork(tx: DrizzleTransaction, input: AiCategorizeBankTransactionsInput): Promise<ClaimedAiCategorizationWork> {
  const transactions = input.bankTransactionIds?.length
    ? await loadRequestedTransactions(tx, input.userId, input.bankTransactionIds)
    : await loadNeedsReviewBatch(tx, input.userId, input.limit)

  if (transactions.length === 0) {
    throw new Error('No transactions available for AI categorization')
  }

  const now = new Date()
  const [freshProcessingCutoff, transactionIds] = [aiProcessingFreshCutoff(now), transactions.map(transaction => transaction.id)]
  const claimedRows = await tx
    .update(bankTransactions)
    .set({aiProcessingStartedAt: now, updatedAt: now})
    .where(
      and(
        inArray(bankTransactions.id, transactionIds),
        or(isNull(bankTransactions.aiProcessingStartedAt), lt(bankTransactions.aiProcessingStartedAt, freshProcessingCutoff)),
      ),
    )
    .returning({id: bankTransactions.id})
  const claimedIds = new Set(claimedRows.map(row => row.id))
  const claimedTransactions = transactions.filter(transaction => claimedIds.has(transaction.id))

  if (claimedTransactions.length === 0) {
    throw new Error('No transactions available for AI categorization')
  }

  const transactionTeams = uniqueStrings(claimedTransactions.map(transaction => transaction.teamId))
  const categories = await loadEligibleCategories(tx, input.userId, transactionTeams)
  if (categories.length === 0) {
    throw new Error('No categories available for AI categorization')
  }

  return {transactions: claimedTransactions, categories, processingStartedAt: now}
}

async function applyAiCategorizationSuggestions(
  tx: DrizzleTransaction,
  userId: string,
  teamId: string,
  suggestions: AiCategorizationSuggestion[],
  context: ApplySuggestionContext,
): Promise<Pick<AiCategorizationResult, 'applied' | 'confirmed' | 'stillNeedsReview' | 'skipped'>> {
  let applied = 0
  let confirmed = 0
  let stillNeedsReview = 0
  let skipped = 0

  for (const suggestion of suggestions) {
    const transactionTeamId = context.transactionTeamsById.get(suggestion.bankTransactionId)
    const categoryTeamId = suggestion.categoryAccountId ? context.categoryTeamsById.get(suggestion.categoryAccountId) : undefined

    if (transactionTeamId !== teamId || (suggestion.confidence > 0 && categoryTeamId !== teamId)) {
      skipped += 1
      continue
    }

    if (context.categorizedTransactionIds.has(suggestion.bankTransactionId)) {
      skipped += 1
      continue
    }

    const currentTransaction = await loadCurrentTransactionForAiApplication(tx, userId, suggestion.bankTransactionId)
    if (!currentTransaction || currentTransaction.teamId !== transactionTeamId || currentTransaction.status === 'confirmed') {
      context.categorizedTransactionIds.add(suggestion.bankTransactionId)
      skipped += 1
      continue
    }

    if (!isSameProcessingMarker(currentTransaction.aiProcessingStartedAt, context.processingStartedAt)) {
      context.categorizedTransactionIds.add(suggestion.bankTransactionId)
      skipped += 1
      continue
    }

    if (suggestion.confidence === 0) {
      const didRecord = await recordAiConfidenceWithoutCategory(tx, userId, suggestion.bankTransactionId, 0, suggestion.reasoning)
      context.categorizedTransactionIds.add(suggestion.bankTransactionId)
      if (!didRecord) {
        skipped += 1
        continue
      }
      stillNeedsReview += 1
      continue
    }

    if (!suggestion.categoryAccountId) {
      skipped += 1
      continue
    }

    const status = suggestion.confidence === 2 ? 'confirmed' : 'needs_review'
    const didApply = await categorizeBankTransaction(tx, {
      userId,
      bankTransactionId: suggestion.bankTransactionId,
      selection: {kind: 'category', accountId: suggestion.categoryAccountId},
      status,
      aiConfidence: suggestion.confidence,
      aiReasoning: suggestion.reasoning,
      categorizedBy: 'ai',
      requiredExistingStatus: 'needs_review',
    })

    context.categorizedTransactionIds.add(suggestion.bankTransactionId)
    if (!didApply) {
      skipped += 1
      continue
    }

    applied += 1
    if (status === 'confirmed') confirmed += 1
    else stillNeedsReview += 1
  }

  return {applied, confirmed, stillNeedsReview, skipped}
}

async function recordAiConfidenceWithoutCategory(tx: DrizzleTransaction, userId: string, bankTransactionId: string, aiConfidence: 0, aiReasoning: string) {
  const now = new Date()
  const authorizedIds = await selectAuthorizedBankTransactionIds(tx, userId, [bankTransactionId])
  if (authorizedIds.length === 0) return false

  const [updatedTransaction] = await tx
    .update(bankTransactions)
    .set({
      aiConfidence,
      aiReasoning: normalizeAiReasoning(aiReasoning),
      aiProcessingStartedAt: null,
      updatedAt: now,
    })
    .where(inArray(bankTransactions.id, authorizedIds))
    .returning({id: bankTransactions.id})

  return Boolean(updatedTransaction)
}

async function clearAiProcessingStartedAt(userId: string, bankTransactionIds: string[], processingStartedAt: Date) {
  if (bankTransactionIds.length === 0) return

  const authorizedIds = await selectAuthorizedBankTransactionIds(db, userId, bankTransactionIds)
  if (authorizedIds.length === 0) return

  await db
    .update(bankTransactions)
    .set({aiProcessingStartedAt: null, updatedAt: new Date()})
    .where(and(inArray(bankTransactions.id, authorizedIds), eq(bankTransactions.aiProcessingStartedAt, processingStartedAt)))
}

async function selectAuthorizedBankTransactionIds(
  tx: DrizzleTransaction | Database,
  userId: string,
  bankTransactionIds: string[],
) {
  if (bankTransactionIds.length === 0) return []

  const rows = await tx
    .select({id: bankTransactions.id})
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .innerJoin(teamMembers, eq(teamMembers.teamId, bankAccounts.teamId))
    .where(and(inArray(bankTransactions.id, bankTransactionIds), eq(teamMembers.userId, userId)))

  return rows.map(row => row.id)
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

async function loadRequestedTransactions(tx: DrizzleTransaction, userId: string, bankTransactionIds: string[]): Promise<LoadedAiCategorizationTransaction[]> {
  return loadTransactions(tx, userId, uniqueStrings(bankTransactionIds).slice(0, MAX_AI_CATEGORIZATION_BATCH_SIZE))
}

async function loadNeedsReviewBatch(tx: DrizzleTransaction, userId: string, limit: number | undefined): Promise<LoadedAiCategorizationTransaction[]> {
  const cappedLimit = Math.min(Math.max(limit ?? MAX_AI_CATEGORIZATION_BATCH_SIZE, 1), MAX_AI_CATEGORIZATION_BATCH_SIZE)
  return loadTransactions(tx, userId, undefined, cappedLimit)
}

async function loadTransactions(
  tx: DrizzleTransaction,
  userId: string,
  bankTransactionIds?: string[],
  limit = MAX_AI_CATEGORIZATION_BATCH_SIZE,
): Promise<LoadedAiCategorizationTransaction[]> {
  const baseConditions = [
    eq(teamMembers.userId, userId),
    or(isNull(bankTransactions.aiProcessingStartedAt), lt(bankTransactions.aiProcessingStartedAt, aiProcessingFreshCutoff())),
    or(isNull(ledgerTransactions.id), eq(ledgerTransactions.status, 'needs_review')),
  ]

  if (bankTransactionIds) {
    if (bankTransactionIds.length === 0) return []
    baseConditions.push(inArray(bankTransactions.id, bankTransactionIds))
  }

  const rows = await tx
    .select({
      id: bankTransactions.id,
      teamId: bankAccounts.teamId,
      bookingDate: bankTransactions.bookingDate,
      valueDate: bankTransactions.valueDate,
      description: bankTransactions.description,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      bankAccountName: bankAccounts.name,
      counterpartyName: bankTransactions.counterpartyName,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .innerJoin(teamMembers, eq(teamMembers.teamId, bankAccounts.teamId))
    .leftJoin(ledgerPostings, eq(ledgerPostings.bankTransactionId, bankTransactions.id))
    .leftJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerPostings.ledgerTransactionId))
    .where(and(...baseConditions))
    .orderBy(desc(bankTransactions.bookingDate), desc(bankTransactions.createdAt))
    .limit(limit)

  return rows.map(row => ({
    id: row.id,
    teamId: row.teamId,
    date: row.bookingDate ?? row.valueDate,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    bankAccountName: row.bankAccountName,
    counterpartyName: row.counterpartyName,
  }))
}

async function loadCurrentTransactionForAiApplication(tx: DrizzleTransaction, userId: string, bankTransactionId: string) {
  const [transaction] = await tx
    .select({teamId: bankAccounts.teamId, status: ledgerTransactions.status, aiProcessingStartedAt: bankTransactions.aiProcessingStartedAt})
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .innerJoin(teamMembers, eq(teamMembers.teamId, bankAccounts.teamId))
    .leftJoin(ledgerPostings, eq(ledgerPostings.bankTransactionId, bankTransactions.id))
    .leftJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerPostings.ledgerTransactionId))
    .where(and(eq(bankTransactions.id, bankTransactionId), eq(teamMembers.userId, userId)))
    .limit(1)
    .for('update', {of: bankTransactions})

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

function toModelTransaction(transaction: LoadedAiCategorizationTransaction, similarConfirmedExamples: AiCategorizationSimilarExample[]): AiCategorizationTransaction {
  return {
    id: transaction.id,
    date: transaction.date,
    description: transaction.description,
    amount: formatMoneyDecimal(transaction.amount, transaction.currency),
    currency: transaction.currency,
    bankAccountName: transaction.bankAccountName,
    counterpartyName: transaction.counterpartyName,
    similarConfirmedExamples,
  }
}

function aiProcessingFreshCutoff(now = new Date()) {
  return new Date(now.getTime() - AI_PROCESSING_STALE_AFTER_MS)
}

function isSameProcessingMarker(current: Date | null, expected: Date) {
  return current?.getTime() === expected.getTime()
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}
