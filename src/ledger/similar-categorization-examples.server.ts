import '@tanstack/react-start/server-only'

import {and, desc, eq, inArray, isNotNull, isNull, sql} from 'drizzle-orm'
import type {Database} from '@/db/client'
import {formatMoneyDecimal, moneySign} from '@/lib/money'
import {bankAccounts, bankTransactions, ledgerAccountGroups, ledgerAccounts, ledgerPostings, ledgerTransactions, teamMembers} from '@/db/schema'

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DrizzleTransaction = DatabaseTransaction

export type CategorizedBy = 'user' | 'ai' | null

export type SimilarCategorizationTargetTransaction = {
  id: string
  teamId: string
  date: string | null
  description: string
  amount: number
  currency: string
  bankAccountName: string
  counterpartyName: string | null
}

export type AiCategorizationSimilarExample = {
  ledgerTransactionId: string
  date: string | null
  description: string
  counterpartyName: string | null
  amount: string
  currency: string
  categoryAccountId: string
  categoryName: string
  categoryGroupName: string
  categorizedBy: CategorizedBy
  similarityReason: string
}

type LoadSimilarCategorizationExamplesInput = {
  userId: string
  transactions: ReadonlyArray<SimilarCategorizationTargetTransaction>
  limitPerTransaction?: number
}

type CandidateTransactionRow = {
  id: string
  teamId: string
  date: string | null
  description: string
  amount: number
  currency: string
  counterpartyName: string | null
  categorizedBy: CategorizedBy
}

type CandidateWithCategory = CandidateTransactionRow & {
  categoryAccountId: string
  categoryName: string
  categoryGroupName: string
}

type CandidateCategory = {
  categoryAccountId: string
  categoryName: string
  categoryGroupName: string
}

type ScoredExample = AiCategorizationSimilarExample & {score: number}

const DEFAULT_EXAMPLES_PER_TRANSACTION = 5
const RECENT_CANDIDATE_LIMIT_PER_TEAM = 200
const COUNTERPARTY_CANDIDATE_LIMIT_PER_TARGET = 50

export async function loadSimilarCategorizationExamples(
  tx: DrizzleTransaction,
  input: LoadSimilarCategorizationExamplesInput,
): Promise<Map<string, AiCategorizationSimilarExample[]>> {
  const result = new Map(input.transactions.map(transaction => [transaction.id, [] as AiCategorizationSimilarExample[]]))
  if (input.transactions.length === 0) return result

  const candidates = await loadConfirmedCandidateTransactions(tx, input.userId, input.transactions)
  const candidateCategoriesByTransactionId = await loadSingleEligibleCategoryByTransactionId(tx, candidates)
  const candidatesWithCategory = candidates
    .map(candidate => {
      const category = candidateCategoriesByTransactionId.get(candidate.id)
      if (!category) return null
      return {...candidate, ...category}
    })
    .filter((candidate): candidate is CandidateWithCategory => Boolean(candidate))

  for (const target of input.transactions) {
    const limit = boundedLimit(input.limitPerTransaction)
    const examples = candidatesWithCategory
      .filter(candidate => candidate.teamId === target.teamId && candidate.id !== target.id)
      .map(candidate => scoreCandidate(target, candidate))
      .filter(example => example.score > 0)
      .sort((left, right) => right.score - left.score || compareDatesDescending(left.date, right.date) || left.ledgerTransactionId.localeCompare(right.ledgerTransactionId))
      .slice(0, limit)
      .map(withoutScore)

    result.set(target.id, examples)
  }

  return result
}

