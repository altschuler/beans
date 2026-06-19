import '@tanstack/react-start/server-only'

import {and, eq, inArray} from 'drizzle-orm'
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
import {buildBankLinkedCategorizationMovements, isCategorizationAccount, type CategorizationLineInput} from './categorization'

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DrizzleTransaction = DatabaseTransaction | ZeroDrizzleTransaction<Database>

type LedgerTransactionFinalStatus = 'confirmed' | 'needs_review'
type LedgerTransactionAiConfidence = 0 | 1 | 2

type CategorizeLedgerTransactionInput = {
  userId: string
  ledgerTransactionId: string
  status?: LedgerTransactionFinalStatus
  aiConfidence?: LedgerTransactionAiConfidence | null
  requiredCurrentStatus?: LedgerTransactionFinalStatus
} & ({accountId: string; lines?: never} | {accountId?: never; lines: CategorizationLineInput[]})

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

  const lines: CategorizationLineInput[] = input.accountId !== undefined ? [{accountId: input.accountId, amount: absoluteMoneyString(bankTransaction.amount)}] : input.lines
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

  const nextTransactionValues = {
    status: input.status ?? 'confirmed',
    aiConfidence: input.aiConfidence ?? null,
    aiProcessingStartedAt: null,
    updatedAt: new Date(),
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

function absoluteMoneyString(amount: string) {
  return amount.trim().replace(/^[+-]/, '')
}
