import {defineMutator, defineMutators, type Transaction} from '@rocicorp/zero'
import {groupBy, uniq} from 'lodash-es'
import {z} from 'zod'
import {absoluteMoneyAmount} from '@/lib/money'
import {isCategorizationAccount, validateBankLinkedCategorizationLines, type CategorizationLineInput} from '@/ledger/categorization'
import {requireUserID} from './context'
import {zql, type BankTransaction, type LedgerAccount, type LedgerPosting, type LedgerTransaction, type Schema as ZeroSchema} from './schema'

export const categorySelectionInput = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('category'), accountId: z.string().min(1)}),
  z.object({kind: z.literal('transfer'), accountId: z.string().min(1)}),
])

export const categorizeTransactionInput = z.object({
  bankTransactionId: z.string().min(1),
  selection: categorySelectionInput,
})

export const splitTransactionInput = z.object({
  bankTransactionId: z.string().min(1),
  lines: z
    .array(
      z.object({
        accountId: z.string().min(1),
        amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
      }),
    )
    .min(2),
})

export const confirmTransactionInput = z.object({
  bankTransactionId: z.string().min(1),
})

export const clearCategorizationsInput = z.object({})

export const managedCategoryTypeInput = z.enum(['expense', 'income', 'savings'])

const trimmedNonEmptyString = z.string().trim().min(1)

export const createCategoryAccountInput = z.object({
  id: trimmedNonEmptyString,
  teamId: trimmedNonEmptyString,
  groupId: trimmedNonEmptyString,
  name: trimmedNonEmptyString,
  description: z.string(),
  type: managedCategoryTypeInput,
})

export const updateCategoryAccountInput = z.object({
  accountId: trimmedNonEmptyString,
  groupId: trimmedNonEmptyString,
  name: trimmedNonEmptyString,
  description: z.string(),
  type: managedCategoryTypeInput,
})

export const deleteCategoryAccountInput = z.object({
  accountId: trimmedNonEmptyString,
})

export const createCategoryGroupInput = z.object({
  id: trimmedNonEmptyString,
  teamId: trimmedNonEmptyString,
  name: trimmedNonEmptyString,
})

export const updateCategoryGroupInput = z.object({
  groupId: trimmedNonEmptyString,
  name: trimmedNonEmptyString,
})

export const deleteCategoryGroupInput = z.object({
  groupId: trimmedNonEmptyString,
})

type ClientTx = Extract<Transaction<ZeroSchema>, {location: 'client'}>
type OptimisticLine = {accountId: string; amountUnits: number}
type ExistingInterpretation = {transaction: LedgerTransaction; postings: readonly LedgerPosting[]}

const AI_PROCESSING_STALE_AFTER_MS = 30 * 60 * 1000

async function optimisticallyCategorizeTransaction(input: {
  tx: ClientTx
  userId: string
  bankTransactionId: string
  accountId: string
}) {
  const loaded = await loadOptimisticCategorizationBase(input.tx, input.bankTransactionId)
  if (!loaded) return

  const categoryAccount = await input.tx.run(zql.ledgerAccounts.where('id', input.accountId).one())
  if (!isValidOptimisticCategoryAccount(categoryAccount, loaded.sourceLedgerAccount.teamId)) return

  await rewriteOptimisticInterpretation({
    tx: input.tx,
    userId: input.userId,
    bankTransaction: loaded.bankTransaction,
    sourceLedgerAccount: loaded.sourceLedgerAccount,
    existing: loaded.existing,
    lines: [{accountId: input.accountId, amountUnits: absoluteMoneyAmount(loaded.bankTransaction.amount)}],
  })
}

