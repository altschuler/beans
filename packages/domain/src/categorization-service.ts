import {and, eq, inArray, isNotNull, isNull, sql} from 'drizzle-orm'
import {keyBy, uniq} from 'lodash-es'
import type {Database} from './db'
import {absoluteMoneyAmount, formatMoneyDecimal} from './money'
import {bankAccounts, bankTransactions, ledgerAccounts, ledgerPostings, ledgerTransactions, teamMembers} from './schema'
import {
  buildBankTransactionCategorizationPostings,
  buildBankTransactionTransferPostings,
  isRealCategorizationAccount,
  validateLedgerPostingsBalance,
  type BuiltLedgerPosting,
  type CategorizationLineInput,
} from './categorization'

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DrizzleTransaction = DatabaseTransaction

type LedgerTransactionFinalStatus = 'confirmed' | 'needs_review'
type LedgerTransactionAiConfidence = 0 | 1 | 2
type LedgerTransactionCategorizedBy = 'user' | 'ai'

type BankTransactionInterpretation =
  | {kind: 'category'; accountId: string}
  | {kind: 'split'; lines: CategorizationLineInput[]}
  | {kind: 'transfer'; accountId: string}
  | {kind: 'transfer'; counterBankTransactionId: string}

type ApplyBankTransactionInterpretationInput = {
  userId: string
  teamId?: string
  trustedScope?: true
  bankTransactionId: string
  targetBankTransactionIds?: string[]
  interpretation: BankTransactionInterpretation
  status?: LedgerTransactionFinalStatus
  aiConfidence?: LedgerTransactionAiConfidence | null
  aiReasoning?: string | null
  categorizedBy?: LedgerTransactionCategorizedBy | null
  requiredExistingStatus?: LedgerTransactionFinalStatus
  expectedCategorizationRevision?: number
}

type CategorizeBankTransactionInput = {
  userId: string
  teamId?: string
  trustedScope?: true
  bankTransactionId: string
  targetBankTransactionIds?: string[]
  selection: {kind: 'category'; accountId: string} | {kind: 'transfer'; accountId: string}
  status?: LedgerTransactionFinalStatus
  aiConfidence?: LedgerTransactionAiConfidence | null
  aiReasoning?: string | null
  categorizedBy?: LedgerTransactionCategorizedBy | null
  requiredExistingStatus?: LedgerTransactionFinalStatus
  expectedCategorizationRevision?: number
}

type SplitBankTransactionInput = {
  userId: string
  teamId?: string
  trustedScope?: true
  bankTransactionId: string
  targetBankTransactionIds?: string[]
  lines: CategorizationLineInput[]
  expectedCategorizationRevision?: number
}

export type AgentInterpretationInput =
  | {kind: 'unable'}
  | {kind: 'category'; categoryAccountId: string}
  | {kind: 'split'; lines: CategorizationLineInput[]}
  | {kind: 'transfer'; counterBankTransactionId: string}

export type ApplyAgentBankTransactionInterpretationInput = {
  userId: string
  teamId: string
  trustedScope?: true
  bankTransactionId: string
  targetBankTransactionIds?: string[]
  expectedCategorizationRevision: number
  confidence: LedgerTransactionAiConfidence
  reasoning: string
  interpretation: AgentInterpretationInput
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
    categorizationRevision: number
  }
  sourceLedgerAccount: {id: string; linkedBankAccountId: string | null; teamId: string}
}

type TransferLedgerAccount = {id: string; teamId: string; type: string; status: string; linkedBankAccountId: string | null}

type ReconciledPostingInvariantInput = LoadedImportedLedgerTransaction & {
  postingAccount: {teamId: string; linkedBankAccountId: string | null}
}

const MAX_AI_REASONING_LENGTH = 500
const TRANSFER_MATCH_DATE_WINDOW_DAYS = 2
const TRANSFER_CONFIRM_INVALID_MESSAGE = 'Transfer is not valid and cannot be confirmed'
const SYSTEM_LEDGER_ACCOUNT_KEYS = {
  uncategorized: 'uncategorized',
} as const

export class CategorizationRevisionConflictError extends Error {
  readonly code = 'categorization_revision_conflict'

  constructor(
    readonly bankTransactionId: string,
    readonly expectedCategorizationRevision: number,
    readonly actualCategorizationRevision: number,
  ) {
    super('Bank transaction categorization changed, please re-read before writing')
    this.name = 'CategorizationRevisionConflictError'
  }
}

