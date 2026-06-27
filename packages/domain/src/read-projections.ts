import {and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, or, sql as drizzleSql, type AnyColumn, type SQL} from 'drizzle-orm'
import type {Database} from './db'
import type {TrustedTeamScope} from './team-scope'
import {bankAccounts, bankTransactions, ledgerAccountGroups, ledgerAccounts, ledgerPostings, ledgerTransactions} from './schema'

export type ReviewStatusFilter = 'uncategorized' | 'needs_review' | 'confirmed' | 'ai_unable' | 'any'
export type MoneyDirectionFilter = 'inflow' | 'outflow'

export type DomainReadExecutor = Pick<Database, 'select'>

export type TrustedToolScope = TrustedTeamScope & {
  targetBankTransactionIds?: string[]
}

export type SearchBankTransactionsFilters = {
  reviewStatus?: ReviewStatusFilter
  bankTransactionIds?: string[]
  bankAccountIds?: string[]
  textContains?: string
  counterpartyContains?: string
  currency?: string
  amountMin?: number
  amountMax?: number
  direction?: MoneyDirectionFilter
  dateFrom?: string
  dateTo?: string
  limit?: number
}

export type BankTransactionSearchResult = {
  id: string
  bankAccountId: string
  bankAccountName: string
  date: string | null
  bookingDate: string | null
  valueDate: string | null
  amount: number
  currency: string
  description: string
  counterpartyName: string | null
  reviewStatus: ReviewStatusFilter
  interpretation: InterpretationSummary | null
  aiConfidence: number | null
  aiReasoning: string | null
  categorizationRevision: number
  canWrite: boolean
}

export type BankTransactionDetail = BankTransactionSearchResult & {
  ledgerTransaction: LedgerTransactionSummary | null
  postings: PostingSummary[]
}

export type SearchLedgerTransactionsFilters = {
  status?: string
  source?: string
  categorizedBy?: string
  bankTransactionId?: string
  categoryAccountIds?: string[]
  textContains?: string
  currency?: string
  amountMin?: number
  amountMax?: number
  direction?: MoneyDirectionFilter
  dateFrom?: string
  dateTo?: string
  limit?: number
}

export type LedgerTransactionSearchResult = LedgerTransactionSummary & {
  postings: PostingSummary[]
  interpretationKind: InterpretationKind
}

export type SearchLedgerAccountsFilters = {
  type?: string
  status?: string
  textContains?: string
  linkedBankAccount?: boolean
  eligibleCategoryOnly?: boolean
  limit?: number
}

export type LedgerAccountSearchResult = {
  id: string
  teamId: string
  groupId: string
  groupName: string
  linkedBankAccountId: string | null
  systemKey: string | null
  type: string
  normalBalance: string
  name: string
  description: string
  status: string
  sortOrder: number
}

type LedgerTransactionSummary = {
  id: string
  teamId: string
  source: string
  status: string
  categorizedBy: string | null
  userConfirmedAt: Date | null
  userConfirmedBy: string | null
  date: string | null
  description: string | null
}

type PostingSummary = {
  id: string
  ledgerTransactionId: string
  accountId: string
  accountName: string
  accountType: string
  linkedBankAccountId: string | null
  amount: number
  currency: string
  bankTransactionId: string | null
  sortOrder: number
}

type InterpretationKind = 'uncategorized' | 'category' | 'split' | 'transfer' | 'other'

type InterpretationSummary = {
  ledgerTransactionId: string
  status: string
  categorizedBy: string | null
  userConfirmed: boolean
  kind: InterpretationKind
}

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

