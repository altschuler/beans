import {and, eq, inArray, isNotNull, isNull} from 'drizzle-orm'
import {keyBy, uniq} from 'lodash-es'
import type {Database} from './db'
import {absoluteMoneyAmount, formatMoneyDecimal} from './money'
import {bankAccounts, bankTransactions, ledgerAccounts, ledgerPostings, ledgerTransactions, teamMembers} from './schema'
import {
  buildBankTransactionCategorizationPostings,
  buildBankTransactionUncategorizedPostings,
  isRealCategorizationAccount,
  validateLedgerPostingsBalance,
  type BuiltLedgerPosting,
  type CategorizationLineInput,
} from './categorization'

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DrizzleTransaction = DatabaseTransaction

type LedgerTransactionFinalStatus = 'confirmed' | 'needs_review'
type LedgerTransactionCategorizedBy = 'user'

type BankTransactionInterpretation =
  | {kind: 'category'; accountId: string}
  | {kind: 'split'; lines: CategorizationLineInput[]}
  | {kind: 'transfer'; accountId: string}

type ApplyBankTransactionInterpretationInput = {
  userId: string
  teamId?: string
  bankTransactionId: string
  interpretation: BankTransactionInterpretation
}

type CategorizeBankTransactionInput = {
  userId: string
  teamId?: string
  bankTransactionId: string
  selection: {kind: 'category'; accountId: string} | {kind: 'transfer'; accountId: string}
}

type SplitBankTransactionInput = {
  userId: string
  teamId?: string
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
  bankPosting: {id: string; ledgerTransactionId: string; accountId: string; amount: number; currency: string; bankTransactionId: string}
  bankTransaction: {id: string; bankAccountId: string; amount: number; currency: string}
}

type LoadedBankTransactionForCategorization = {
  teamId: string
  bankTransaction: {
    id: string
    bankAccountId: string
    amount: number
    currency: string
    bookingDate: string | null
    valueDate: string | null
    description: string
  }
  sourceLedgerAccount: {id: string; linkedBankAccountId: string | null; teamId: string}
}

type TransferLedgerAccount = {id: string; teamId: string; type: string; status: string; linkedBankAccountId: string | null}

type ReconciledPostingInvariantInput = LoadedImportedLedgerTransaction & {
  postingAccount: {teamId: string; linkedBankAccountId: string | null}
}

const TRANSFER_MATCH_DATE_WINDOW_DAYS = 2
const TRANSFER_CONFIRM_INVALID_MESSAGE = 'Transfer is not valid and cannot be confirmed'
const SYSTEM_LEDGER_ACCOUNT_KEYS = {
  uncategorized: 'uncategorized',
} as const

export async function ensureUncategorizedBankImportInterpretation(
  tx: DrizzleTransaction,
  input: {bankTransactionId: string; now?: Date},
) {
  const existing = await loadExistingInterpretationForBankTransactionById(tx, input.bankTransactionId)
  if (existing) return existing.ledgerTransaction.id

  const loaded = await loadBankTransactionForUncategorizedInterpretation(tx, input.bankTransactionId)
  const now = input.now ?? new Date()
  const ledgerTransactionId = crypto.randomUUID()
  const postings = buildBankTransactionUncategorizedPostings({
    ledgerTransactionId,
    source: {
      bankTransactionId: loaded.bankTransaction.id,
      bankLedgerAccountId: loaded.sourceLedgerAccount.id,
      amount: loaded.bankTransaction.amount,
      currency: loaded.bankTransaction.currency,
    },
    uncategorizedAccountId: loaded.uncategorizedAccount.id,
    now,
  })

  await insertBankImportLedgerInterpretation(tx, {
    ledgerTransactionId,
    teamId: loaded.teamId,
    userId: null,
    date: loaded.bankTransaction.bookingDate ?? loaded.bankTransaction.valueDate,
    description: null,
    postings,
    status: 'needs_review',
    categorizedBy: null,
    now,
  })
  return ledgerTransactionId
}