export function normalizeAiReasoning(reasoning: string) {
  return reasoning.trim().slice(0, MAX_AI_REASONING_LENGTH)
}


export async function categorizeBankTransaction(tx: DrizzleTransaction, input: CategorizeBankTransactionInput) {
  return applyBankTransactionInterpretation(tx, {
    userId: input.userId,
    teamId: input.teamId,
    trustedScope: input.trustedScope,
    bankTransactionId: input.bankTransactionId,
    targetBankTransactionIds: input.targetBankTransactionIds,
    interpretation: input.selection,
    status: input.status,
    aiConfidence: input.aiConfidence,
    aiReasoning: input.aiReasoning,
    categorizedBy: input.categorizedBy,
    requiredExistingStatus: input.requiredExistingStatus,
    expectedCategorizationRevision: input.expectedCategorizationRevision,
  })
}

export async function splitBankTransaction(tx: DrizzleTransaction, input: SplitBankTransactionInput) {
  return applyBankTransactionInterpretation(tx, {
    userId: input.userId,
    teamId: input.teamId,
    trustedScope: input.trustedScope,
    bankTransactionId: input.bankTransactionId,
    targetBankTransactionIds: input.targetBankTransactionIds,
    interpretation: {kind: 'split', lines: input.lines},
    expectedCategorizationRevision: input.expectedCategorizationRevision,
  })
}

export async function applyAgentBankTransactionInterpretation(tx: DrizzleTransaction, input: ApplyAgentBankTransactionInterpretationInput) {
  if ((input.interpretation.kind === 'category' || input.interpretation.kind === 'transfer') && input.confidence === 0) {
    throw new Error('Category and transfer interpretations require confidence 1 or 2')
  }

  if (input.interpretation.kind === 'unable') {
    return recordUnableAgentInterpretation(tx, input)
  }

  if (input.interpretation.kind === 'category') {
    return applyBankTransactionInterpretation(tx, {
      userId: input.userId,
      teamId: input.teamId,
      trustedScope: input.trustedScope,
      bankTransactionId: input.bankTransactionId,
      targetBankTransactionIds: input.targetBankTransactionIds,
      interpretation: {kind: 'category', accountId: input.interpretation.categoryAccountId},
      status: input.confidence === 2 ? 'confirmed' : 'needs_review',
      aiConfidence: input.confidence,
      aiReasoning: input.reasoning,
      categorizedBy: 'ai',
      requiredExistingStatus: 'needs_review',
      expectedCategorizationRevision: input.expectedCategorizationRevision,
    })
  }

  if (input.interpretation.kind === 'split') {
    return applyBankTransactionInterpretation(tx, {
      userId: input.userId,
      teamId: input.teamId,
      trustedScope: input.trustedScope,
      bankTransactionId: input.bankTransactionId,
      targetBankTransactionIds: input.targetBankTransactionIds,
      interpretation: {kind: 'split', lines: input.interpretation.lines},
      status: 'needs_review',
      aiConfidence: 1,
      aiReasoning: input.reasoning,
      categorizedBy: 'ai',
      requiredExistingStatus: 'needs_review',
      expectedCategorizationRevision: input.expectedCategorizationRevision,
    })
  }

  return applyBankTransactionInterpretation(tx, {
    userId: input.userId,
    teamId: input.teamId,
    trustedScope: input.trustedScope,
    bankTransactionId: input.bankTransactionId,
    targetBankTransactionIds: input.targetBankTransactionIds,
    interpretation: {kind: 'transfer', counterBankTransactionId: input.interpretation.counterBankTransactionId},
    status: input.confidence === 2 ? 'confirmed' : 'needs_review',
    aiConfidence: input.confidence,
    aiReasoning: input.reasoning,
    categorizedBy: 'ai',
    requiredExistingStatus: 'needs_review',
    expectedCategorizationRevision: input.expectedCategorizationRevision,
  })
}