export async function searchBankTransactions(
  tx: DomainReadExecutor,
  input: TrustedToolScope & {filters?: SearchBankTransactionsFilters},
): Promise<BankTransactionSearchResult[]> {
  const filters = input.filters ?? {}
  const conditions: SQL[] = [eq(bankAccounts.teamId, input.teamId)]

  addOptionalArrayCondition(conditions, bankTransactions.id, filters.bankTransactionIds)
  addOptionalArrayCondition(conditions, bankTransactions.bankAccountId, filters.bankAccountIds)
  addOptionalTextCondition(conditions, bankTransactions.description, filters.textContains)
  addOptionalTextCondition(conditions, bankTransactions.counterpartyName, filters.counterpartyContains)
  if (filters.currency) conditions.push(eq(bankTransactions.currency, filters.currency))
  if (filters.amountMin !== undefined) conditions.push(gte(bankTransactions.amount, filters.amountMin))
  if (filters.amountMax !== undefined) conditions.push(lte(bankTransactions.amount, filters.amountMax))
  if (filters.direction === 'inflow') conditions.push(gte(bankTransactions.amount, 1))
  if (filters.direction === 'outflow') conditions.push(lte(bankTransactions.amount, -1))
  if (filters.dateFrom) conditions.push(gte(bankTransactions.bookingDate, filters.dateFrom))
  if (filters.dateTo) conditions.push(lte(bankTransactions.bookingDate, filters.dateTo))
  addReviewStatusCondition(conditions, filters.reviewStatus)

  const rows = await tx
    .select({
      id: bankTransactions.id,
      bankAccountId: bankTransactions.bankAccountId,
      bankAccountName: bankAccounts.name,
      bookingDate: bankTransactions.bookingDate,
      valueDate: bankTransactions.valueDate,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      description: bankTransactions.description,
      counterpartyName: bankTransactions.counterpartyName,
      aiConfidence: bankTransactions.aiConfidence,
      aiReasoning: bankTransactions.aiReasoning,
      categorizationRevision: bankTransactions.categorizationRevision,
      ledgerTransactionId: ledgerTransactions.id,
      ledgerStatus: ledgerTransactions.status,
      categorizedBy: ledgerTransactions.categorizedBy,
      userConfirmedAt: ledgerTransactions.userConfirmedAt,
      userConfirmedBy: ledgerTransactions.userConfirmedBy,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .leftJoin(ledgerPostings, eq(ledgerPostings.bankTransactionId, bankTransactions.id))
    .leftJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerPostings.ledgerTransactionId))
    .where(and(...conditions))
    .orderBy(desc(bankTransactions.bookingDate), desc(bankTransactions.createdAt), desc(bankTransactions.id))
    .limit(limit(filters.limit))

  const interpretationKinds = await loadInterpretationKinds(tx, rows.flatMap(row => (row.ledgerTransactionId ? [row.ledgerTransactionId] : [])))
  const targetIds = input.targetBankTransactionIds ? new Set(input.targetBankTransactionIds) : null

  return rows.map(row => {
    const reviewStatus = deriveReviewStatus(row.ledgerTransactionId, row.ledgerStatus, row.aiConfidence)
    const canWriteByStatus = reviewStatus === 'uncategorized' || (reviewStatus === 'needs_review' && !row.userConfirmedAt && !row.userConfirmedBy)
    return {
      id: row.id,
      bankAccountId: row.bankAccountId,
      bankAccountName: row.bankAccountName,
      date: row.bookingDate ?? row.valueDate,
      bookingDate: row.bookingDate,
      valueDate: row.valueDate,
      amount: row.amount,
      currency: row.currency,
      description: row.description,
      counterpartyName: row.counterpartyName,
      reviewStatus,
      interpretation: row.ledgerTransactionId
        ? {
            ledgerTransactionId: row.ledgerTransactionId,
            status: row.ledgerStatus ?? 'needs_review',
            categorizedBy: row.categorizedBy,
            userConfirmed: Boolean(row.userConfirmedAt || row.userConfirmedBy),
            kind: interpretationKinds.get(row.ledgerTransactionId) ?? 'other',
          }
        : null,
      aiConfidence: row.aiConfidence,
      aiReasoning: row.aiReasoning,
      categorizationRevision: row.categorizationRevision,
      canWrite: canWriteByStatus && (!targetIds || targetIds.has(row.id)),
    }
  })
}