export async function refreshUncategorizedBankImportInterpretation(
  tx: DrizzleTransaction,
  input: {bankTransactionId: string; now?: Date},
) {
  const loaded = await loadRefreshableUncategorizedInterpretation(tx, input.bankTransactionId)
  if (!loaded) return false

  const now = input.now ?? new Date()
  await tx
    .update(ledgerTransactions)
    .set({date: loaded.bankTransaction.bookingDate ?? loaded.bankTransaction.valueDate, updatedAt: now})
    .where(eq(ledgerTransactions.id, loaded.ledgerTransaction.id))

  const [updatedBankPosting] = await tx
    .update(ledgerPostings)
    .set({
      accountId: loaded.sourceLedgerAccount.id,
      amount: loaded.bankTransaction.amount,
      currency: loaded.bankTransaction.currency,
      updatedAt: now,
    })
    .where(and(eq(ledgerPostings.id, loaded.bankPosting.id), eq(ledgerPostings.ledgerTransactionId, loaded.ledgerTransaction.id)))
    .returning({id: ledgerPostings.id})
  if (!updatedBankPosting) {
    throw new Error('Bank posting was changed concurrently, please retry')
  }

  const [updatedUncategorizedPosting] = await tx
    .update(ledgerPostings)
    .set({
      amount: -loaded.bankTransaction.amount,
      currency: loaded.bankTransaction.currency,
      updatedAt: now,
    })
    .where(
      and(
        eq(ledgerPostings.id, loaded.uncategorizedPosting.id),
        eq(ledgerPostings.ledgerTransactionId, loaded.ledgerTransaction.id),
        isNull(ledgerPostings.bankTransactionId),
      ),
    )
    .returning({id: ledgerPostings.id})
  if (!updatedUncategorizedPosting) {
    throw new Error('Uncategorized posting was changed concurrently, please retry')
  }

  await validatePersistedTransactionBalance(tx, loaded.ledgerTransaction.id)
  return true
}

export async function categorizeBankTransaction(tx: DrizzleTransaction, input: CategorizeBankTransactionInput) {
  return applyBankTransactionInterpretation(tx, {
    userId: input.userId,
    teamId: input.teamId,
    bankTransactionId: input.bankTransactionId,
    interpretation: input.selection,
  })
}

export async function splitBankTransaction(tx: DrizzleTransaction, input: SplitBankTransactionInput) {
  return applyBankTransactionInterpretation(tx, {
    userId: input.userId,
    teamId: input.teamId,
    bankTransactionId: input.bankTransactionId,
    interpretation: {kind: 'split', lines: input.lines},
  })
}

