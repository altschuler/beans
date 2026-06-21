import '@tanstack/react-start/server-only'

import {and, eq, inArray, isNotNull, isNull} from 'drizzle-orm'
import type {DrizzleTransaction as ZeroDrizzleTransaction} from '@rocicorp/zero/server/adapters/drizzle'
import type {Database} from '@/db/client'
import {bankAccounts, bankTransactions, ledgerAccounts, ledgerPostings, ledgerTransactions, teamMembers} from '@/db/schema'
import {SYSTEM_LEDGER_ACCOUNT_KEYS} from './default-chart'
import {
  buildBankLinkedCategorizationPostings,
  buildBankTransactionCategorizationPostings,
  buildBankTransactionTransferPostings,
  isRealCategorizationAccount,
  formatScaledUnits,
  parseMoneyToScaledUnits,
  validateLedgerPostingsBalance,
  type BuiltLedgerPosting,
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

type CategorizeBankTransactionInput = {
  userId: string
  bankTransactionId: string
  selection: {kind: 'category'; accountId: string} | {kind: 'transfer'; accountId: string}
  status?: LedgerTransactionFinalStatus
  aiConfidence?: LedgerTransactionAiConfidence | null
  aiReasoning?: string | null
  categorizedBy?: LedgerTransactionCategorizedBy | null
}

type SplitBankTransactionInput = {
  userId: string
  bankTransactionId: string
  lines: CategorizationLineInput[]
}

type ConfirmLedgerTransactionInput = {
  userId: string
  ledgerTransactionId: string
}

type ClearLedgerCategorizationsInput = {
  userId: string
}

type LoadedImportedLedgerTransaction = {
  ledgerTransaction: {id: string; teamId: string; source: string; status: string}
  bankPosting: {id: string; ledgerTransactionId: string; accountId: string; amount: string; currency: string; bankTransactionId: string}
  bankTransaction: {id: string; bankAccountId: string; amount: string; currency: string; aiProcessingStartedAt: Date | null}
}

type LoadedBankTransactionForCategorization = {
  teamId: string
  bankTransaction: {
    id: string
    bankAccountId: string
    amount: string
    currency: string
    bookingDate: string | null
    valueDate: string | null
    description: string
    aiProcessingStartedAt: Date | null
  }
  sourceLedgerAccount: {id: string; linkedBankAccountId: string | null; teamId: string}
}

type TransferLedgerAccount = {id: string; teamId: string; type: string; status: string; linkedBankAccountId: string | null}

type ReconciledPostingInvariantInput = LoadedImportedLedgerTransaction & {
  postingAccount: {teamId: string; linkedBankAccountId: string | null}
}

const AI_PROCESSING_STALE_AFTER_MS = 30 * 60 * 1000
const MAX_AI_REASONING_LENGTH = 500
const TRANSFER_MATCH_DATE_WINDOW_DAYS = 2

export function normalizeAiReasoning(reasoning: string) {
  return reasoning.trim().slice(0, MAX_AI_REASONING_LENGTH)
}


export async function categorizeBankTransaction(tx: DrizzleTransaction, input: CategorizeBankTransactionInput) {
  const loaded = await loadBankTransactionForCategorization(tx, input.userId, input.bankTransactionId)
  const isAiCategorization = input.categorizedBy === 'ai'
  const normalizedAiReasoning = isAiCategorization ? requireAiReasoning(input.aiReasoning) : null
  if (!isAiCategorization && isRecentlyProcessing(loaded.bankTransaction.aiProcessingStartedAt)) {
    throw new Error('Bank transaction is already being categorized')
  }

  if (input.selection.kind === 'transfer') {
    const transferAccount = await loadTransferLedgerAccount(tx, loaded.teamId, input.selection.accountId)
    if (transferAccount.linkedBankAccountId === loaded.bankTransaction.bankAccountId) {
      throw new Error('Cannot transfer to the same bank account')
    }

    await deleteExistingInterpretationForBankTransaction(tx, loaded.teamId, loaded.bankTransaction.id)

    const counterBankTransaction = await findExactCounterBankTransaction({
      tx,
      teamId: loaded.teamId,
      sourceBankTransactionId: loaded.bankTransaction.id,
      targetBankAccountId: transferAccount.linkedBankAccountId!,
      sourceAmount: loaded.bankTransaction.amount,
      currency: loaded.bankTransaction.currency,
      sourceDate: loaded.bankTransaction.bookingDate ?? loaded.bankTransaction.valueDate,
    })
    if (!counterBankTransaction) {
      throw new Error('No matching transfer was found')
    }

    const now = new Date()
    const ledgerTransactionId = crypto.randomUUID()
    const postings = buildBankTransactionTransferPostings({
      ledgerTransactionId,
      source: {
        bankTransactionId: loaded.bankTransaction.id,
        bankLedgerAccountId: loaded.sourceLedgerAccount.id,
        amount: loaded.bankTransaction.amount,
        currency: loaded.bankTransaction.currency,
      },
      targetLedgerAccountId: transferAccount.id,
      counterBankTransactionId: counterBankTransaction.id,
      now,
    })

    await insertBankImportLedgerInterpretation(tx, {
      ledgerTransactionId,
      teamId: loaded.teamId,
      userId: input.userId,
      date: loaded.bankTransaction.bookingDate ?? loaded.bankTransaction.valueDate,
      description: loaded.bankTransaction.description,
      postings,
      now,
    })
    await clearBankTransactionAiState(tx, loaded.bankTransaction.id, now)
    return true
  }

  await validateCategorizationAccounts(tx, loaded.teamId, [input.selection.accountId])
  await deleteExistingInterpretationForBankTransaction(tx, loaded.teamId, loaded.bankTransaction.id)

  const now = new Date()
  const ledgerTransactionId = crypto.randomUUID()
  const postings = buildBankTransactionCategorizationPostings({
    ledgerTransactionId,
    source: {
      bankTransactionId: loaded.bankTransaction.id,
      bankLedgerAccountId: loaded.sourceLedgerAccount.id,
      amount: loaded.bankTransaction.amount,
      currency: loaded.bankTransaction.currency,
    },
    lines: [{accountId: input.selection.accountId, amount: absoluteMoneyString(loaded.bankTransaction.amount)}],
    now,
  })

  await insertBankImportLedgerInterpretation(tx, {
    ledgerTransactionId,
    teamId: loaded.teamId,
    userId: input.userId,
    date: loaded.bankTransaction.bookingDate ?? loaded.bankTransaction.valueDate,
    description: loaded.bankTransaction.description,
    postings,
    status: input.status ?? 'confirmed',
    categorizedBy: input.categorizedBy ?? 'user',
    now,
  })
  if (isAiCategorization) {
    await recordBankTransactionAiResult(tx, loaded.bankTransaction.id, input.aiConfidence ?? null, normalizedAiReasoning, now)
  } else {
    await clearBankTransactionAiState(tx, loaded.bankTransaction.id, now)
  }
  return true
}

export async function splitBankTransaction(tx: DrizzleTransaction, input: SplitBankTransactionInput) {
  const loaded = await loadBankTransactionForCategorization(tx, input.userId, input.bankTransactionId)
  if (isRecentlyProcessing(loaded.bankTransaction.aiProcessingStartedAt)) {
    throw new Error('Bank transaction is already being categorized')
  }
  await validateCategorizationAccounts(tx, loaded.teamId, input.lines.map(line => line.accountId))
  await deleteExistingInterpretationForBankTransaction(tx, loaded.teamId, loaded.bankTransaction.id)

  const now = new Date()
  const ledgerTransactionId = crypto.randomUUID()
  const postings = buildBankTransactionCategorizationPostings({
    ledgerTransactionId,
    source: {
      bankTransactionId: loaded.bankTransaction.id,
      bankLedgerAccountId: loaded.sourceLedgerAccount.id,
      amount: loaded.bankTransaction.amount,
      currency: loaded.bankTransaction.currency,
    },
    lines: input.lines,
    now,
  })

  await insertBankImportLedgerInterpretation(tx, {
    ledgerTransactionId,
    teamId: loaded.teamId,
    userId: input.userId,
    date: loaded.bankTransaction.bookingDate ?? loaded.bankTransaction.valueDate,
    description: loaded.bankTransaction.description,
    postings,
    now,
  })
  await clearBankTransactionAiState(tx, loaded.bankTransaction.id, now)
  return true
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
        categorizedBy: 'ai',
        userConfirmedAt: null,
        userConfirmedBy: null,
        updatedAt: now,
      }
    : {
        status: input.status ?? 'confirmed',
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

  if (isAiCategorization) {
    await recordBankTransactionAiResult(tx, bankPosting.bankTransactionId, input.aiConfidence ?? null, normalizedAiReasoning, now)
  } else {
    await clearBankTransactionAiState(tx, bankPosting.bankTransactionId, now)
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

  const transactionIds = [...new Set(rows.map(row => row.ledgerTransactionId))]
  await tx.delete(ledgerTransactions).where(inArray(ledgerTransactions.id, transactionIds))

  return {cleared: transactionIds.length}
}

export async function confirmLedgerTransaction(tx: DrizzleTransaction, input: ConfirmLedgerTransactionInput) {
  const loaded = await loadSingleReconciledPostingForLedgerTransaction(tx, input.userId, input.ledgerTransactionId)
  const {ledgerTransaction} = loaded

  if (ledgerTransaction.source !== 'bank_import') {
    throw new Error('Only bank-import ledger transactions can be confirmed')
  }

  if (isRecentlyProcessing(loaded.bankTransaction.aiProcessingStartedAt)) {
    throw new Error('Transaction is currently being categorized by AI')
  }

  await validateConfirmableCategoryPostings(tx, ledgerTransaction.teamId, ledgerTransaction.id)
  await validatePersistedTransactionBalance(tx, ledgerTransaction.id)

  const now = new Date()
  const [updatedTransaction] = await tx
    .update(ledgerTransactions)
    .set({status: 'confirmed', userConfirmedAt: now, userConfirmedBy: input.userId, updatedAt: now})
    .where(eq(ledgerTransactions.id, ledgerTransaction.id))
    .returning({id: ledgerTransactions.id})

  if (!updatedTransaction) {
    throw new Error('Transaction is currently being categorized by AI')
  }
}


async function loadBankTransactionForCategorization(
  tx: DrizzleTransaction,
  userId: string,
  bankTransactionId: string,
): Promise<LoadedBankTransactionForCategorization> {
  const [row] = await tx
    .select({
      teamId: bankAccounts.teamId,
      bankTransaction: {
        id: bankTransactions.id,
        bankAccountId: bankTransactions.bankAccountId,
        amount: bankTransactions.amount,
        currency: bankTransactions.currency,
        bookingDate: bankTransactions.bookingDate,
        valueDate: bankTransactions.valueDate,
        description: bankTransactions.description,
        aiProcessingStartedAt: bankTransactions.aiProcessingStartedAt,
      },
      sourceLedgerAccount: {
        id: ledgerAccounts.id,
        linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
        teamId: ledgerAccounts.teamId,
      },
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .innerJoin(teamMembers, eq(teamMembers.teamId, bankAccounts.teamId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.linkedBankAccountId, bankAccounts.id))
    .where(and(eq(bankTransactions.id, bankTransactionId), eq(teamMembers.userId, userId)))
    .limit(1)

  if (!row) throw new Error('Bank transaction not found')
  if (row.sourceLedgerAccount.teamId !== row.teamId || row.sourceLedgerAccount.linkedBankAccountId !== row.bankTransaction.bankAccountId) {
    throw new Error('Reconciled posting account must match the bank transaction account')
  }
  return row
}

async function deleteExistingInterpretationForBankTransaction(tx: DrizzleTransaction, teamId: string, bankTransactionId: string) {
  const [existing] = await tx
    .select({
      ledgerTransaction: {
        id: ledgerTransactions.id,
        teamId: ledgerTransactions.teamId,
        source: ledgerTransactions.source,
        status: ledgerTransactions.status,
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
        aiProcessingStartedAt: bankTransactions.aiProcessingStartedAt,
      },
      postingAccount: {
        teamId: ledgerAccounts.teamId,
        linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
      },
    })
    .from(ledgerPostings)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerPostings.ledgerTransactionId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerPostings.accountId))
    .innerJoin(bankTransactions, eq(bankTransactions.id, ledgerPostings.bankTransactionId))
    .where(eq(ledgerPostings.bankTransactionId, bankTransactionId))
    .limit(1)

  if (!existing) return false
  if (existing.ledgerTransaction.teamId !== teamId) {
    throw new Error('Reconciled posting account must belong to the transaction team')
  }
  const existingBankTransactionId = existing.bankPosting.bankTransactionId
  if (!existingBankTransactionId) throw new Error('Linked bank transaction not found')
  validateReconciledPostingInvariant({
    ledgerTransaction: existing.ledgerTransaction,
    bankPosting: {...existing.bankPosting, bankTransactionId: existingBankTransactionId},
    bankTransaction: existing.bankTransaction,
    postingAccount: existing.postingAccount,
  })

  await tx.delete(ledgerTransactions).where(eq(ledgerTransactions.id, existing.ledgerTransaction.id))
  return true
}

async function loadTransferLedgerAccount(tx: DrizzleTransaction, teamId: string, accountId: string): Promise<TransferLedgerAccount> {
  const [account] = await tx
    .select({id: ledgerAccounts.id, teamId: ledgerAccounts.teamId, type: ledgerAccounts.type, status: ledgerAccounts.status, linkedBankAccountId: ledgerAccounts.linkedBankAccountId})
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.id, accountId))
    .limit(1)

  if (!account || account.teamId !== teamId || account.type !== 'bank' || account.status !== 'active' || !account.linkedBankAccountId) {
    throw new Error('Invalid transfer account')
  }
  return account
}