export async function getBankTransactionDetail(
  tx: DomainReadExecutor,
  input: TrustedToolScope & {bankTransactionId: string},
): Promise<BankTransactionDetail | null> {
  const [summary] = await searchBankTransactions(tx, {
    userId: input.userId,
    teamId: input.teamId,
    targetBankTransactionIds: input.targetBankTransactionIds,
    filters: {bankTransactionIds: [input.bankTransactionId], reviewStatus: 'any', limit: 1},
  })
  if (!summary) return null

  const ledgerTransactionId = summary.interpretation?.ledgerTransactionId
  const [ledgerTransaction, postings] = ledgerTransactionId
    ? await Promise.all([loadLedgerTransaction(tx, input, ledgerTransactionId), loadPostings(tx, input, [ledgerTransactionId])])
    : [null, []]

  return {...summary, ledgerTransaction, postings}
}

export async function searchLedgerTransactions(
  tx: DomainReadExecutor,
  input: TrustedToolScope & {filters?: SearchLedgerTransactionsFilters},
): Promise<LedgerTransactionSearchResult[]> {
  const filters = input.filters ?? {}
  const conditions: SQL[] = [eq(ledgerTransactions.teamId, input.teamId)]
  if (filters.status) conditions.push(eq(ledgerTransactions.status, filters.status))
  if (filters.source) conditions.push(eq(ledgerTransactions.source, filters.source))
  if (filters.categorizedBy) conditions.push(eq(ledgerTransactions.categorizedBy, filters.categorizedBy))
  if (filters.dateFrom) conditions.push(gte(ledgerTransactions.date, filters.dateFrom))
  if (filters.dateTo) conditions.push(lte(ledgerTransactions.date, filters.dateTo))
  if (filters.textContains) conditions.push(or(ilike(ledgerTransactions.description, `%${filters.textContains}%`), ilike(bankTransactions.description, `%${filters.textContains}%`))!)
  if (filters.bankTransactionId) conditions.push(eq(ledgerPostings.bankTransactionId, filters.bankTransactionId))
  if (filters.categoryAccountIds?.length) conditions.push(inArray(ledgerPostings.accountId, filters.categoryAccountIds))
  if (filters.currency) conditions.push(eq(ledgerPostings.currency, filters.currency))
  if (filters.amountMin !== undefined) conditions.push(gte(ledgerPostings.amount, filters.amountMin))
  if (filters.amountMax !== undefined) conditions.push(lte(ledgerPostings.amount, filters.amountMax))
  if (filters.direction === 'inflow') conditions.push(gte(ledgerPostings.amount, 1))
  if (filters.direction === 'outflow') conditions.push(lte(ledgerPostings.amount, -1))

  const rows = await tx
    .select({
      id: ledgerTransactions.id,
      teamId: ledgerTransactions.teamId,
      source: ledgerTransactions.source,
      status: ledgerTransactions.status,
      categorizedBy: ledgerTransactions.categorizedBy,
      userConfirmedAt: ledgerTransactions.userConfirmedAt,
      userConfirmedBy: ledgerTransactions.userConfirmedBy,
      date: ledgerTransactions.date,
      description: ledgerTransactions.description,
    })
    .from(ledgerTransactions)
    .leftJoin(ledgerPostings, eq(ledgerPostings.ledgerTransactionId, ledgerTransactions.id))
    .leftJoin(bankTransactions, eq(bankTransactions.id, ledgerPostings.bankTransactionId))
    .where(and(...conditions))
    .orderBy(desc(ledgerTransactions.date), desc(ledgerTransactions.createdAt), desc(ledgerTransactions.id))
    .limit(limit(filters.limit))

  const uniqueRows = uniqueById(rows)
  const postings = await loadPostings(tx, input, uniqueRows.map(row => row.id))
  const postingsByLedgerTransactionId = groupPostingsByLedgerTransactionId(postings)
  return uniqueRows.map(row => ({
    ...row,
    postings: postingsByLedgerTransactionId.get(row.id) ?? [],
    interpretationKind: deriveInterpretationKind(postingsByLedgerTransactionId.get(row.id) ?? []),
  }))
}

