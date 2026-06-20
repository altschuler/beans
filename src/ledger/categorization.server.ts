import '@tanstack/react-start/server-only'

import {and, eq, inArray, isNotNull, isNull, lt, or} from 'drizzle-orm'
import type {DrizzleTransaction as ZeroDrizzleTransaction} from '@rocicorp/zero/server/adapters/drizzle'
import type {Database} from '@/db/client'
import {bankAccounts, bankTransactions, ledgerAccounts, ledgerPostings, ledgerTransactions, teamMembers} from '@/db/schema'
import {SYSTEM_LEDGER_ACCOUNT_KEYS} from './default-chart'
import {
  buildBankLinkedCategorizationPostings,
  isRealCategorizationAccount,
  formatScaledUnits,
  parseMoneyToScaledUnits,
  validateLedgerPostingsBalance,
  type CategorizationLineInput,
} from './categorization'

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DrizzleTransaction = DatabaseTransaction | ZeroDrizzleTransaction<Database>

type LedgerTransactionFinalStatus = 'confirmed' | 'needs_review'
type LedgerTransactionAiConfidence = 0 | 1 | 2
type LedgerTransactionCategorizedBy = 'user' | 'ai'

type CategorizeLedgerTransactionInput = {
  userId: string
  ledgerTransactionId: string
  status?: LedgerTransactionFinalStatus
  aiConfidence?: LedgerTransactionAiConfidence | null
  aiReasoning?: string | null
  categorizedBy?: LedgerTransactionCategorizedBy | null
  requiredCurrentStatus?: LedgerTransactionFinalStatus
} & ({accountId: string; lines?: never} | {accountId?: never; lines: CategorizationLineInput[]})

type ConfirmLedgerTransactionInput = {
  userId: string
  ledgerTransactionId: string
}

type ClearLedgerCategorizationsInput = {
  userId: string
}

type LoadedImportedLedgerTransaction = {
  ledgerTransaction: {id: string; teamId: string; source: string; status: string; aiProcessingStartedAt: Date | null}
  bankPosting: {id: string; ledgerTransactionId: string; accountId: string; amount: string; currency: string; bankTransactionId: string}
  bankTransaction: {id: string; bankAccountId: string; amount: string; currency: string}
}

type ReconciledPostingInvariantInput = LoadedImportedLedgerTransaction & {
  postingAccount: {teamId: string; linkedBankAccountId: string | null}
}

const AI_PROCESSING_STALE_AFTER_MS = 30 * 60 * 1000
const MAX_AI_REASONING_LENGTH = 500

export function normalizeAiReasoning(reasoning: string) {
  return reasoning.trim().slice(0, MAX_AI_REASONING_LENGTH)
}

export async function categorizeLedgerTransaction(tx: DrizzleTransaction, input: CategorizeLedgerTransactionInput) {
  const loaded = await loadSingleReconciledPostingForLedgerTransaction(tx, input.userId, input.ledgerTransactionId)
  const {ledgerTransaction, bankPosting} = loaded

  const lines: CategorizationLineInput[] =
    input.accountId !== undefined ? [{accountId: input.accountId, amount: absoluteMoneyString(bankPosting.amount)}] : input.lines
  await validateCategorizationAccounts(tx, ledgerTransaction.teamId, lines.map(line => line.accountId))

  const allPostings = buildBankLinkedCategorizationPostings({bankPosting, lines})
  const categoryPostings = allPostings.slice(1)

  const now = new Date()
  const isAiCategorization = input.categorizedBy === 'ai'
  const normalizedAiReasoning = isAiCategorization ? requireAiReasoning(input.aiReasoning) : null
  const nextTransactionValues = isAiCategorization
    ? {
        status: input.status ?? 'confirmed',
        aiConfidence: input.aiConfidence ?? null,
        aiReasoning: normalizedAiReasoning,
        aiProcessingStartedAt: null,
        categorizedBy: 'ai',
        userConfirmedAt: null,
        userConfirmedBy: null,
        updatedAt: now,
      }
    : {
        status: input.status ?? 'confirmed',
        aiConfidence: null,
        aiReasoning: null,
        aiProcessingStartedAt: null,
        categorizedBy: input.categorizedBy ?? 'user',
        userConfirmedAt: now,
        userConfirmedBy: input.userId,
        updatedAt: now,
      }

  if (input.requiredCurrentStatus) {
    const [updatedTransaction] = await tx
      .update(ledgerTransactions)
      .set(nextTransactionValues)
      .where(and(eq(ledgerTransactions.id, ledgerTransaction.id), eq(ledgerTransactions.status, input.requiredCurrentStatus)))
      .returning({id: ledgerTransactions.id})

    if (!updatedTransaction) return false
  }

  await tx
    .delete(ledgerPostings)
    .where(and(eq(ledgerPostings.ledgerTransactionId, ledgerTransaction.id), isNull(ledgerPostings.bankTransactionId)))
  await tx.insert(ledgerPostings).values(categoryPostings)
  await validatePersistedTransactionBalance(tx, ledgerTransaction.id)

  if (!input.requiredCurrentStatus) {
    await tx.update(ledgerTransactions).set(nextTransactionValues).where(eq(ledgerTransactions.id, ledgerTransaction.id))
  }
  return true
}