async function applyBankTransactionInterpretation(tx: DrizzleTransaction, input: ApplyBankTransactionInterpretationInput) {
  const loaded = await loadBankTransactionForCategorization(tx, {
    userId: input.userId,
    teamId: input.teamId,
    trustedScope: input.trustedScope,
    bankTransactionId: input.bankTransactionId,
  })
  if (input.teamId && loaded.teamId !== input.teamId) return false
  if (input.targetBankTransactionIds && !input.targetBankTransactionIds.includes(loaded.bankTransaction.id)) return false

  const existing = await loadExistingInterpretationForBankTransaction(tx, loaded.teamId, loaded.bankTransaction.id)

  const isAiCategorization = input.categorizedBy === 'ai'
  if (isAiCategorization && existing && isProtectedFromAiOverwrite(existing.ledgerTransaction)) {
    return false
  }

  if (input.requiredExistingStatus && existing && existing.ledgerTransaction.status !== input.requiredExistingStatus) {
    return false
  }

  const normalizedAiReasoning = isAiCategorization ? requireAiReasoning(input.aiReasoning) : null
  const now = new Date()
  const targetRevisionClaimed = input.expectedCategorizationRevision !== undefined
  if (targetRevisionClaimed) {
    await bumpCategorizationRevisions(tx, {
      bankTransactionIds: [loaded.bankTransaction.id],
      targetBankTransactionId: loaded.bankTransaction.id,
      expectedCategorizationRevision: input.expectedCategorizationRevision,
      now,
    })
  }
  const existingBankTransactionIds = existing ? await loadBankTransactionIdsForLedgerTransaction(tx, existing.ledgerTransaction.id) : []
  // Re-categorization updates the existing ledger transaction in place (reusing its id) rather than
  // deleting and re-inserting, so Zero syncs an update instead of a delete+insert and id-keyed lookups
  // stay stable. Postings are still fully rebuilt.
  const ledgerTransactionId = existing ? existing.ledgerTransaction.id : crypto.randomUUID()
  const writeFields = {
    ledgerTransactionId,
    teamId: loaded.teamId,
    userId: input.userId,
    date: loaded.bankTransaction.bookingDate ?? loaded.bankTransaction.valueDate,
    // Left null: the bank transaction owns the description for bank-import interpretations (see schema).
    description: null,
    status: input.status ?? 'confirmed',
    categorizedBy: input.categorizedBy ?? 'user',
    requiredExistingStatus: input.requiredExistingStatus,
    now,
  }

  if (input.interpretation.kind === 'transfer') {
    const transferTarget = 'counterBankTransactionId' in input.interpretation
      ? await loadTransferTargetForCounterBankTransaction(tx, {
          teamId: loaded.teamId,
          sourceBankTransactionId: loaded.bankTransaction.id,
          counterBankTransactionId: input.interpretation.counterBankTransactionId,
          sourceBankAccountId: loaded.bankTransaction.bankAccountId,
          sourceAmount: loaded.bankTransaction.amount,
          currency: loaded.bankTransaction.currency,
        })
      : await loadTransferTargetForLedgerAccount(tx, {
          teamId: loaded.teamId,
          sourceBankTransactionId: loaded.bankTransaction.id,
          transferLedgerAccountId: input.interpretation.accountId,
          sourceBankAccountId: loaded.bankTransaction.bankAccountId,
          sourceAmount: loaded.bankTransaction.amount,
          currency: loaded.bankTransaction.currency,
          sourceDate: loaded.bankTransaction.bookingDate ?? loaded.bankTransaction.valueDate,
        })

    // Claim and clear the existing interpretation before counter matching: the guarded UPDATE is the
    // optimistic-concurrency check and clearing its postings frees the previous counter for re-matching.
    if (existing) {
      const claimed = await claimExistingInterpretationForRewrite(tx, existing.ledgerTransaction.id, writeFields)
      if (!claimed) return false
    }

    const postings = buildBankTransactionTransferPostings({
      ledgerTransactionId,
      source: {
        bankTransactionId: loaded.bankTransaction.id,
        bankLedgerAccountId: loaded.sourceLedgerAccount.id,
        amount: loaded.bankTransaction.amount,
        currency: loaded.bankTransaction.currency,
      },
      targetLedgerAccountId: transferTarget.transferAccount.id,
      counterBankTransactionId: transferTarget.counterBankTransaction.id,
      now,
    })

    await writeRebuiltInterpretation(tx, {...writeFields, hasExisting: Boolean(existing), postings})
    if (isAiCategorization) {
      await recordBankTransactionAiResult(tx, loaded.bankTransaction.id, input.aiConfidence ?? null, normalizedAiReasoning, now)
    } else {
      await clearBankTransactionAiState(tx, loaded.bankTransaction.id, now)
    }
    await bumpCategorizationRevisions(tx, {
      bankTransactionIds: targetRevisionClaimed
        ? [...existingBankTransactionIds, transferTarget.counterBankTransaction.id].filter(id => id !== loaded.bankTransaction.id)
        : [...existingBankTransactionIds, loaded.bankTransaction.id, transferTarget.counterBankTransaction.id],
      now,
    })
    return true
  }

  const lines =
    input.interpretation.kind === 'category'
      ? [{accountId: input.interpretation.accountId, amount: formatMoneyDecimal(absoluteMoneyAmount(loaded.bankTransaction.amount), loaded.bankTransaction.currency)}]
      : input.interpretation.lines

  await validateCategorizationAccounts(tx, loaded.teamId, lines.map(line => line.accountId))
  if (existing) {
    const claimed = await claimExistingInterpretationForRewrite(tx, existing.ledgerTransaction.id, writeFields)
    if (!claimed) return false
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

  await writeRebuiltInterpretation(tx, {...writeFields, hasExisting: Boolean(existing), postings})
  if (isAiCategorization) {
    await recordBankTransactionAiResult(tx, loaded.bankTransaction.id, input.aiConfidence ?? null, normalizedAiReasoning, now)
  } else {
    await clearBankTransactionAiState(tx, loaded.bankTransaction.id, now)
  }
  await bumpCategorizationRevisions(tx, {
    bankTransactionIds: targetRevisionClaimed
      ? existingBankTransactionIds.filter(id => id !== loaded.bankTransaction.id)
      : [...existingBankTransactionIds, loaded.bankTransaction.id],
    now,
  })
  return true
}

async function recordUnableAgentInterpretation(tx: DrizzleTransaction, input: ApplyAgentBankTransactionInterpretationInput) {
  if (input.confidence !== 0) throw new Error('Unable interpretations require confidence 0')
  const normalizedAiReasoning = requireAiReasoning(input.reasoning)
  const loaded = await loadBankTransactionForCategorization(tx, {
    userId: input.userId,
    teamId: input.teamId,
    trustedScope: input.trustedScope,
    bankTransactionId: input.bankTransactionId,
  })
  if (loaded.teamId !== input.teamId) return false
  if (input.targetBankTransactionIds && !input.targetBankTransactionIds.includes(loaded.bankTransaction.id)) return false

  const existing = await loadExistingInterpretationForBankTransaction(tx, loaded.teamId, loaded.bankTransaction.id)
  if (existing && isProtectedFromAiOverwrite(existing.ledgerTransaction)) return false

  const now = new Date()
  await bumpCategorizationRevisions(tx, {
    bankTransactionIds: [loaded.bankTransaction.id],
    targetBankTransactionId: loaded.bankTransaction.id,
    expectedCategorizationRevision: input.expectedCategorizationRevision,
    now,
  })
  await recordBankTransactionAiResult(tx, loaded.bankTransaction.id, 0, normalizedAiReasoning, now)
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

  const transactionIds = uniq(rows.map(row => row.ledgerTransactionId))
  const bankTransactionIds = rows.flatMap(row => (row.bankPostingBankTransactionId ? [row.bankPostingBankTransactionId] : []))
  const now = new Date()
  await tx.delete(ledgerTransactions).where(inArray(ledgerTransactions.id, transactionIds))
  await bumpCategorizationRevisions(tx, {bankTransactionIds, now})

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

  await bumpCategorizationRevisions(tx, {
    bankTransactionIds: await loadBankTransactionIdsForLedgerTransaction(tx, ledgerTransaction.id),
    now,
  })
}


// Plain read, no row lock. Concurrency safety relies on the `ledger_postings.bankTransactionId`
// unique index (a second concurrent attempt to create an interpretation for the same bank transaction
// hits the constraint and rolls back) plus the guarded UPDATE in claimExistingInterpretationForRewrite
// (optimistic-concurrency check on re-categorization) and balance validation on every write. Concurrent
// writes to the same bank transaction resolve as last-writer-wins or roll back and retry rather than
// serializing on a shared lock — acceptable given low write concurrency.
async function loadBankTransactionForCategorization(
  tx: DrizzleTransaction,
  input: {userId: string; teamId?: string; trustedScope?: true; bankTransactionId: string},
): Promise<LoadedBankTransactionForCategorization> {
  const conditions = [eq(bankTransactions.id, input.bankTransactionId)]
  if (input.trustedScope && input.teamId) conditions.push(eq(bankAccounts.teamId, input.teamId))

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
      categorizationRevision: bankTransactions.categorizationRevision,
    },
    sourceLedgerAccount: {
      id: ledgerAccounts.id,
      linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
      teamId: ledgerAccounts.teamId,
    },
  }
  const [row] = input.trustedScope && input.teamId
    ? await tx
        .select(selection)
        .from(bankTransactions)
        .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.linkedBankAccountId, bankAccounts.id))
        .where(and(...conditions))
        .limit(1)
    : await tx
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