export async function searchLedgerAccounts(
  tx: DomainReadExecutor,
  input: TrustedToolScope & {filters?: SearchLedgerAccountsFilters},
): Promise<LedgerAccountSearchResult[]> {
  const filters = input.filters ?? {}
  const conditions: SQL[] = [eq(ledgerAccounts.teamId, input.teamId)]
  if (filters.type) conditions.push(eq(ledgerAccounts.type, filters.type))
  if (filters.status) conditions.push(eq(ledgerAccounts.status, filters.status))
  if (filters.textContains) conditions.push(or(ilike(ledgerAccounts.name, `%${filters.textContains}%`), ilike(ledgerAccounts.description, `%${filters.textContains}%`))!)
  if (filters.linkedBankAccount === true) conditions.push(isNotNull(ledgerAccounts.linkedBankAccountId))
  if (filters.linkedBankAccount === false) conditions.push(isNull(ledgerAccounts.linkedBankAccountId))
  if (filters.eligibleCategoryOnly) {
    conditions.push(eq(ledgerAccounts.status, 'active'))
    conditions.push(isNull(ledgerAccounts.systemKey))
    conditions.push(isNull(ledgerAccounts.linkedBankAccountId))
    conditions.push(inArray(ledgerAccounts.type, ['income', 'expense', 'savings']))
  }

  return tx
    .select({
      id: ledgerAccounts.id,
      teamId: ledgerAccounts.teamId,
      groupId: ledgerAccounts.groupId,
      groupName: ledgerAccountGroups.name,
      linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
      systemKey: ledgerAccounts.systemKey,
      type: ledgerAccounts.type,
      normalBalance: ledgerAccounts.normalBalance,
      name: ledgerAccounts.name,
      description: ledgerAccounts.description,
      status: ledgerAccounts.status,
      sortOrder: ledgerAccounts.sortOrder,
    })
    .from(ledgerAccounts)
    .innerJoin(ledgerAccountGroups, eq(ledgerAccountGroups.id, ledgerAccounts.groupId))
    .where(and(...conditions))
    .orderBy(asc(ledgerAccountGroups.sortOrder), asc(ledgerAccounts.sortOrder), asc(ledgerAccounts.name))
    .limit(limit(filters.limit))
}

async function loadLedgerTransaction(tx: DomainReadExecutor, scope: TrustedToolScope, ledgerTransactionId: string): Promise<LedgerTransactionSummary | null> {
  const [row] = await tx
    .select({
      id: ledgerTransactions.id,
      teamId: ledgerTransactions.teamId,
      source: ledgerTransactions.source,
      status: ledgerTransactions.status,
      categorizedBy: ledgerTransactions.categorizedBy,
      userConfirmedAt: ledgerTransactions.userConfirmedAt,
      userConfirmedBy: ledgerTransactions.userConfirmedBy,
      date: ledgerTransactions.date,
      description: ledgerTransactions.description,
    })
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.teamId, scope.teamId), eq(ledgerTransactions.id, ledgerTransactionId)))
    .limit(1)
  return row ?? null
}

async function loadPostings(tx: DomainReadExecutor, scope: TrustedToolScope, ledgerTransactionIds: string[]): Promise<PostingSummary[]> {
  const ids = [...new Set(ledgerTransactionIds)]
  if (ids.length === 0) return []

  return tx
    .select({
      id: ledgerPostings.id,
      ledgerTransactionId: ledgerPostings.ledgerTransactionId,
      accountId: ledgerPostings.accountId,
      accountName: ledgerAccounts.name,
      accountType: ledgerAccounts.type,
      linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
      amount: ledgerPostings.amount,
      currency: ledgerPostings.currency,
      bankTransactionId: ledgerPostings.bankTransactionId,
      sortOrder: ledgerPostings.sortOrder,
    })
    .from(ledgerPostings)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerPostings.ledgerTransactionId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerPostings.accountId))
    .where(and(eq(ledgerTransactions.teamId, scope.teamId), inArray(ledgerPostings.ledgerTransactionId, ids)))
    .orderBy(asc(ledgerPostings.sortOrder), asc(ledgerPostings.id))
}