async function findExactCounterBankTransaction(input: {
  tx: DrizzleTransaction
  teamId: string
  sourceBankTransactionId: string
  targetBankAccountId: string
  sourceAmount: string
  currency: string
  sourceDate: string | null
}) {
  const expectedAmount = formatScaledUnits(-parseMoneyToScaledUnits(input.sourceAmount))
  const rows = await input.tx
    .select({id: bankTransactions.id, bookingDate: bankTransactions.bookingDate, valueDate: bankTransactions.valueDate})
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .leftJoin(ledgerPostings, eq(ledgerPostings.bankTransactionId, bankTransactions.id))
    .where(
      and(
        eq(bankAccounts.teamId, input.teamId),
        eq(bankTransactions.bankAccountId, input.targetBankAccountId),
        eq(bankTransactions.amount, expectedAmount),
        eq(bankTransactions.currency, input.currency),
        isNull(ledgerPostings.id),
      ),
    )

  return rows
    .filter(row => row.id !== input.sourceBankTransactionId && isWithinTransferMatchDateWindow(input.sourceDate, row.bookingDate ?? row.valueDate))
    .sort((left, right) => compareTransferCandidateDate(input.sourceDate, left.bookingDate ?? left.valueDate, right.bookingDate ?? right.valueDate) || left.id.localeCompare(right.id))[0] ?? null
}

