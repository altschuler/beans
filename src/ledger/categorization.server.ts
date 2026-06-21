import '@tanstack/react-start/server-only'

import {and, eq, inArray, isNotNull, isNull} from 'drizzle-orm'
import type {DrizzleTransaction as ZeroDrizzleTransaction} from '@rocicorp/zero/server/adapters/drizzle'
import type {Database} from '@/db/client'
import {bankAccounts, bankTransactions, ledgerAccounts, ledgerPostings, ledgerTransactions, teamMembers} from '@/db/schema'
import {SYSTEM_LEDGER_ACCOUNT_KEYS} from './default-chart'
import {
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

type BankTransactionInterpretation =
  | {kind: 'category'; accountId: string}
  | {kind: 'split'; lines: CategorizationLineInput[]}
  | {kind: 'transfer'; accountId: string}

type ApplyBankTransactionInterpretationInput = {
  userId: string
  bankTransactionId: string
  interpretation: BankTransactionInterpretation
  status?: LedgerTransactionFinalStatus
  aiConfidence?: LedgerTransactionAiConfidence | null
  aiReasoning?: string | null
  categorizedBy?: LedgerTransactionCategorizedBy | null
  requiredExistingStatus?: LedgerTransactionFinalStatus
}

type CategorizeBankTransactionInput = {
  userId: string
  bankTransactionId: string
  selection: {kind: 'category'; accountId: string} | {kind: 'transfer'; accountId: string}
  status?: LedgerTransactionFinalStatus
  aiConfidence?: LedgerTransactionAiConfidence | null
  aiReasoning?: string | null
  categorizedBy?: LedgerTransactionCategorizedBy | null
  requiredExistingStatus?: LedgerTransactionFinalStatus
}

type SplitBankTransactionInput = {
  userId: string
  bankTransactionId: string
  lines: CategorizationLineInput[]
}

type ConfirmBankTransactionInterpretationInput = {
  userId: string
  bankTransactionId: string
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
  return applyBankTransactionInterpretation(tx, {
    userId: input.userId,
    bankTransactionId: input.bankTransactionId,
    interpretation: input.selection,
    status: input.status,
    aiConfidence: input.aiConfidence,
    aiReasoning: input.aiReasoning,
    categorizedBy: input.categorizedBy,
    requiredExistingStatus: input.requiredExistingStatus,
  })
}

export async function splitBankTransaction(tx: DrizzleTransaction, input: SplitBankTransactionInput) {
  return applyBankTransactionInterpretation(tx, {
    userId: input.userId,
    bankTransactionId: input.bankTransactionId,
    interpretation: {kind: 'split', lines: input.lines},
  })
}

async function applyBankTransactionInterpretation(tx: DrizzleTransaction, input: ApplyBankTransactionInterpretationInput) {
  const loaded = await loadBankTransactionForCategorization(tx, input.userId, input.bankTransactionId)
  const existing = await loadExistingInterpretationForBankTransaction(tx, loaded.teamId, loaded.bankTransaction.id)

  if (input.requiredExistingStatus && existing && existing.ledgerTransaction.status !== input.requiredExistingStatus) {
    return false
  }

  const isAiCategorization = input.categorizedBy === 'ai'
  if (isAiCategorization && input.interpretation.kind === 'transfer') {
    throw new Error('AI categorization cannot create transfers')
  }
  const normalizedAiReasoning = isAiCategorization ? requireAiReasoning(input.aiReasoning) : null
  if (!isAiCategorization && isRecentlyProcessing(loaded.bankTransaction.aiProcessingStartedAt)) {
    throw new Error('Bank transaction is already being categorized')
  }

  const now = new Date()
  const ledgerTransactionId = crypto.randomUUID()
  const commonInsert = {
    ledgerTransactionId,
    teamId: loaded.teamId,
    userId: input.userId,
    date: loaded.bankTransaction.bookingDate ?? loaded.bankTransaction.valueDate,
    description: loaded.bankTransaction.description,
    status: input.status ?? 'confirmed',
    categorizedBy: input.categorizedBy ?? 'user',
    now,
  }

  if (input.interpretation.kind === 'transfer') {
    const transferAccount = await loadTransferLedgerAccount(tx, loaded.teamId, input.interpretation.accountId)
    if (transferAccount.linkedBankAccountId === loaded.bankTransaction.bankAccountId) {
      throw new Error('Cannot transfer to the same bank account')
    }

    if (existing) {
      const deleted = await deleteLoadedInterpretation(tx, existing, input.requiredExistingStatus)
      if (input.requiredExistingStatus && !deleted) return false
    }

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

    await insertBankImportLedgerInterpretation(tx, {...commonInsert, postings})
    await clearBankTransactionAiState(tx, loaded.bankTransaction.id, now)
    return true
  }

  const lines =
    input.interpretation.kind === 'category'
      ? [{accountId: input.interpretation.accountId, amount: absoluteMoneyString(loaded.bankTransaction.amount)}]
      : input.interpretation.lines

  await validateCategorizationAccounts(tx, loaded.teamId, lines.map(line => line.accountId))
  if (existing) {
    const deleted = await deleteLoadedInterpretation(tx, existing, input.requiredExistingStatus)
    if (input.requiredExistingStatus && !deleted) return false
  }

  const postings = buildBankTransactionCategorizationPostings({
    ledgerTransactionId,
    source: {
      bankTransactionId: loaded.bankTransaction.id,
      bankLedgerAccountId: loaded.sourceLedgerAccount.id,
      amount: loaded.bankTransaction.amount,
      currency: loaded.bankTransaction.currency,
    },
    lines,
    now,
  })

  await insertBankImportLedgerInterpretation(tx, {...commonInsert, postings})
  if (isAiCategorization) {
    await recordBankTransactionAiResult(tx, loaded.bankTransaction.id, input.aiConfidence ?? null, normalizedAiReasoning, now)
  } else {
    await clearBankTransactionAiState(tx, loaded.bankTransaction.id, now)
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

export async function confirmBankTransactionInterpretation(tx: DrizzleTransaction, input: ConfirmBankTransactionInterpretationInput) {
  const loaded = await loadSingleReconciledPostingForBankTransaction(tx, input.userId, input.bankTransactionId)
  const {ledgerTransaction} = loaded

  if (ledgerTransaction.source !== 'bank_import') {
    throw new Error('Only bank-import ledger transactions can be confirmed')
  }

  if (isRecentlyProcessing(loaded.bankTransaction.aiProcessingStartedAt)) {
    throw new Error('Transaction is currently being categorized by AI')
  }

  await validateConfirmableInterpretationPostings(tx, ledgerTransaction.teamId, ledgerTransaction.id)
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
    .for('update', {of: bankTransactions})

  if (!row) throw new Error('Bank transaction not found')
  if (row.sourceLedgerAccount.teamId !== row.teamId || row.sourceLedgerAccount.linkedBankAccountId !== row.bankTransaction.bankAccountId) {
    throw new Error('Reconciled posting account must match the bank transaction account')
  }
  return row
}

async function loadExistingInterpretationForBankTransaction(tx: DrizzleTransaction, teamId: string, bankTransactionId: string) {
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

  if (!existing) return null
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

  return {
    ledgerTransaction: existing.ledgerTransaction,
    bankPosting: {...existing.bankPosting, bankTransactionId: existingBankTransactionId},
    bankTransaction: existing.bankTransaction,
  }
}

async function deleteLoadedInterpretation(
  tx: DrizzleTransaction,
  existing: {ledgerTransaction: {id: string}},
  requiredExistingStatus?: LedgerTransactionFinalStatus,
) {
  if (requiredExistingStatus) {
    const [deleted] = await tx
      .delete(ledgerTransactions)
      .where(and(eq(ledgerTransactions.id, existing.ledgerTransaction.id), eq(ledgerTransactions.status, requiredExistingStatus)))
      .returning({id: ledgerTransactions.id})
    return Boolean(deleted)
  }

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

async function loadSingleReconciledPostingForBankTransaction(
  tx: DrizzleTransaction,
  userId: string,
  bankTransactionId: string,
): Promise<LoadedImportedLedgerTransaction> {
  const [row] = await tx
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
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .innerJoin(teamMembers, eq(teamMembers.teamId, bankAccounts.teamId))
    .innerJoin(ledgerPostings, eq(ledgerPostings.bankTransactionId, bankTransactions.id))
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerPostings.ledgerTransactionId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerPostings.accountId))
    .where(and(eq(bankTransactions.id, bankTransactionId), eq(teamMembers.userId, userId), eq(bankAccounts.teamId, ledgerTransactions.teamId)))
    .limit(1)

  if (!row) throw new Error('Bank transaction interpretation not found')
  const linkedBankTransactionId = row.bankPosting.bankTransactionId
  if (!linkedBankTransactionId) throw new Error('Linked bank transaction not found')

  const loaded = {
    ledgerTransaction: row.ledgerTransaction,
    bankPosting: {...row.bankPosting, bankTransactionId: linkedBankTransactionId},
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

async function validateConfirmableInterpretationPostings(tx: DrizzleTransaction, teamId: string, ledgerTransactionId: string) {
  const postings = await tx
    .select({
      bankTransactionId: ledgerPostings.bankTransactionId,
      accountId: ledgerPostings.accountId,
      amount: ledgerPostings.amount,
      currency: ledgerPostings.currency,
      teamId: ledgerAccounts.teamId,
      type: ledgerAccounts.type,
      status: ledgerAccounts.status,
      systemKey: ledgerAccounts.systemKey,
      linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
    })
    .from(ledgerPostings)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerPostings.accountId))
    .where(eq(ledgerPostings.ledgerTransactionId, ledgerTransactionId))

  const categoryPostings = postings.filter(posting => posting.bankTransactionId === null)
  if (categoryPostings.length > 0) {
    const hasUncategorized = categoryPostings.some(posting => posting.systemKey === SYSTEM_LEDGER_ACCOUNT_KEYS.uncategorized)
    if (hasUncategorized) {
      throw new Error('Uncategorized transactions cannot be confirmed')
    }

    const hasInvalidCategory = categoryPostings.some(posting => posting.teamId !== teamId || !isRealCategorizationAccount(posting))
    if (hasInvalidCategory) {
      throw new Error('Transaction must have a real category before it can be confirmed')
    }
    return
  }

  if (postings.length !== 2) {
    throw new Error('Transaction must have a category before it can be confirmed')
  }

  const bankLinkedPostings = postings.flatMap(posting => (posting.bankTransactionId === null ? [] : [{...posting, bankTransactionId: posting.bankTransactionId}]))
  if (bankLinkedPostings.length !== 2) {
    throw new Error('Transaction must have a category before it can be confirmed')
  }

  const bankTransactionRows = await tx
    .select({
      id: bankTransactions.id,
      bankAccountId: bankTransactions.bankAccountId,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      teamId: bankAccounts.teamId,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .where(inArray(bankTransactions.id, bankLinkedPostings.map(posting => posting.bankTransactionId)))
  const bankTransactionsById = new Map(bankTransactionRows.map(bankTransaction => [bankTransaction.id, bankTransaction]))

  if (bankTransactionsById.size !== bankLinkedPostings.length) {
    throw new Error('Transaction must have a category before it can be confirmed')
  }

  const hasInvalidTransferPosting = bankLinkedPostings.some(posting => {
    const bankTransaction = bankTransactionsById.get(posting.bankTransactionId)
    return (
      !bankTransaction ||
      posting.teamId !== teamId ||
      !posting.linkedBankAccountId ||
      posting.linkedBankAccountId !== bankTransaction.bankAccountId ||
      bankTransaction.teamId !== teamId ||
      !moneyAmountsEqual(posting.amount, bankTransaction.amount) ||
      posting.currency !== bankTransaction.currency
    )
  })
  if (hasInvalidTransferPosting) {
    throw new Error('Transaction must have a category before it can be confirmed')
  }

  const linkedBankAccountIds = new Set(bankLinkedPostings.map(posting => posting.linkedBankAccountId))
  if (linkedBankAccountIds.size !== 2) {
    throw new Error('Transaction must have a category before it can be confirmed')
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

function moneyAmountsEqual(left: string, right: string) {
  try {
    return parseMoneyToScaledUnits(left) === parseMoneyToScaledUnits(right)
  } catch {
    return false
  }
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