function isProtectedFromAiOverwrite(ledgerTransaction: {status: string; userConfirmedAt?: Date | null; userConfirmedBy?: string | null}) {
  return ledgerTransaction.status !== 'needs_review' || Boolean(ledgerTransaction.userConfirmedAt || ledgerTransaction.userConfirmedBy)
}

async function loadBankTransactionIdsForLedgerTransaction(tx: DrizzleTransaction, ledgerTransactionId: string) {
  const rows = await tx
    .select({bankTransactionId: ledgerPostings.bankTransactionId})
    .from(ledgerPostings)
    .where(and(eq(ledgerPostings.ledgerTransactionId, ledgerTransactionId), isNotNull(ledgerPostings.bankTransactionId)))

  return rows.flatMap(row => (row.bankTransactionId ? [row.bankTransactionId] : []))
}

type RewriteLedgerTransactionFields = {
  userId: string
  date: string | null
  description: string | null
  status: LedgerTransactionFinalStatus
  categorizedBy: LedgerTransactionCategorizedBy
  requiredExistingStatus?: LedgerTransactionFinalStatus
  now: Date
}

// Updates the existing ledger transaction row in place and clears its postings so they can be rebuilt
// under the same id. The guarded UPDATE doubles as the optimistic-concurrency check (returning false on
// a status mismatch). Ordering is critical: a bare `return false` does not roll back the surrounding
// db.transaction, so we must run the guarded UPDATE before deleting any postings — otherwise a failed
// guard would commit a transaction stripped of its postings. createdAt is preserved (only updatedAt moves).
async function claimExistingInterpretationForRewrite(tx: DrizzleTransaction, existingLedgerTransactionId: string, fields: RewriteLedgerTransactionFields) {
  const conditions = [eq(ledgerTransactions.id, existingLedgerTransactionId)]
  if (fields.requiredExistingStatus) {
    conditions.push(eq(ledgerTransactions.status, fields.requiredExistingStatus))
  }

  const [updated] = await tx
    .update(ledgerTransactions)
    .set({
      status: fields.status,
      categorizedBy: fields.categorizedBy,
      userConfirmedAt: fields.categorizedBy === 'ai' ? null : fields.now,
      userConfirmedBy: fields.categorizedBy === 'ai' ? null : fields.userId,
      date: fields.date,
      description: fields.description,
      updatedAt: fields.now,
    })
    .where(and(...conditions))
    .returning({id: ledgerTransactions.id})

  if (!updated) return false
  await tx.delete(ledgerPostings).where(eq(ledgerPostings.ledgerTransactionId, existingLedgerTransactionId))
  return true
}