function isWithinTransferMatchDateWindow(sourceDate: string | null, candidateDate: string | null) {
  const dayDistance = calculateDateDistanceInDays(sourceDate, candidateDate)
  return dayDistance !== null && dayDistance <= TRANSFER_MATCH_DATE_WINDOW_DAYS
}

function compareTransferCandidateDate(sourceDate: string | null, leftDate: string | null, rightDate: string | null) {
  const leftDistance = calculateDateDistanceInDays(sourceDate, leftDate)
  const rightDistance = calculateDateDistanceInDays(sourceDate, rightDate)
  if (leftDistance !== null && rightDistance !== null && leftDistance !== rightDistance) return leftDistance - rightDistance
  return compareNullableDate(leftDate, rightDate)
}

function calculateDateDistanceInDays(left: string | null, right: string | null) {
  const leftTime = parseDateOnlyTime(left)
  const rightTime = parseDateOnlyTime(right)
  if (leftTime === null || rightTime === null) return null
  return Math.abs((leftTime - rightTime) / (24 * 60 * 60 * 1000))
}

function parseDateOnlyTime(value: string | null) {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day] = match
  return Date.UTC(Number(year), Number(month) - 1, Number(day))
}

function compareNullableDate(left: string | null, right: string | null) {
  if (left && right) return left.localeCompare(right)
  if (left) return -1
  if (right) return 1
  return 0
}