async function applyBankTransactionInterpretation(tx: DrizzleTransaction, input: ApplyBankTransactionInterpretationInput) {
  const loaded = await loadBankTransactionForCategorization(tx, {
    userId: input.userId,
    teamId: input.teamId,
    bankTransactionId: input.bankTransactionId,
  })
  if (input.teamId && loaded.teamId !== input.teamId) return false

  let existing = await loadExistingInterpretationForBankTransaction(tx, loaded.teamId, loaded.bankTransaction.id)

  const now = new Date()
  if (!existing) {
    await ensureUncategorizedBankImportInterpretation(tx, {bankTransactionId: loaded.bankTransaction.id, now})
    existing = await loadExistingInterpretationForBankTransaction(tx, loaded.teamId, loaded.bankTransaction.id)
  }
  if (!existing) throw new Error('Bank transaction interpretation not found')

  // Re-categorization updates the existing ledger transaction in place (reusing its id) rather than
  // deleting and re-inserting, so Zero syncs an update instead of a delete+insert and id-keyed lookups
  // stay stable. Category/counter postings are fully rebuilt, but the source bank posting is left
  // untouched (see claimExistingInterpretationForRewrite): recreating the row behind the singular
  // bankTransactions.posting relationship under a new key makes Zero clients transiently see two
  // postings for one bank transaction mid-sync, which errors the sync connection.
  const ledgerTransactionId = existing.ledgerTransaction.id
  const writeFields = {
    ledgerTransactionId,
    teamId: loaded.teamId,
    userId: input.userId,
    date: loaded.bankTransaction.bookingDate ?? loaded.bankTransaction.valueDate,
    // Left null: the bank transaction owns the description for bank-import interpretations (see schema).
    description: null,
    status: 'confirmed' as const,
    categorizedBy: 'user' as const,
    now,
  }

  if (input.interpretation.kind === 'transfer') {
    const transferTarget = await loadTransferTargetForLedgerAccount(tx, {
      teamId: loaded.teamId,
      sourceBankTransactionId: loaded.bankTransaction.id,
      transferLedgerAccountId: input.interpretation.accountId,
      sourceBankAccountId: loaded.bankTransaction.bankAccountId,
      sourceAmount: loaded.bankTransaction.amount,
      currency: loaded.bankTransaction.currency,
      sourceDate: loaded.bankTransaction.bookingDate ?? loaded.bankTransaction.valueDate,
    })

    const claimed = await claimExistingInterpretationForRewrite(tx, existing.ledgerTransaction.id, loaded.bankTransaction.id, writeFields)
    if (!claimed) return false

    await restoreDetachedBankPostingsToUncategorized(tx, existing.ledgerTransaction.id, loaded.bankTransaction.id, now)
    await deleteExplanatoryPostings(tx, existing.ledgerTransaction.id)
    await ensureUncategorizedBankImportInterpretation(tx, {bankTransactionId: transferTarget.counterBankTransaction.id, now})
    const counterExisting = await loadExistingInterpretationForBankTransaction(tx, loaded.teamId, transferTarget.counterBankTransaction.id)
    if (!counterExisting) throw new Error('Counter bank transaction interpretation not found')
    if (!(await isUncategorizedLedgerInterpretation(tx, counterExisting.ledgerTransaction.id))) {
      throw new Error('Invalid transfer counter transaction')
    }

    await deleteExplanatoryPostings(tx, counterExisting.ledgerTransaction.id)
    const [movedCounterPosting] = await tx
      .update(ledgerPostings)
      .set({ledgerTransactionId, sortOrder: 1, updatedAt: now})
      .where(and(eq(ledgerPostings.id, counterExisting.bankPosting.id), eq(ledgerPostings.ledgerTransactionId, counterExisting.ledgerTransaction.id)))
      .returning({id: ledgerPostings.id})
    if (!movedCounterPosting) {
      throw new Error('Counter bank posting was changed concurrently, please retry')
    }
    await tx.delete(ledgerTransactions).where(eq(ledgerTransactions.id, counterExisting.ledgerTransaction.id))
    await validatePersistedTransactionBalance(tx, ledgerTransactionId)
    return true
  }

  const lines =
    input.interpretation.kind === 'category'
      ? [{accountId: input.interpretation.accountId, amount: formatMoneyDecimal(absoluteMoneyAmount(loaded.bankTransaction.amount), loaded.bankTransaction.currency)}]
      : input.interpretation.lines

  await validateCategorizationAccounts(tx, loaded.teamId, lines.map(line => line.accountId))
  const claimed = await claimExistingInterpretationForRewrite(tx, existing.ledgerTransaction.id, loaded.bankTransaction.id, writeFields)
  if (!claimed) return false

  await restoreDetachedBankPostingsToUncategorized(tx, existing.ledgerTransaction.id, loaded.bankTransaction.id, now)
  await deleteExplanatoryPostings(tx, existing.ledgerTransaction.id)

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

  // The source bank posting was preserved; only insert the rebuilt category postings.
  await tx.insert(ledgerPostings).values(postings.filter(posting => posting.bankTransactionId !== loaded.bankTransaction.id))
  await validatePersistedTransactionBalance(tx, ledgerTransactionId)
  return true
}

async function deleteExplanatoryPostings(tx: DrizzleTransaction, ledgerTransactionId: string) {
  await tx.delete(ledgerPostings).where(and(eq(ledgerPostings.ledgerTransactionId, ledgerTransactionId), isNull(ledgerPostings.bankTransactionId)))
}