async function writeRebuiltInterpretation(
  tx: DrizzleTransaction,
  input: {
    hasExisting: boolean
    ledgerTransactionId: string
    teamId: string
    userId: string
    date: string | null
    description: string | null
    status: LedgerTransactionFinalStatus
    categorizedBy: LedgerTransactionCategorizedBy
    now: Date
    postings: BuiltLedgerPosting[]
  },
) {
  if (input.hasExisting) {
    // The transaction row was already updated in place by claimExistingInterpretationForRewrite; only
    // the postings are rebuilt here.
    await tx.insert(ledgerPostings).values(input.postings)
    await validatePersistedTransactionBalance(tx, input.ledgerTransactionId)
    return
  }

  await insertBankImportLedgerInterpretation(tx, {
    ledgerTransactionId: input.ledgerTransactionId,
    teamId: input.teamId,
    userId: input.userId,
    date: input.date,
    description: input.description,
    postings: input.postings,
    status: input.status,
    categorizedBy: input.categorizedBy,
    now: input.now,
  })
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

async function loadTransferTargetForCounterBankTransaction(
  tx: DrizzleTransaction,
  input: {
    teamId: string
    sourceBankTransactionId: string
    counterBankTransactionId: string
    sourceBankAccountId: string
    sourceAmount: number
    currency: string
  },
) {
  const [row] = await tx
    .select({
      counterBankTransaction: {
        id: bankTransactions.id,
        bankAccountId: bankTransactions.bankAccountId,
        amount: bankTransactions.amount,
        currency: bankTransactions.currency,
      },
      transferAccount: {
        id: ledgerAccounts.id,
        teamId: ledgerAccounts.teamId,
        type: ledgerAccounts.type,
        status: ledgerAccounts.status,
        linkedBankAccountId: ledgerAccounts.linkedBankAccountId,
      },
      existingPostingId: ledgerPostings.id,
      teamId: bankAccounts.teamId,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.linkedBankAccountId, bankAccounts.id))
    .leftJoin(ledgerPostings, eq(ledgerPostings.bankTransactionId, bankTransactions.id))
    .where(eq(bankTransactions.id, input.counterBankTransactionId))
    .limit(1)

  if (
    !row ||
    row.teamId !== input.teamId ||
    row.transferAccount.teamId !== input.teamId ||
    row.transferAccount.type !== 'bank' ||
    row.transferAccount.status !== 'active' ||
    !row.transferAccount.linkedBankAccountId ||
    row.counterBankTransaction.id === input.sourceBankTransactionId ||
    row.counterBankTransaction.bankAccountId === input.sourceBankAccountId ||
    row.counterBankTransaction.amount !== -input.sourceAmount ||
    row.counterBankTransaction.currency !== input.currency ||
    row.existingPostingId
  ) {
    throw new Error('Invalid transfer counter transaction')
  }

  return {transferAccount: row.transferAccount, counterBankTransaction: row.counterBankTransaction}
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
    description: string | null
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

async function bumpCategorizationRevisions(
  tx: DrizzleTransaction,
  input: {
    bankTransactionIds: string[]
    targetBankTransactionId?: string
    expectedCategorizationRevision?: number
    now: Date
  },
) {
  const bankTransactionIds = uniq(input.bankTransactionIds)
  if (bankTransactionIds.length === 0) return

  if (input.expectedCategorizationRevision !== undefined && input.targetBankTransactionId) {
    const [updatedTarget] = await tx
      .update(bankTransactions)
      .set({
        categorizationRevision: sql`${bankTransactions.categorizationRevision} + 1`,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(bankTransactions.id, input.targetBankTransactionId),
          eq(bankTransactions.categorizationRevision, input.expectedCategorizationRevision),
        ),
      )
      .returning({id: bankTransactions.id})

    if (!updatedTarget) {
      const [current] = await tx
        .select({categorizationRevision: bankTransactions.categorizationRevision})
        .from(bankTransactions)
        .where(eq(bankTransactions.id, input.targetBankTransactionId))
        .limit(1)
      throw new CategorizationRevisionConflictError(
        input.targetBankTransactionId,
        input.expectedCategorizationRevision,
        current?.categorizationRevision ?? -1,
      )
    }

    const remainingIds = bankTransactionIds.filter(id => id !== input.targetBankTransactionId)
    if (remainingIds.length === 0) return
    await bumpCategorizationRevisions(tx, {bankTransactionIds: remainingIds, now: input.now})
    return
  }

  await tx
    .update(bankTransactions)
    .set({
      categorizationRevision: sql`${bankTransactions.categorizationRevision} + 1`,
      updatedAt: input.now,
    })
    .where(inArray(bankTransactions.id, bankTransactionIds))
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
    .set({aiConfidence, aiReasoning, updatedAt: now})
    .where(eq(bankTransactions.id, bankTransactionId))
}

async function clearBankTransactionAiState(tx: DrizzleTransaction, bankTransactionId: string, now: Date) {
  await tx
    .update(bankTransactions)
    .set({aiConfidence: null, aiReasoning: null, updatedAt: now})
    .where(eq(bankTransactions.id, bankTransactionId))
}

function requireAiReasoning(reasoning: string | null | undefined) {
  const normalizedReasoning = normalizeAiReasoning(reasoning ?? '')
  if (!normalizedReasoning) {
    throw new Error('AI reasoning is required')
  }
  return normalizedReasoning
}
