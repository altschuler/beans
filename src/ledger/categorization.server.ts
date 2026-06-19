import '@tanstack/react-start/server-only'

import {and, eq, inArray, isNull, lt, or} from 'drizzle-orm'
import type {DrizzleTransaction as ZeroDrizzleTransaction} from '@rocicorp/zero/server/adapters/drizzle'
import type {Database} from '@/db/client'
import {
  bankAccounts,
  bankTransactions,
  ledgerAccounts,
  ledgerTransactionMovements,
  ledgerTransactions,
  teamMembers,
} from '@/db/schema'
import {SYSTEM_LEDGER_ACCOUNT_KEYS} from './default-chart'
import {buildBankLinkedCategorizationMovements, isCategorizationAccount, type CategorizationLineInput} from './categorization'

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

const AI_PROCESSING_STALE_AFTER_MS = 30 * 60 * 1000
const MAX_AI_REASONING_LENGTH = 500

export function normalizeAiReasoning(reasoning: string) {
  return reasoning.trim().slice(0, MAX_AI_REASONING_LENGTH)
}

export async function categorizeLedgerTransaction(tx: DrizzleTransaction, input: CategorizeLedgerTransactionInput) {
  const [ledgerTransaction] = await tx
    .select({
      id: ledgerTransactions.id,
      teamId: ledgerTransactions.teamId,
      bankTransactionId: ledgerTransactions.bankTransactionId,
    })
    .from(ledgerTransactions)
    .innerJoin(teamMembers, eq(teamMembers.teamId, ledgerTransactions.teamId))
    .where(and(eq(ledgerTransactions.id, input.ledgerTransactionId), eq(teamMembers.userId, input.userId)))
    .limit(1)

  if (!ledgerTransaction) {
    throw new Error('Ledger transaction not found')
  }

  if (!ledgerTransaction.bankTransactionId) {
    throw new Error('Only bank-import ledger transactions can be categorized')
  }

  const [bankTransaction] = await tx
    .select({
      id: bankTransactions.id,
      bankAccountId: bankTransactions.bankAccountId,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .where(and(eq(bankTransactions.id, ledgerTransaction.bankTransactionId), eq(bankAccounts.teamId, ledgerTransaction.teamId)))
    .limit(1)

  if (!bankTransaction) {
    throw new Error('Linked bank transaction not found')
  }

  const [bankLedgerAccount] = await tx
    .select({id: ledgerAccounts.id})
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.teamId, ledgerTransaction.teamId), eq(ledgerAccounts.linkedBankAccountId, bankTransaction.bankAccountId)))
    .limit(1)

  if (!bankLedgerAccount) {
    throw new Error('Linked bank ledger account not found')
  }

  const lines: CategorizationLineInput[] =
    input.accountId !== undefined ? [{accountId: input.accountId, amount: absoluteMoneyString(bankTransaction.amount)}] : input.lines
  const accountIds = [...new Set(lines.map(line => line.accountId))]
  const accounts = accountIds.length
    ? await tx
        .select({id: ledgerAccounts.id, teamId: ledgerAccounts.teamId, type: ledgerAccounts.type, status: ledgerAccounts.status})
        .from(ledgerAccounts)
        .where(inArray(ledgerAccounts.id, accountIds))
    : []

  const accountsById = new Map(accounts.map(account => [account.id, account]))
  for (const accountId of accountIds) {
    const account = accountsById.get(accountId)
    if (!account || account.teamId !== ledgerTransaction.teamId || !isCategorizationAccount(account)) {
      throw new Error('Invalid categorization account')
    }
  }

  const movements = buildBankLinkedCategorizationMovements({
    ledgerTransactionId: ledgerTransaction.id,
    bankLedgerAccountId: bankLedgerAccount.id,
    bankAmount: bankTransaction.amount,
    currency: bankTransaction.currency,
    lines,
  })

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

    await tx.delete(ledgerTransactionMovements).where(eq(ledgerTransactionMovements.ledgerTransactionId, ledgerTransaction.id))
    await tx.insert(ledgerTransactionMovements).values(movements)
    return true
  }

  await tx.delete(ledgerTransactionMovements).where(eq(ledgerTransactionMovements.ledgerTransactionId, ledgerTransaction.id))
  await tx.insert(ledgerTransactionMovements).values(movements)
  await tx.update(ledgerTransactions).set(nextTransactionValues).where(eq(ledgerTransactions.id, ledgerTransaction.id))
  return true
}