async function loadConfirmedCandidateTransactions(
  tx: DrizzleTransaction,
  userId: string,
  targets: ReadonlyArray<SimilarCategorizationTargetTransaction>,
): Promise<CandidateTransactionRow[]> {
  if (targets.length === 0) return []

  const rowsById = new Map<string, CandidateTransactionRow>()
  const teamIds = uniqueStrings(targets.map(transaction => transaction.teamId))
  for (const teamId of teamIds) {
    addCandidateRows(
      rowsById,
      await tx
        .select({
          id: ledgerTransactions.id,
          teamId: ledgerTransactions.teamId,
          date: ledgerTransactions.date,
          description: ledgerTransactions.description,
          amount: bankTransactions.amount,
          currency: bankTransactions.currency,
          counterpartyName: bankTransactions.counterpartyName,
          categorizedBy: ledgerTransactions.categorizedBy,
        })
        .from(ledgerTransactions)
        .innerJoin(teamMembers, eq(teamMembers.teamId, ledgerTransactions.teamId))
        .innerJoin(ledgerPostings, and(eq(ledgerPostings.ledgerTransactionId, ledgerTransactions.id), isNotNull(ledgerPostings.bankTransactionId)))
        .innerJoin(bankTransactions, eq(bankTransactions.id, ledgerPostings.bankTransactionId))
        .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
        .where(
          and(
            eq(teamMembers.userId, userId),
            eq(ledgerTransactions.teamId, teamId),
            eq(ledgerTransactions.source, 'bank_import'),
            eq(ledgerTransactions.status, 'confirmed'),
            eq(bankAccounts.teamId, ledgerTransactions.teamId),
          ),
        )
        .orderBy(desc(ledgerTransactions.date), desc(ledgerTransactions.createdAt))
        .limit(RECENT_CANDIDATE_LIMIT_PER_TEAM),
    )
  }

  const counterpartyLookups = uniqueBy(
    targets
      .map(target => ({teamId: target.teamId, normalizedCounterparty: normalizeSearchText(target.counterpartyName ?? '')}))
      .filter(lookup => lookup.normalizedCounterparty.length > 0),
    lookup => `${lookup.teamId}\0${lookup.normalizedCounterparty}`,
  )

  for (const lookup of counterpartyLookups) {
    addCandidateRows(
      rowsById,
      await tx
        .select({
          id: ledgerTransactions.id,
          teamId: ledgerTransactions.teamId,
          date: ledgerTransactions.date,
          description: ledgerTransactions.description,
          amount: bankTransactions.amount,
          currency: bankTransactions.currency,
          counterpartyName: bankTransactions.counterpartyName,
          categorizedBy: ledgerTransactions.categorizedBy,
        })
        .from(ledgerTransactions)
        .innerJoin(teamMembers, eq(teamMembers.teamId, ledgerTransactions.teamId))
        .innerJoin(ledgerPostings, and(eq(ledgerPostings.ledgerTransactionId, ledgerTransactions.id), isNotNull(ledgerPostings.bankTransactionId)))
        .innerJoin(bankTransactions, eq(bankTransactions.id, ledgerPostings.bankTransactionId))
        .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
        .where(
          and(
            eq(teamMembers.userId, userId),
            eq(ledgerTransactions.teamId, lookup.teamId),
            eq(ledgerTransactions.source, 'bank_import'),
            eq(ledgerTransactions.status, 'confirmed'),
            eq(bankAccounts.teamId, ledgerTransactions.teamId),
            sql`trim(regexp_replace(lower(coalesce(${bankTransactions.counterpartyName}, '')), '[^a-z0-9]+', ' ', 'g')) = ${lookup.normalizedCounterparty}`,
          ),
        )
        .orderBy(desc(ledgerTransactions.date), desc(ledgerTransactions.createdAt))
        .limit(COUNTERPARTY_CANDIDATE_LIMIT_PER_TARGET),
    )
  }

  return [...rowsById.values()]
}

function addCandidateRows(
  rowsById: Map<string, CandidateTransactionRow>,
  rows: Array<{
    id: string
    teamId: string
    date: string | null
    description: string
    amount: number
    currency: string
    counterpartyName: string | null
    categorizedBy: string | null
  }>,
) {
  for (const row of rows) {
    rowsById.set(row.id, {
      id: row.id,
      teamId: row.teamId,
      date: row.date,
      description: row.description,
      amount: row.amount,
      currency: row.currency,
      counterpartyName: row.counterpartyName,
      categorizedBy: row.categorizedBy === 'user' || row.categorizedBy === 'ai' ? row.categorizedBy : null,
    })
  }
}