async function loadInterpretationKinds(tx: DomainReadExecutor, ledgerTransactionIds: string[]) {
  const ids = [...new Set(ledgerTransactionIds)]
  if (ids.length === 0) return new Map<string, InterpretationKind>()

  const rows = await tx
    .select({
      ledgerTransactionId: ledgerPostings.ledgerTransactionId,
      bankTransactionId: ledgerPostings.bankTransactionId,
      linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
    })
    .from(ledgerPostings)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerPostings.accountId))
    .where(inArray(ledgerPostings.ledgerTransactionId, ids))

  const grouped = new Map<string, Array<{bankTransactionId: string | null; linkedBankAccountId: string | null}>>()
  for (const row of rows) {
    grouped.set(row.ledgerTransactionId, [...(grouped.get(row.ledgerTransactionId) ?? []), row])
  }
  return new Map([...grouped.entries()].map(([id, group]) => [id, deriveInterpretationKindFromRaw(group)]))
}

function deriveReviewStatus(ledgerTransactionId: string | null, ledgerStatus: string | null, aiConfidence: number | null): ReviewStatusFilter {
  if (ledgerStatus === 'confirmed') return 'confirmed'
  if (ledgerStatus === 'needs_review') return 'needs_review'
  if (!ledgerTransactionId && aiConfidence === 0) return 'ai_unable'
  return 'uncategorized'
}

function addReviewStatusCondition(conditions: SQL[], reviewStatus: ReviewStatusFilter | undefined) {
  if (!reviewStatus || reviewStatus === 'any') return
  if (reviewStatus === 'uncategorized') {
    conditions.push(and(isNull(ledgerTransactions.id), or(isNull(bankTransactions.aiConfidence), ne(bankTransactions.aiConfidence, 0)))!)
  } else if (reviewStatus === 'ai_unable') {
    conditions.push(and(isNull(ledgerTransactions.id), eq(bankTransactions.aiConfidence, 0))!)
  } else {
    conditions.push(eq(ledgerTransactions.status, reviewStatus))
  }
}

function addOptionalArrayCondition<T>(conditions: SQL[], column: AnyColumn, values: T[] | undefined) {
  if (!values) return
  if (values.length === 0) {
    conditions.push(drizzleSql`1 = 0`)
    return
  }
  conditions.push(inArray(column, values))
}

function addOptionalTextCondition(conditions: SQL[], column: Parameters<typeof ilike>[0], value: string | undefined) {
  const trimmed = value?.trim()
  if (trimmed) conditions.push(ilike(column, `%${trimmed}%`))
}

function limit(value: number | undefined) {
  return Math.min(Math.max(Math.trunc(value ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
}

function uniqueById<T extends {id: string}>(rows: T[]) {
  const byId = new Map<string, T>()
  for (const row of rows) byId.set(row.id, row)
  return [...byId.values()]
}

function groupPostingsByLedgerTransactionId(postings: PostingSummary[]) {
  const grouped = new Map<string, PostingSummary[]>()
  for (const posting of postings) grouped.set(posting.ledgerTransactionId, [...(grouped.get(posting.ledgerTransactionId) ?? []), posting])
  return grouped
}

function deriveInterpretationKind(postings: PostingSummary[]): InterpretationKind {
  return deriveInterpretationKindFromRaw(postings)
}

function deriveInterpretationKindFromRaw(postings: Array<{bankTransactionId: string | null; linkedBankAccountId: string | null}>): InterpretationKind {
  const bankPostings = postings.filter(posting => posting.bankTransactionId !== null)
  const categoryPostings = postings.filter(posting => posting.bankTransactionId === null)
  if (bankPostings.length === 0) return 'uncategorized'
  if (bankPostings.length === 2 && categoryPostings.length === 0 && bankPostings.every(posting => posting.linkedBankAccountId)) return 'transfer'
  if (bankPostings.length === 1 && categoryPostings.length === 1) return 'category'
  if (bankPostings.length === 1 && categoryPostings.length > 1) return 'split'
  return 'other'
}