async function optimisticallySplitTransaction(input: {
  tx: ClientTx
  userId: string
  bankTransactionId: string
  lines: CategorizationLineInput[]
}) {
  const loaded = await loadOptimisticCategorizationBase(input.tx, input.bankTransactionId)
  if (!loaded) return

  let lineUnits: number[]
  try {
    lineUnits = validateBankLinkedCategorizationLines({bankAmount: loaded.bankTransaction.amount, lines: input.lines}).lineUnits
  } catch {
    return
  }
  const accountIds = uniq(input.lines.map(line => line.accountId))
  const accounts = await Promise.all(accountIds.map(accountId => input.tx.run(zql.ledgerAccounts.where('id', accountId).one())))
  if (accounts.some(account => !isValidOptimisticCategoryAccount(account, loaded.sourceLedgerAccount.teamId))) return

  await rewriteOptimisticInterpretation({
    tx: input.tx,
    userId: input.userId,
    bankTransaction: loaded.bankTransaction,
    sourceLedgerAccount: loaded.sourceLedgerAccount,
    existing: loaded.existing,
    lines: input.lines.map((line, index) => ({accountId: line.accountId, amountUnits: lineUnits[index] ?? 0})),
  })
}

async function loadOptimisticCategorizationBase(tx: ClientTx, bankTransactionId: string) {
  const bankTransaction = await tx.run(zql.bankTransactions.where('id', bankTransactionId).one())
  if (!bankTransaction || isRecentlyProcessing(bankTransaction.aiProcessingStartedAt ?? null)) return null

  const sourceLedgerAccount = await tx.run(zql.ledgerAccounts.where('linkedBankAccountId', bankTransaction.bankAccountId).one())
  if (!sourceLedgerAccount || sourceLedgerAccount.linkedBankAccountId !== bankTransaction.bankAccountId) return null

  const bankPosting = await tx.run(zql.ledgerPostings.where('bankTransactionId', bankTransactionId).one())
  if (!bankPosting) return {bankTransaction, sourceLedgerAccount, existing: null}

  const transaction = await tx.run(zql.ledgerTransactions.where('id', bankPosting.ledgerTransactionId).one())
  if (!transaction || transaction.source !== 'bank_import') return null

  const postings = await tx.run(zql.ledgerPostings.where('ledgerTransactionId', transaction.id))
  return {bankTransaction, sourceLedgerAccount, existing: {transaction, postings}}
}

async function rewriteOptimisticInterpretation(input: {
  tx: ClientTx
  userId: string
  bankTransaction: BankTransaction
  sourceLedgerAccount: LedgerAccount
  existing: ExistingInterpretation | null
  lines: OptimisticLine[]
}) {
  const now = Date.now()
  const ledgerTransactionId = input.existing?.transaction.id ?? optimisticId(input.tx, `ledger-transaction:${input.bankTransaction.id}`)
  const transactionFields = {
    id: ledgerTransactionId,
    teamId: input.sourceLedgerAccount.teamId,
    source: 'bank_import',
    status: 'confirmed',
    categorizedBy: 'user',
    userConfirmedAt: now,
    userConfirmedBy: input.userId,
    date: input.bankTransaction.bookingDate ?? input.bankTransaction.valueDate ?? null,
    description: null,
    updatedAt: now,
  }

  if (input.existing) {
    await input.tx.mutate.ledgerTransactions.update(transactionFields)
    for (const posting of input.existing.postings) {
      await input.tx.mutate.ledgerPostings.delete({id: posting.id})
    }
  } else {
    await input.tx.mutate.ledgerTransactions.insert({...transactionFields, createdAt: now})
  }

  const explanatorySign = input.bankTransaction.amount > 0 ? -1 : 1
  const postings = [
    {
      id: optimisticId(input.tx, 'posting:0'),
      ledgerTransactionId,
      accountId: input.sourceLedgerAccount.id,
      amount: input.bankTransaction.amount,
      currency: input.bankTransaction.currency,
      bankTransactionId: input.bankTransaction.id,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
    ...input.lines.map((line, index) => ({
      id: optimisticId(input.tx, `posting:${index + 1}`),
      ledgerTransactionId,
      accountId: line.accountId,
      amount: line.amountUnits * explanatorySign,
      currency: input.bankTransaction.currency,
      bankTransactionId: null,
      sortOrder: index + 1,
      createdAt: now,
      updatedAt: now,
    })),
  ]

  for (const posting of postings) {
    await input.tx.mutate.ledgerPostings.insert(posting)
  }

  await input.tx.mutate.bankTransactions.update({
    id: input.bankTransaction.id,
    aiConfidence: null,
    aiReasoning: null,
    aiProcessingStartedAt: null,
    updatedAt: now,
  })
}

async function optimisticallyConfirmTransaction(input: {tx: ClientTx; userId: string; bankTransactionId: string}) {
  const bankTransaction = await input.tx.run(zql.bankTransactions.where('id', input.bankTransactionId).one())
  if (bankTransaction && isRecentlyProcessing(bankTransaction.aiProcessingStartedAt ?? null)) return

  const bankPosting = await input.tx.run(zql.ledgerPostings.where('bankTransactionId', input.bankTransactionId).one())
  if (!bankPosting) return
  const transaction = await input.tx.run(zql.ledgerTransactions.where('id', bankPosting.ledgerTransactionId).one())
  if (!transaction || transaction.source !== 'bank_import') return

  const now = Date.now()
  await input.tx.mutate.ledgerTransactions.update({
    id: transaction.id,
    status: 'confirmed',
    userConfirmedAt: now,
    userConfirmedBy: input.userId,
    updatedAt: now,
  })
}

async function optimisticallyClearCategorizations(tx: ClientTx) {
  const ledgerTransactions = await tx.run(zql.ledgerTransactions.where('source', 'bank_import'))
  const postings = await tx.run(zql.ledgerPostings)
  const postingsByTransactionId = groupBy(postings, posting => posting.ledgerTransactionId)

  for (const transaction of ledgerTransactions) {
    const transactionPostings = postingsByTransactionId[transaction.id] ?? []
    if (!transactionPostings.some(posting => posting.bankTransactionId)) continue
    for (const posting of transactionPostings) {
      await tx.mutate.ledgerPostings.delete({id: posting.id})
    }
    await tx.mutate.ledgerTransactions.delete({id: transaction.id})
  }
}

function isValidOptimisticCategoryAccount(account: LedgerAccount | undefined, teamId: string) {
  return Boolean(account && account.teamId === teamId && isCategorizationAccount({...account, status: account.status ?? 'active'}))
}

function isRecentlyProcessing(value: Date | string | number | null) {
  if (!value) return false
  const startedAt = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(startedAt.getTime())) return false
  return Date.now() - startedAt.getTime() <= AI_PROCESSING_STALE_AFTER_MS
}