async function loadSingleEligibleCategoryByTransactionId(tx: DrizzleTransaction, candidates: CandidateTransactionRow[]) {
  const result = new Map<string, CandidateCategory>()
  if (candidates.length === 0) return result

  const candidateIds = candidates.map(candidate => candidate.id)
  const eligibleCategoryRows = await tx
    .select({
      ledgerTransactionId: ledgerPostings.ledgerTransactionId,
      categoryAccountId: ledgerAccounts.id,
      categoryName: ledgerAccounts.name,
      categoryGroupName: ledgerAccountGroups.name,
    })
    .from(ledgerPostings)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerPostings.ledgerTransactionId))
    .innerJoin(ledgerAccounts, and(eq(ledgerAccounts.id, ledgerPostings.accountId), eq(ledgerAccounts.teamId, ledgerTransactions.teamId)))
    .innerJoin(ledgerAccountGroups, and(eq(ledgerAccountGroups.id, ledgerAccounts.groupId), eq(ledgerAccountGroups.teamId, ledgerTransactions.teamId)))
    .where(
      and(
        inArray(ledgerPostings.ledgerTransactionId, candidateIds),
        isNull(ledgerPostings.bankTransactionId),
        eq(ledgerAccounts.status, 'active'),
        isNull(ledgerAccounts.systemKey),
        isNull(ledgerAccounts.linkedBankAccountId),
        inArray(ledgerAccounts.type, ['income', 'expense', 'savings']),
      ),
    )

  const eligibleAccountsByTransactionId = new Map<string, CandidateCategory[]>()

  for (const row of eligibleCategoryRows) {
    const existing = eligibleAccountsByTransactionId.get(row.ledgerTransactionId) ?? []
    existing.push({
      categoryAccountId: row.categoryAccountId,
      categoryName: row.categoryName,
      categoryGroupName: row.categoryGroupName,
    })
    eligibleAccountsByTransactionId.set(row.ledgerTransactionId, existing)
  }

  for (const [ledgerTransactionId, accountsForTransaction] of eligibleAccountsByTransactionId) {
    const uniqueAccounts = uniqueBy(accountsForTransaction, account => account.categoryAccountId)
    if (uniqueAccounts.length === 1) {
      result.set(ledgerTransactionId, uniqueAccounts[0]!)
    }
  }

  return result
}

function scoreCandidate(target: SimilarCategorizationTargetTransaction, candidate: CandidateWithCategory): ScoredExample {
  const targetCounterparty = normalizeSearchText(target.counterpartyName ?? '')
  const candidateCounterparty = normalizeSearchText(candidate.counterpartyName ?? '')
  const targetDescription = normalizeSearchText(target.description)
  const candidateDescription = normalizeSearchText(candidate.description)
  const sameCounterparty = targetCounterparty.length > 0 && targetCounterparty === candidateCounterparty
  const sameDescription = targetDescription.length > 0 && targetDescription === candidateDescription
  const descriptionSimilarity = tokenSimilarity(targetDescription, candidateDescription)
  const sameCurrency = target.currency === candidate.currency
  const sameSign = moneySign(target.amount) === moneySign(candidate.amount)
  const amountScore = similarAmountScore(target.amount, candidate.amount)
  const hasMeaningfulSimilaritySignal = sameCounterparty || sameDescription || descriptionSimilarity >= 0.6 || (sameCurrency && sameSign && amountScore > 0)
  const categorizedByScore = hasMeaningfulSimilaritySignal ? (candidate.categorizedBy === 'user' ? 600 : candidate.categorizedBy === 'ai' ? 300 : 0) : 0

  let score = categorizedByScore
  if (sameCounterparty) score += 700
  if (sameDescription) score += 300
  else if (descriptionSimilarity >= 0.6) score += Math.round(descriptionSimilarity * 200)
  if (sameCurrency && sameSign && hasMeaningfulSimilaritySignal) score += 100
  if (hasMeaningfulSimilaritySignal) score += amountScore
  if (hasMeaningfulSimilaritySignal) score += recencyScore(candidate.date)

  return {
    ledgerTransactionId: candidate.id,
    date: candidate.date,
    description: candidate.description,
    counterpartyName: candidate.counterpartyName,
    amount: formatMoneyDecimal(candidate.amount, candidate.currency),
    currency: candidate.currency,
    categoryAccountId: candidate.categoryAccountId,
    categoryName: candidate.categoryName,
    categoryGroupName: candidate.categoryGroupName,
    categorizedBy: candidate.categorizedBy,
    similarityReason: buildSimilarityReason({sameCounterparty, sameDescription, descriptionSimilarity, sameCurrency, sameSign, amountScore, categorizedBy: candidate.categorizedBy}),
    score,
  }
}