async function restoreDetachedBankPostingsToUncategorized(tx: DrizzleTransaction, ledgerTransactionId: string, sourceBankTransactionId: string, now: Date) {
  const rows = await tx
    .select({bankTransactionId: ledgerPostings.bankTransactionId})
    .from(ledgerPostings)
    .where(and(eq(ledgerPostings.ledgerTransactionId, ledgerTransactionId), isNotNull(ledgerPostings.bankTransactionId)))

  const counterIds = rows.flatMap(row => (row.bankTransactionId && row.bankTransactionId !== sourceBankTransactionId ? [row.bankTransactionId] : []))
  for (const bankTransactionId of counterIds) {
    await resetExistingBankPostingToUncategorizedInterpretation(tx, {bankTransactionId, now})
  }
}

async function resetExistingBankPostingToUncategorizedInterpretation(
  tx: DrizzleTransaction,
  input: {bankTransactionId: string; now: Date},
) {
  const loaded = await loadBankPostingForUncategorizedReset(tx, input.bankTransactionId)
  const ledgerTransactionId = crypto.randomUUID()
  const postings = buildBankTransactionUncategorizedPostings({
    ledgerTransactionId,
    source: {
      bankTransactionId: loaded.bankTransaction.id,
      bankLedgerAccountId: loaded.sourceLedgerAccount.id,
      amount: loaded.bankTransaction.amount,
      currency: loaded.bankTransaction.currency,
    },
    uncategorizedAccountId: loaded.uncategorizedAccount.id,
    bankPostingId: loaded.bankPosting.id,
    now: input.now,
  })
  const bankPosting = postings[0]!
  const uncategorizedPosting = postings[1]!

  await tx.insert(ledgerTransactions).values({
    id: ledgerTransactionId,
    teamId: loaded.teamId,
    source: 'bank_import',
    status: 'needs_review',
    categorizedBy: null,
    userConfirmedAt: null,
    userConfirmedBy: null,
    date: loaded.bankTransaction.bookingDate ?? loaded.bankTransaction.valueDate,
    description: null,
    createdAt: input.now,
    updatedAt: input.now,
  })
  const [movedBankPosting] = await tx
    .update(ledgerPostings)
    .set({
      ledgerTransactionId,
      accountId: bankPosting.accountId,
      amount: bankPosting.amount,
      currency: bankPosting.currency,
      bankTransactionId: bankPosting.bankTransactionId,
      sortOrder: 0,
      updatedAt: input.now,
    })
    .where(and(eq(ledgerPostings.id, loaded.bankPosting.id), eq(ledgerPostings.ledgerTransactionId, loaded.oldLedgerTransactionId)))
    .returning({id: ledgerPostings.id})
  if (!movedBankPosting) {
    throw new Error('Bank posting was changed concurrently, please retry')
  }
  await tx.insert(ledgerPostings).values(uncategorizedPosting)
  await validatePersistedTransactionBalance(tx, ledgerTransactionId)
  await deleteBankImportTransactionsWithoutBankPostings(tx, [loaded.oldLedgerTransactionId])
}

async function deleteBankImportTransactionsWithoutBankPostings(tx: DrizzleTransaction, ledgerTransactionIds: string[]) {
  const ids = uniq(ledgerTransactionIds)
  for (const ledgerTransactionId of ids) {
    const [bankPosting] = await tx
      .select({id: ledgerPostings.id})
      .from(ledgerPostings)
      .where(and(eq(ledgerPostings.ledgerTransactionId, ledgerTransactionId), isNotNull(ledgerPostings.bankTransactionId)))
      .limit(1)
    if (!bankPosting) {
      await tx.delete(ledgerTransactions).where(and(eq(ledgerTransactions.id, ledgerTransactionId), eq(ledgerTransactions.source, 'bank_import')))
    }
  }
}