async function insertBankImportLedgerInterpretation(
  tx: DrizzleTransaction,
  input: {
    ledgerTransactionId: string
    teamId: string
    userId: string
    date: string | null
    description: string
    postings: BuiltLedgerPosting[]
    status?: LedgerTransactionFinalStatus
    categorizedBy?: LedgerTransactionCategorizedBy
    now: Date
  },
) {
  await tx.insert(ledgerTransactions).values({
    id: input.ledgerTransactionId,
    teamId: input.teamId,
    source: 'bank_import',
    status: input.status ?? 'confirmed',
    categorizedBy: input.categorizedBy ?? 'user',
    userConfirmedAt: input.categorizedBy === 'ai' ? null : input.now,
    userConfirmedBy: input.categorizedBy === 'ai' ? null : input.userId,
    date: input.date,
    description: input.description,
    createdAt: input.now,
    updatedAt: input.now,
  })
  await tx.insert(ledgerPostings).values(input.postings)
  await validatePersistedTransactionBalance(tx, input.ledgerTransactionId)
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
        aiProcessingStartedAt: bankTransactions.aiProcessingStartedAt,
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

async function recordBankTransactionAiResult(
  tx: DrizzleTransaction,
  bankTransactionId: string,
  aiConfidence: LedgerTransactionAiConfidence | null,
  aiReasoning: string | null,
  now: Date,
) {
  await tx
    .update(bankTransactions)
    .set({aiConfidence, aiReasoning, aiProcessingStartedAt: null, updatedAt: now})
    .where(eq(bankTransactions.id, bankTransactionId))
}

async function clearBankTransactionAiState(tx: DrizzleTransaction, bankTransactionId: string, now: Date) {
  await tx
    .update(bankTransactions)
    .set({aiConfidence: null, aiReasoning: null, aiProcessingStartedAt: null, updatedAt: now})
    .where(eq(bankTransactions.id, bankTransactionId))
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