function optimisticId(tx: ClientTx, suffix: string) {
  return `optimistic:${tx.clientID}:${tx.mutationID}:${suffix}`
}

export const mutators = defineMutators({
  ledger: {
    categorizeTransaction: defineMutator(categorizeTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'client') return
      if (args.selection.kind === 'transfer') {
        // Transfer optimism requires reproducing server-side counter-transaction matching; keep it
        // server-authoritative so failed matches do not briefly show a made-up transfer.
        return
      }
      await optimisticallyCategorizeTransaction({
        tx,
        userId: requireUserID(ctx),
        bankTransactionId: args.bankTransactionId,
        accountId: args.selection.accountId,
      })
    }),
    splitTransaction: defineMutator(splitTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'client') return
      await optimisticallySplitTransaction({tx, userId: requireUserID(ctx), bankTransactionId: args.bankTransactionId, lines: args.lines})
    }),
    confirmTransaction: defineMutator(confirmTransactionInput, async ({args, ctx, tx}) => {
      if (tx.location !== 'client') return
      await optimisticallyConfirmTransaction({tx, userId: requireUserID(ctx), bankTransactionId: args.bankTransactionId})
    }),
    clearCategorizations: defineMutator(clearCategorizationsInput, async ({tx}) => {
      if (tx.location !== 'client') return
      await optimisticallyClearCategorizations(tx)
    }),
    createCategoryAccount: defineMutator(createCategoryAccountInput, async () => {}),
    updateCategoryAccount: defineMutator(updateCategoryAccountInput, async () => {}),
    deleteCategoryAccount: defineMutator(deleteCategoryAccountInput, async () => {}),
    createCategoryGroup: defineMutator(createCategoryGroupInput, async () => {}),
    updateCategoryGroup: defineMutator(updateCategoryGroupInput, async () => {}),
    deleteCategoryGroup: defineMutator(deleteCategoryGroupInput, async () => {}),
  },
})