export async function clearLedgerCategorizations(tx: DrizzleTransaction, input: ClearLedgerCategorizationsInput) {
  const rows = await tx
    .select({
      ledgerTransactionId: ledgerTransactions.id,
      bankPostingBankTransactionId: ledgerPostings.bankTransactionId,
    })
    .from(ledgerTransactions)
    .innerJoin(teamMembers, eq(teamMembers.teamId, ledgerTransactions.teamId))
    .innerJoin(ledgerPostings, and(eq(ledgerPostings.ledgerTransactionId, ledgerTransactions.id), isNotNull(ledgerPostings.bankTransactionId)))
    .innerJoin(bankTransactions, eq(bankTransactions.id, ledgerPostings.bankTransactionId))
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .where(and(eq(teamMembers.userId, input.userId), eq(ledgerTransactions.source, 'bank_import'), eq(bankAccounts.teamId, ledgerTransactions.teamId)))

  if (rows.length === 0) return {cleared: 0}

  const transactionIds = uniq(rows.map(row => row.ledgerTransactionId))
  const bankTransactionIds = uniq(rows.flatMap(row => (row.bankPostingBankTransactionId ? [row.bankPostingBankTransactionId] : [])))
  const now = new Date()
  for (const bankTransactionId of bankTransactionIds) {
    await resetExistingBankPostingToUncategorizedInterpretation(tx, {bankTransactionId, now})
  }
  await deleteBankImportTransactionsWithoutBankPostings(tx, transactionIds)

  return {cleared: transactionIds.length}
}

export async function confirmBankTransactionInterpretation(tx: DrizzleTransaction, input: ConfirmBankTransactionInterpretationInput) {
  const loaded = await loadSingleReconciledPostingForBankTransaction(tx, input.userId, input.bankTransactionId)
  const {ledgerTransaction} = loaded

  if (ledgerTransaction.source !== 'bank_import') {
    throw new Error('Only bank-import ledger transactions can be confirmed')
  }

  await validateConfirmableInterpretationPostings(tx, ledgerTransaction.teamId, ledgerTransaction.id)
  await validatePersistedTransactionBalance(tx, ledgerTransaction.id)

  const now = new Date()
  const [updatedTransaction] = await tx
    .update(ledgerTransactions)
    .set({status: 'confirmed', userConfirmedAt: now, userConfirmedBy: input.userId, updatedAt: now})
    .where(eq(ledgerTransactions.id, ledgerTransaction.id))
    .returning({id: ledgerTransactions.id})

  // 0 rows means the interpretation was deleted or rewritten by a concurrent action (e.g. clearing
  // categorizations or a re-categorization) between our load and this update. No shared row lock
  // serializes these, so the safe outcome is to abort and let the caller retry.
  if (!updatedTransaction) {
    throw new Error('Transaction was changed concurrently, please retry')
  }
}


async function loadExistingInterpretationForBankTransactionById(tx: DrizzleTransaction, bankTransactionId: string) {
  const [row] = await tx
    .select({ledgerTransaction: {id: ledgerTransactions.id}})
    .from(ledgerPostings)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerPostings.ledgerTransactionId))
    .where(eq(ledgerPostings.bankTransactionId, bankTransactionId))
    .limit(1)
  return row ?? null
}

async function loadBankTransactionForUncategorizedInterpretation(tx: DrizzleTransaction, bankTransactionId: string) {
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
      },
      sourceLedgerAccount: {
        id: ledgerAccounts.id,
        linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
        teamId: ledgerAccounts.teamId,
      },
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.linkedBankAccountId, bankAccounts.id))
    .where(eq(bankTransactions.id, bankTransactionId))
    .limit(1)

  if (!row) throw new Error('Bank transaction not found')
  if (row.sourceLedgerAccount.teamId !== row.teamId || row.sourceLedgerAccount.linkedBankAccountId !== row.bankTransaction.bankAccountId) {
    throw new Error('Reconciled posting account must match the bank transaction account')
  }

  const [uncategorizedAccount] = await tx
    .select({id: ledgerAccounts.id})
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.teamId, row.teamId), eq(ledgerAccounts.systemKey, SYSTEM_LEDGER_ACCOUNT_KEYS.uncategorized)))
    .limit(1)
  if (!uncategorizedAccount) throw new Error('Uncategorized account not found')

  return {...row, uncategorizedAccount}
}