function withoutScore(example: ScoredExample): AiCategorizationSimilarExample {
  return {
    ledgerTransactionId: example.ledgerTransactionId,
    date: example.date,
    description: example.description,
    counterpartyName: example.counterpartyName,
    amount: example.amount,
    currency: example.currency,
    categoryAccountId: example.categoryAccountId,
    categoryName: example.categoryName,
    categoryGroupName: example.categoryGroupName,
    categorizedBy: example.categorizedBy,
    similarityReason: example.similarityReason,
  }
}

function buildSimilarityReason(input: {
  sameCounterparty: boolean
  sameDescription: boolean
  descriptionSimilarity: number
  sameCurrency: boolean
  sameSign: boolean
  amountScore: number
  categorizedBy: CategorizedBy
}) {
  const reasons: string[] = []
  if (input.categorizedBy === 'user') reasons.push('user-confirmed category')
  else if (input.categorizedBy === 'ai') reasons.push('AI-confirmed category')
  if (input.sameCounterparty) reasons.push('same counterparty')
  if (input.sameDescription) reasons.push('same normalized description')
  else if (input.descriptionSimilarity >= 0.6) reasons.push('similar description')
  if (input.sameCurrency && input.sameSign) reasons.push('same currency and direction')
  if (input.amountScore >= 70) reasons.push('similar amount')
  return reasons.length ? reasons.join('; ') : 'historical confirmed transaction'
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokenSimilarity(left: string, right: string) {
  if (!left || !right) return 0
  const leftTokens = new Set(left.split(' ').filter(Boolean))
  const rightTokens = new Set(right.split(' ').filter(Boolean))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length
  const union = new Set([...leftTokens, ...rightTokens]).size
  return intersection / union
}

function similarAmountScore(left: number, right: number) {
  const leftAmount = Math.abs(left)
  const rightAmount = Math.abs(right)
  if (leftAmount === 0 || rightAmount === 0) return 0
  const ratio = Math.min(leftAmount, rightAmount) / Math.max(leftAmount, rightAmount)
  if (ratio >= 0.98) return 150
  if (ratio >= 0.9) return 100
  if (ratio >= 0.75) return 40
  return 0
}

function recencyScore(date: string | null) {
  if (!date) return 0
  const timestamp = Date.parse(date)
  if (!Number.isFinite(timestamp)) return 0
  return Math.max(0, Math.min(50, Math.floor(timestamp / 86_400_000 / 365)))
}

function compareDatesDescending(left: string | null, right: string | null) {
  return (Date.parse(right ?? '') || 0) - (Date.parse(left ?? '') || 0)
}

function boundedLimit(limit: number | undefined) {
  return Math.min(Math.max(limit ?? DEFAULT_EXAMPLES_PER_TRANSACTION, 0), DEFAULT_EXAMPLES_PER_TRANSACTION)
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>()
  return values.filter(value => {
    const resolvedKey = key(value)
    if (seen.has(resolvedKey)) return false
    seen.add(resolvedKey)
    return true
  })
}