export async function clearLedgerCategorizations(tx: DrizzleTransaction, input: ClearLedgerCategorizationsInput) {
  const rows = await tx
    .select({
      ledgerTransactionId: ledgerTransactions.id,
      teamId: ledgerTransactions.teamId,
      bankPostingId: ledgerPostings.id,
      bankPostingAccountId: ledgerPostings.accountId,
      bankPostingAmount: ledgerPostings.amount,
      bankPostingCurrency: ledgerPostings.currency,
      bankPostingBankTransactionId: ledgerPostings.bankTransactionId,
    })
    .from(ledgerTransactions)
    .innerJoin(teamMembers, eq(teamMembers.teamId, ledgerTransactions.teamId))
    .innerJoin(ledgerPostings, and(eq(ledgerPostings.ledgerTransactionId, ledgerTransactions.id), isNotNull(ledgerPostings.bankTransactionId)))
    .innerJoin(bankTransactions, eq(bankTransactions.id, ledgerPostings.bankTransactionId))
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .where(and(eq(teamMembers.userId, input.userId), eq(ledgerTransactions.source, 'bank_import'), eq(bankAccounts.teamId, ledgerTransactions.teamId)))

  if (rows.length === 0) return {cleared: 0}

  const teamIds = [...new Set(rows.map(row => row.teamId))]
  const uncategorizedAccounts = await tx
    .select({id: ledgerAccounts.id, teamId: ledgerAccounts.teamId})
    .from(ledgerAccounts)
    .where(and(inArray(ledgerAccounts.teamId, teamIds), eq(ledgerAccounts.systemKey, SYSTEM_LEDGER_ACCOUNT_KEYS.uncategorized)))
  const uncategorizedByTeamId = new Map(uncategorizedAccounts.map(account => [account.teamId, account.id]))

  const now = new Date()
  const rowsByTransactionId = groupBy(rows, row => row.ledgerTransactionId)
  const transactionIds = [...rowsByTransactionId.keys()]
  const replacementPostings = [...rowsByTransactionId.entries()].flatMap(([ledgerTransactionId, transactionRows]) => {
    const firstRow = transactionRows[0]
    if (!firstRow) return []
    const uncategorizedAccountId = uncategorizedByTeamId.get(firstRow.teamId)
    if (!uncategorizedAccountId) throw new Error('Uncategorized ledger account not found')
    const totalsByCurrency = new Map<string, bigint>()
    for (const row of transactionRows) {
      totalsByCurrency.set(row.bankPostingCurrency, (totalsByCurrency.get(row.bankPostingCurrency) ?? 0n) + parseMoneyToScaledUnits(row.bankPostingAmount))
    }
    return [...totalsByCurrency.entries()].flatMap(([currency, bankPostingTotal], currencyIndex) => {
      const oppositeAmount = -bankPostingTotal
      if (oppositeAmount === 0n) return []
      return [
        {
          id: crypto.randomUUID(),
          ledgerTransactionId,
          accountId: uncategorizedAccountId,
          amount: formatScaledUnits(oppositeAmount),
          currency,
          bankTransactionId: null,
          sortOrder: transactionRows.length + currencyIndex,
          createdAt: now,
          updatedAt: now,
        },
      ]
    })
  })

  await tx.delete(ledgerPostings).where(and(inArray(ledgerPostings.ledgerTransactionId, transactionIds), isNull(ledgerPostings.bankTransactionId)))
  if (replacementPostings.length > 0) await tx.insert(ledgerPostings).values(replacementPostings)
  for (const transactionId of transactionIds) {
    await validatePersistedTransactionBalance(tx, transactionId)
  }
  await tx
    .update(ledgerTransactions)
    .set({
      status: 'needs_review',
      aiConfidence: null,
      aiReasoning: null,
      aiProcessingStartedAt: null,
      categorizedBy: null,
      userConfirmedAt: null,
      userConfirmedBy: null,
      updatedAt: now,
    })
    .where(inArray(ledgerTransactions.id, transactionIds))

  return {cleared: transactionIds.length}
}