async function loadBankPostingForUncategorizedReset(tx: DrizzleTransaction, bankTransactionId: string) {
  const [row] = await tx
    .select({
      teamId: bankAccounts.teamId,
      oldLedgerTransactionId: ledgerPostings.ledgerTransactionId,
      bankPosting: {id: ledgerPostings.id},
      bankTransaction: {
        id: bankTransactions.id,
        bankAccountId: bankTransactions.bankAccountId,
        amount: bankTransactions.amount,
        currency: bankTransactions.currency,
        bookingDate: bankTransactions.bookingDate,
        valueDate: bankTransactions.valueDate,
      },
      sourceLedgerAccount: {
        id: ledgerAccounts.id,
        linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
        teamId: ledgerAccounts.teamId,
      },
    })
    .from(ledgerPostings)
    .innerJoin(bankTransactions, eq(bankTransactions.id, ledgerPostings.bankTransactionId))
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.linkedBankAccountId, bankAccounts.id))
    .where(eq(ledgerPostings.bankTransactionId, bankTransactionId))
    .limit(1)

  if (!row) throw new Error('Bank transaction interpretation not found')
  if (row.sourceLedgerAccount.teamId !== row.teamId || row.sourceLedgerAccount.linkedBankAccountId !== row.bankTransaction.bankAccountId) {
    throw new Error('Reconciled posting account must match the bank transaction account')
  }

  const [uncategorizedAccount] = await tx
    .select({id: ledgerAccounts.id})
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.teamId, row.teamId), eq(ledgerAccounts.systemKey, SYSTEM_LEDGER_ACCOUNT_KEYS.uncategorized)))
    .limit(1)
  if (!uncategorizedAccount) throw new Error('Uncategorized account not found')

  return {...row, uncategorizedAccount}
}

async function isUncategorizedLedgerInterpretation(tx: DrizzleTransaction, ledgerTransactionId: string) {
  const [row] = await tx
    .select({id: ledgerPostings.id})
    .from(ledgerPostings)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerPostings.accountId))
    .where(
      and(
        eq(ledgerPostings.ledgerTransactionId, ledgerTransactionId),
        isNull(ledgerPostings.bankTransactionId),
        eq(ledgerAccounts.systemKey, SYSTEM_LEDGER_ACCOUNT_KEYS.uncategorized),
      ),
    )
    .limit(1)
  return Boolean(row)
}

async function loadRefreshableUncategorizedInterpretation(tx: DrizzleTransaction, bankTransactionId: string) {
  const [row] = await tx
    .select({
      ledgerTransaction: {id: ledgerTransactions.id},
      bankPosting: {id: ledgerPostings.id},
    })
    .from(ledgerPostings)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerPostings.ledgerTransactionId))
    .where(eq(ledgerPostings.bankTransactionId, bankTransactionId))
    .limit(1)
  if (!row) return null

  const [uncategorizedPosting] = await tx
    .select({id: ledgerPostings.id, accountId: ledgerPostings.accountId})
    .from(ledgerPostings)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerPostings.accountId))
    .where(
      and(
        eq(ledgerPostings.ledgerTransactionId, row.ledgerTransaction.id),
        isNull(ledgerPostings.bankTransactionId),
        eq(ledgerAccounts.systemKey, SYSTEM_LEDGER_ACCOUNT_KEYS.uncategorized),
      ),
    )
    .limit(1)

  if (!uncategorizedPosting) return null
  const loaded = await loadBankTransactionForUncategorizedInterpretation(tx, bankTransactionId)
  return {
    ledgerTransaction: row.ledgerTransaction,
    bankPosting: row.bankPosting,
    uncategorizedPosting,
    bankTransaction: loaded.bankTransaction,
    sourceLedgerAccount: loaded.sourceLedgerAccount,
  }
}

