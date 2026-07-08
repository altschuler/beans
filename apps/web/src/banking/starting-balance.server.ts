import '@tanstack/react-start/server-only'

import {and, eq, inArray} from 'drizzle-orm'
import {parseDecimalMoneyToAmount} from '@penge/domain/money'
import {validateLedgerPostingsBalance} from '@penge/domain/categorization'
import type {Database} from '@/db/client'
import {bankAccounts, bankTransactions, ledgerAccounts, ledgerPostings, ledgerTransactions, teamMembers} from '@penge/domain/schema'
import {ensureLedgerAccountForBankAccount, requireSystemLedgerAccountId, SYSTEM_LEDGER_ACCOUNT_KEYS} from '@/ledger/repository.server'

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type StartingBalanceTransaction = Pick<DatabaseTransaction, 'select' | 'insert' | 'update' | 'delete'>

export async function setBankAccountStartingBalance(tx: StartingBalanceTransaction, input: {
  userId: string
  bankAccountId: string
  currentBalance: string
}) {
  const bankAccount = await loadAccessibleBankAccount(tx, input.bankAccountId, input.userId)
  const currency = requireCurrency(bankAccount.currency ?? '')
  const bankLedgerAccountId = bankAccount.ledgerAccountId ?? await ensureLedgerAccountForBankAccount(tx, {
    teamId: bankAccount.teamId,
    bankAccountId: bankAccount.id,
    name: bankAccount.name,
  })
  const openingBalancesAccountId = await requireSystemLedgerAccountId(tx, bankAccount.teamId, SYSTEM_LEDGER_ACCOUNT_KEYS.openingBalances)
  const bankTransactionRows = await tx
    .select({amount: bankTransactions.amount, currency: bankTransactions.currency, bookingDate: bankTransactions.bookingDate, valueDate: bankTransactions.valueDate})
    .from(bankTransactions)
    .where(eq(bankTransactions.bankAccountId, bankAccount.id))

  for (const transaction of bankTransactionRows) {
    if (transaction.currency !== currency) throw new Error('Bank transaction currency does not match bank account currency')
  }

  const currentBalance = parseDecimalMoneyToAmount(input.currentBalance)
  const importedMovement = bankTransactionRows.reduce((total, transaction) => total + transaction.amount, 0)
  const openingBalance = currentBalance - importedMovement
  const now = new Date()

  await deleteExistingOpeningBalanceTransactions(tx, {
    teamId: bankAccount.teamId,
    bankLedgerAccountId,
    openingBalancesAccountId,
  })

  if (openingBalance === 0) {
    return {created: false, amount: openingBalance, currency}
  }

  const ledgerTransactionId = crypto.randomUUID()
  const postings = [
    {
      id: crypto.randomUUID(),
      ledgerTransactionId,
      accountId: bankLedgerAccountId,
      amount: openingBalance,
      currency,
      bankTransactionId: null,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: crypto.randomUUID(),
      ledgerTransactionId,
      accountId: openingBalancesAccountId,
      amount: -openingBalance,
      currency,
      bankTransactionId: null,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    },
  ]
  validateLedgerPostingsBalance(postings)

  await tx.insert(ledgerTransactions).values({
    id: ledgerTransactionId,
    teamId: bankAccount.teamId,
    source: 'opening_balance',
    status: 'confirmed',
    categorizedBy: 'user',
    userConfirmedAt: now,
    userConfirmedBy: input.userId,
    date: openingBalanceDate(bankTransactionRows, now),
    description: `Starting balance for ${bankAccount.name}`,
    createdAt: now,
    updatedAt: now,
  })
  await tx.insert(ledgerPostings).values(postings)

  return {created: true, amount: openingBalance, currency}
}

async function loadAccessibleBankAccount(tx: StartingBalanceTransaction, bankAccountId: string, userId: string) {
  const [row] = await tx
    .select({
      id: bankAccounts.id,
      teamId: bankAccounts.teamId,
      name: bankAccounts.name,
      currency: bankAccounts.currency,
      ledgerAccountId: ledgerAccounts.id,
    })
    .from(bankAccounts)
    .innerJoin(teamMembers, eq(teamMembers.teamId, bankAccounts.teamId))
    .leftJoin(ledgerAccounts, eq(ledgerAccounts.linkedBankAccountId, bankAccounts.id))
    .where(and(eq(bankAccounts.id, bankAccountId), eq(teamMembers.userId, userId)))
    .limit(1)

  if (!row) throw new Error('Bank account not found')
  return row
}

async function deleteExistingOpeningBalanceTransactions(tx: StartingBalanceTransaction, input: {
  teamId: string
  bankLedgerAccountId: string
  openingBalancesAccountId: string
}) {
  const rows = await tx
    .select({
      ledgerTransactionId: ledgerTransactions.id,
      accountId: ledgerPostings.accountId,
      bankTransactionId: ledgerPostings.bankTransactionId,
    })
    .from(ledgerTransactions)
    .innerJoin(ledgerPostings, eq(ledgerPostings.ledgerTransactionId, ledgerTransactions.id))
    .where(and(eq(ledgerTransactions.teamId, input.teamId), eq(ledgerTransactions.source, 'opening_balance')))

  const postingsByTransactionId = new Map<string, Array<{accountId: string; bankTransactionId: string | null}>>()
  for (const row of rows) {
    const postings = postingsByTransactionId.get(row.ledgerTransactionId) ?? []
    postings.push({accountId: row.accountId, bankTransactionId: row.bankTransactionId})
    postingsByTransactionId.set(row.ledgerTransactionId, postings)
  }

  const transactionIds = [...postingsByTransactionId.entries()]
    .filter(([, postings]) =>
      postings.every(posting => posting.bankTransactionId === null) &&
      postings.some(posting => posting.accountId === input.bankLedgerAccountId) &&
      postings.some(posting => posting.accountId === input.openingBalancesAccountId),
    )
    .map(([transactionId]) => transactionId)

  if (transactionIds.length > 0) {
    await tx.delete(ledgerTransactions).where(inArray(ledgerTransactions.id, transactionIds))
  }
}

function openingBalanceDate(rows: Array<{bookingDate: string | null; valueDate: string | null}>, now: Date) {
  const firstImportedDate = rows
    .map(row => row.bookingDate ?? row.valueDate)
    .filter((date): date is string => Boolean(date))
    .sort()[0]

  if (!firstImportedDate) return now.toISOString().slice(0, 10)
  const date = new Date(`${firstImportedDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function requireCurrency(value: string) {
  const currency = value.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid bank account currency')
  return currency
}