export async function confirmLedgerTransaction(tx: DrizzleTransaction, input: ConfirmLedgerTransactionInput) {
  const loaded = await loadSingleReconciledPostingForLedgerTransaction(tx, input.userId, input.ledgerTransactionId)
  const {ledgerTransaction} = loaded

  if (ledgerTransaction.source !== 'bank_import') {
    throw new Error('Only bank-import ledger transactions can be confirmed')
  }

  if (isRecentlyProcessing(ledgerTransaction.aiProcessingStartedAt)) {
    throw new Error('Transaction is currently being categorized by AI')
  }

  await validateConfirmableCategoryPostings(tx, ledgerTransaction.teamId, ledgerTransaction.id)
  await validatePersistedTransactionBalance(tx, ledgerTransaction.id)

  const now = new Date()
  const [updatedTransaction] = await tx
    .update(ledgerTransactions)
    .set({status: 'confirmed', userConfirmedAt: now, userConfirmedBy: input.userId, aiProcessingStartedAt: null, updatedAt: now})
    .where(
      and(
        eq(ledgerTransactions.id, ledgerTransaction.id),
        or(isNull(ledgerTransactions.aiProcessingStartedAt), lt(ledgerTransactions.aiProcessingStartedAt, aiProcessingFreshCutoff())),
      ),
    )
    .returning({id: ledgerTransactions.id})

  if (!updatedTransaction) {
    throw new Error('Transaction is currently being categorized by AI')
  }
}

async function loadSingleReconciledPostingForLedgerTransaction(
  tx: DrizzleTransaction,
  userId: string,
  ledgerTransactionId: string,
): Promise<LoadedImportedLedgerTransaction> {
  const rows = await tx
    .select({
      ledgerTransaction: {
        id: ledgerTransactions.id,
        teamId: ledgerTransactions.teamId,
        source: ledgerTransactions.source,
        status: ledgerTransactions.status,
        aiProcessingStartedAt: ledgerTransactions.aiProcessingStartedAt,
      },
      bankPosting: {
        id: ledgerPostings.id,
        ledgerTransactionId: ledgerPostings.ledgerTransactionId,
        accountId: ledgerPostings.accountId,
        amount: ledgerPostings.amount,
        currency: ledgerPostings.currency,
        bankTransactionId: ledgerPostings.bankTransactionId,
      },
      bankTransaction: {
        id: bankTransactions.id,
        bankAccountId: bankTransactions.bankAccountId,
        amount: bankTransactions.amount,
        currency: bankTransactions.currency,
      },
      postingAccount: {
        teamId: ledgerAccounts.teamId,
        linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
      },
    })
    .from(ledgerTransactions)
    .innerJoin(teamMembers, eq(teamMembers.teamId, ledgerTransactions.teamId))
    .innerJoin(ledgerPostings, and(eq(ledgerPostings.ledgerTransactionId, ledgerTransactions.id), isNotNull(ledgerPostings.bankTransactionId)))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerPostings.accountId))
    .innerJoin(bankTransactions, eq(bankTransactions.id, ledgerPostings.bankTransactionId))
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .where(and(eq(ledgerTransactions.id, ledgerTransactionId), eq(teamMembers.userId, userId), eq(bankAccounts.teamId, ledgerTransactions.teamId)))

  if (rows.length === 0) {
    const [authorizedTransaction] = await tx
      .select({id: ledgerTransactions.id})
      .from(ledgerTransactions)
      .innerJoin(teamMembers, eq(teamMembers.teamId, ledgerTransactions.teamId))
      .where(and(eq(ledgerTransactions.id, ledgerTransactionId), eq(teamMembers.userId, userId)))
      .limit(1)
    if (!authorizedTransaction) throw new Error('Ledger transaction not found')
    throw new Error('Only bank-import ledger transactions can be categorized')
  }

  if (rows.length > 1) {
    throw new Error('Expected exactly one reconciled posting for this ledger transaction')
  }

  const [row] = rows
  const bankTransactionId = row.bankPosting.bankTransactionId
  if (!bankTransactionId) throw new Error('Linked bank transaction not found')

  const loaded = {
    ledgerTransaction: row.ledgerTransaction,
    bankPosting: {...row.bankPosting, bankTransactionId},
    bankTransaction: row.bankTransaction,
    postingAccount: row.postingAccount,
  }
  validateReconciledPostingInvariant(loaded)

  return {
    ledgerTransaction: loaded.ledgerTransaction,
    bankPosting: loaded.bankPosting,
    bankTransaction: loaded.bankTransaction,
  }
}