// Plain read, no row lock. Concurrency safety relies on the `ledger_postings.bankTransactionId`
// unique index (a second concurrent attempt to create an interpretation for the same bank transaction
// hits the constraint and rolls back) plus the guarded UPDATE in claimExistingInterpretationForRewrite
// (optimistic-concurrency check on re-categorization) and balance validation on every write. Concurrent
// writes to the same bank transaction resolve as last-writer-wins or roll back and retry rather than
// serializing on a shared lock — acceptable given low write concurrency.
async function loadBankTransactionForCategorization(
  tx: DrizzleTransaction,
  input: {userId: string; teamId?: string; bankTransactionId: string},
): Promise<LoadedBankTransactionForCategorization> {
  const conditions = [eq(bankTransactions.id, input.bankTransactionId)]
  if (input.teamId) conditions.push(eq(bankAccounts.teamId, input.teamId))

  const selection = {
    teamId: bankAccounts.teamId,
    bankTransaction: {
      id: bankTransactions.id,
      bankAccountId: bankTransactions.bankAccountId,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      bookingDate: bankTransactions.bookingDate,
      valueDate: bankTransactions.valueDate,
      description: bankTransactions.description,
    },
    sourceLedgerAccount: {
      id: ledgerAccounts.id,
      linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
      teamId: ledgerAccounts.teamId,
    },
  }
  const [row] = await tx
    .select(selection)
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .innerJoin(teamMembers, eq(teamMembers.teamId, bankAccounts.teamId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.linkedBankAccountId, bankAccounts.id))
    .where(and(...conditions, eq(teamMembers.userId, input.userId)))
    .limit(1)

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
        userConfirmedAt: ledgerTransactions.userConfirmedAt,
        userConfirmedBy: ledgerTransactions.userConfirmedBy,
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

type RewriteLedgerTransactionFields = {
  userId: string
  date: string | null
  description: string | null
  status: LedgerTransactionFinalStatus
  categorizedBy: LedgerTransactionCategorizedBy
  now: Date
}

// Updates the existing ledger transaction row in place under an optimistic-concurrency guard. A false
// result commits the surrounding db.transaction, so callers must run this claim before any posting moves,
// resets, or deletes that would otherwise partially mutate a transfer when the guard fails. createdAt is
// preserved (only updatedAt moves).
//
// The source bank posting (the one linked to the bank transaction being categorized) is deliberately
// left untouched: its account/amount/currency are invariant across re-categorization, and preserving
// its primary key keeps the singular bankTransactions.posting relationship an in-place edit on Zero
// clients instead of a delete+insert that briefly exposes two postings for one bank transaction.
async function claimExistingInterpretationForRewrite(tx: DrizzleTransaction, existingLedgerTransactionId: string, _sourceBankTransactionId: string, fields: RewriteLedgerTransactionFields) {
  const conditions = [eq(ledgerTransactions.id, existingLedgerTransactionId)]

  const [updated] = await tx
    .update(ledgerTransactions)
    .set({
      status: fields.status,
      categorizedBy: fields.categorizedBy,
      userConfirmedAt: fields.now,
      userConfirmedBy: fields.userId,
      date: fields.date,
      description: fields.description,
      updatedAt: fields.now,
    })
    .where(and(...conditions))
    .returning({id: ledgerTransactions.id})

  return Boolean(updated)
}

async function loadTransferTargetForLedgerAccount(
  tx: DrizzleTransaction,
  input: {
    teamId: string
    sourceBankTransactionId: string
    transferLedgerAccountId: string
    sourceBankAccountId: string
    sourceAmount: number
    currency: string
    sourceDate: string | null
  },
) {
  const transferAccount = await loadTransferLedgerAccount(tx, input.teamId, input.transferLedgerAccountId)
  if (transferAccount.linkedBankAccountId === input.sourceBankAccountId) {
    throw new Error('Cannot transfer to the same bank account')
  }

  const counterBankTransaction = await findExactCounterBankTransaction({
    tx,
    teamId: input.teamId,
    sourceBankTransactionId: input.sourceBankTransactionId,
    targetBankAccountId: transferAccount.linkedBankAccountId!,
    sourceAmount: input.sourceAmount,
    currency: input.currency,
    sourceDate: input.sourceDate,
  })
  if (!counterBankTransaction) {
    throw new Error('No matching transfer was found')
  }

  return {transferAccount, counterBankTransaction}
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
  sourceAmount: number
  currency: string
  sourceDate: string | null
}) {
  const expectedAmount = -input.sourceAmount
  const rows = await input.tx
    .select({id: bankTransactions.id, bookingDate: bankTransactions.bookingDate, valueDate: bankTransactions.valueDate})
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .where(
      and(
        eq(bankAccounts.teamId, input.teamId),
        eq(bankTransactions.bankAccountId, input.targetBankAccountId),
        eq(bankTransactions.amount, expectedAmount),
        eq(bankTransactions.currency, input.currency),
      ),
    )

  const candidates = rows
    .filter(row => row.id !== input.sourceBankTransactionId && isWithinTransferMatchDateWindow(input.sourceDate, row.bookingDate ?? row.valueDate))
    .sort((left, right) => compareTransferCandidateDate(input.sourceDate, left.bookingDate ?? left.valueDate, right.bookingDate ?? right.valueDate) || left.id.localeCompare(right.id))

  for (const candidate of candidates) {
    const existing = await loadExistingInterpretationForBankTransaction(input.tx, input.teamId, candidate.id)
    if (!existing || await isUncategorizedLedgerInterpretation(input.tx, existing.ledgerTransaction.id)) return candidate
  }
  return null
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
    userId: string | null
    date: string | null
    description: string | null
    postings: BuiltLedgerPosting[]
    status?: LedgerTransactionFinalStatus
    categorizedBy?: LedgerTransactionCategorizedBy | null
    now: Date
  },
) {
  await tx.insert(ledgerTransactions).values({
    id: input.ledgerTransactionId,
    teamId: input.teamId,
    source: 'bank_import',
    status: input.status ?? 'confirmed',
    categorizedBy: input.categorizedBy ?? null,
    userConfirmedAt: input.categorizedBy === 'user' ? input.now : null,
    userConfirmedBy: input.categorizedBy === 'user' ? input.userId : null,
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

  if (input.bankPosting.amount !== input.bankTransaction.amount) {
    throw new Error('Reconciled posting amount must match the bank transaction amount')
  }

  if (input.bankPosting.currency !== input.bankTransaction.currency) {
    throw new Error('Reconciled posting currency must match the bank transaction currency')
  }
}

async function validateCategorizationAccounts(tx: DrizzleTransaction, teamId: string, lineAccountIds: string[]) {
  const accountIds = uniq(lineAccountIds)
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

  const accountsById = keyBy(accounts, account => account.id)
  for (const accountId of accountIds) {
    const account = accountsById[accountId]
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
    throw new Error(TRANSFER_CONFIRM_INVALID_MESSAGE)
  }

  const bankLinkedPostings = postings.flatMap(posting => (posting.bankTransactionId === null ? [] : [{...posting, bankTransactionId: posting.bankTransactionId}]))
  if (bankLinkedPostings.length !== 2) {
    throw new Error(TRANSFER_CONFIRM_INVALID_MESSAGE)
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
  const bankTransactionsById = keyBy(bankTransactionRows, bankTransaction => bankTransaction.id)

  if (Object.keys(bankTransactionsById).length !== bankLinkedPostings.length) {
    throw new Error(TRANSFER_CONFIRM_INVALID_MESSAGE)
  }

  const hasInvalidTransferPosting = bankLinkedPostings.some(posting => {
    const bankTransaction = bankTransactionsById[posting.bankTransactionId]
    return (
      !bankTransaction ||
      posting.teamId !== teamId ||
      !posting.linkedBankAccountId ||
      posting.linkedBankAccountId !== bankTransaction.bankAccountId ||
      bankTransaction.teamId !== teamId ||
      posting.amount !== bankTransaction.amount ||
      posting.currency !== bankTransaction.currency
    )
  })
  if (hasInvalidTransferPosting) {
    throw new Error(TRANSFER_CONFIRM_INVALID_MESSAGE)
  }

  const linkedBankAccountIds = uniq(bankLinkedPostings.map(posting => posting.linkedBankAccountId))
  if (linkedBankAccountIds.length !== 2) {
    throw new Error(TRANSFER_CONFIRM_INVALID_MESSAGE)
  }
}

async function validatePersistedTransactionBalance(tx: DrizzleTransaction, ledgerTransactionId: string) {
  const postings = await tx
    .select({amount: ledgerPostings.amount, currency: ledgerPostings.currency})
    .from(ledgerPostings)
    .where(eq(ledgerPostings.ledgerTransactionId, ledgerTransactionId))
  validateLedgerPostingsBalance(postings)
}