export async function confirmLedgerTransaction(tx: DrizzleTransaction, input: ConfirmLedgerTransactionInput) {
  const [ledgerTransaction] = await tx
    .select({
      id: ledgerTransactions.id,
      teamId: ledgerTransactions.teamId,
      source: ledgerTransactions.source,
      bankTransactionId: ledgerTransactions.bankTransactionId,
      aiProcessingStartedAt: ledgerTransactions.aiProcessingStartedAt,
    })
    .from(ledgerTransactions)
    .innerJoin(teamMembers, eq(teamMembers.teamId, ledgerTransactions.teamId))
    .where(and(eq(ledgerTransactions.id, input.ledgerTransactionId), eq(teamMembers.userId, input.userId)))
    .limit(1)

  if (!ledgerTransaction) {
    throw new Error('Ledger transaction not found')
  }

  if (ledgerTransaction.source !== 'bank_import' || !ledgerTransaction.bankTransactionId) {
    throw new Error('Only bank-import ledger transactions can be confirmed')
  }

  if (isRecentlyProcessing(ledgerTransaction.aiProcessingStartedAt)) {
    throw new Error('Transaction is currently being categorized by AI')
  }

  const [bankTransaction] = await tx
    .select({bankAccountId: bankTransactions.bankAccountId})
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .where(and(eq(bankTransactions.id, ledgerTransaction.bankTransactionId), eq(bankAccounts.teamId, ledgerTransaction.teamId)))
    .limit(1)

  if (!bankTransaction) {
    throw new Error('Linked bank transaction not found')
  }

  const movements = await tx
    .select({debitAccountId: ledgerTransactionMovements.debitAccountId, creditAccountId: ledgerTransactionMovements.creditAccountId})
    .from(ledgerTransactionMovements)
    .where(eq(ledgerTransactionMovements.ledgerTransactionId, ledgerTransaction.id))

  const movementAccountIds = [...new Set(movements.flatMap(movement => [movement.debitAccountId, movement.creditAccountId]))]
  const movementAccounts = movementAccountIds.length
    ? await tx
        .select({
          id: ledgerAccounts.id,
          teamId: ledgerAccounts.teamId,
          linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
          systemKey: ledgerAccounts.systemKey,
          type: ledgerAccounts.type,
          status: ledgerAccounts.status,
        })
        .from(ledgerAccounts)
        .where(inArray(ledgerAccounts.id, movementAccountIds))
    : []

  const accountsById = new Map(movementAccounts.map(account => [account.id, account]))
  const categoryAccounts = movementAccountIds
    .map(accountId => accountsById.get(accountId))
    .filter(account => account && account.linkedBankAccountId !== bankTransaction.bankAccountId)

  if (categoryAccounts.length === 0) {
    throw new Error('Transaction must have a category before it can be confirmed')
  }

  const hasInvalidCategory = categoryAccounts.some(
    account =>
      !account ||
      account.teamId !== ledgerTransaction.teamId ||
      account.status !== 'active' ||
      account.type === 'bank' ||
      account.linkedBankAccountId !== null ||
      account.systemKey !== null,
  )

  if (hasInvalidCategory) {
    if (categoryAccounts.some(account => account?.systemKey === SYSTEM_LEDGER_ACCOUNT_KEYS.uncategorized)) {
      throw new Error('Uncategorized transactions cannot be confirmed')
    }
    throw new Error('Transaction must have a real category before it can be confirmed')
  }

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

function isRecentlyProcessing(value: Date | string | number | null) {
  if (!value) return false
  const startedAt = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(startedAt.getTime())) return false
  return startedAt >= aiProcessingFreshCutoff()
}

function aiProcessingFreshCutoff(now = new Date()) {
  return new Date(now.getTime() - AI_PROCESSING_STALE_AFTER_MS)
}