function validateReconciledPostingInvariant(input: ReconciledPostingInvariantInput) {
  if (input.ledgerTransaction.source !== 'bank_import') {
    throw new Error('Only bank-import ledger transactions can be categorized')
  }

  if (input.postingAccount.teamId !== input.ledgerTransaction.teamId) {
    throw new Error('Reconciled posting account must belong to the transaction team')
  }

  if (input.postingAccount.linkedBankAccountId !== input.bankTransaction.bankAccountId) {
    throw new Error('Reconciled posting account must match the bank transaction account')
  }

  if (parseMoneyToScaledUnits(input.bankPosting.amount) !== parseMoneyToScaledUnits(input.bankTransaction.amount)) {
    throw new Error('Reconciled posting amount must match the bank transaction amount')
  }

  if (input.bankPosting.currency !== input.bankTransaction.currency) {
    throw new Error('Reconciled posting currency must match the bank transaction currency')
  }
}

async function validateCategorizationAccounts(tx: DrizzleTransaction, teamId: string, lineAccountIds: string[]) {
  const accountIds = [...new Set(lineAccountIds)]
  const accounts = accountIds.length
    ? await tx
        .select({
          id: ledgerAccounts.id,
          teamId: ledgerAccounts.teamId,
          type: ledgerAccounts.type,
          status: ledgerAccounts.status,
          systemKey: ledgerAccounts.systemKey,
          linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
        })
        .from(ledgerAccounts)
        .where(inArray(ledgerAccounts.id, accountIds))
    : []

  const accountsById = new Map(accounts.map(account => [account.id, account]))
  for (const accountId of accountIds) {
    const account = accountsById.get(accountId)
    if (!account || account.teamId !== teamId || !isRealCategorizationAccount(account)) {
      throw new Error('Invalid categorization account')
    }
  }
}

async function validateConfirmableCategoryPostings(tx: DrizzleTransaction, teamId: string, ledgerTransactionId: string) {
  const categoryPostings = await tx
    .select({
      accountId: ledgerPostings.accountId,
      teamId: ledgerAccounts.teamId,
      type: ledgerAccounts.type,
      status: ledgerAccounts.status,
      systemKey: ledgerAccounts.systemKey,
      linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
    })
    .from(ledgerPostings)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerPostings.accountId))
    .where(and(eq(ledgerPostings.ledgerTransactionId, ledgerTransactionId), isNull(ledgerPostings.bankTransactionId)))

  if (categoryPostings.length === 0) {
    throw new Error('Transaction must have a category before it can be confirmed')
  }

  const hasUncategorized = categoryPostings.some(posting => posting.systemKey === SYSTEM_LEDGER_ACCOUNT_KEYS.uncategorized)
  if (hasUncategorized) {
    throw new Error('Uncategorized transactions cannot be confirmed')
  }

  const hasInvalidCategory = categoryPostings.some(posting => posting.teamId !== teamId || !isRealCategorizationAccount(posting))
  if (hasInvalidCategory) {
    throw new Error('Transaction must have a real category before it can be confirmed')
  }
}

async function validatePersistedTransactionBalance(tx: DrizzleTransaction, ledgerTransactionId: string) {
  const postings = await tx
    .select({amount: ledgerPostings.amount, currency: ledgerPostings.currency})
    .from(ledgerPostings)
    .where(eq(ledgerPostings.ledgerTransactionId, ledgerTransactionId))
  validateLedgerPostingsBalance(postings)
}

function requireAiReasoning(reasoning: string | null | undefined) {
  const normalizedReasoning = normalizeAiReasoning(reasoning ?? '')
  if (!normalizedReasoning) {
    throw new Error('AI reasoning is required')
  }
  return normalizedReasoning
}

function absoluteMoneyString(amount: string) {
  return amount.trim().replace(/^[+-]/, '')
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const groupKey = key(item)
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), item])
  }
  return groups
}

function isRecentlyProcessing(value: Date | string | number | null) {
  if (!value) return false
  const startedAt = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(startedAt.getTime())) return false
  return startedAt >= aiProcessingFreshCutoff()
}

function aiProcessingFreshCutoff(now = new Date()) {
  return new Date(now.getTime() - AI_PROCESSING_STALE_AFTER_MS)
}
