import '@tanstack/react-start/server-only'

import {and, desc, eq, isNotNull, isNull, ne} from 'drizzle-orm'
import {parseDecimalMoneyToAmount} from '@penge/domain/money'
import {ensureUncategorizedBankImportInterpretation, refreshUncategorizedBankImportInterpretation} from '@penge/domain/categorization-service'
import {db} from '@/db/client'
import {bankAccounts, bankConnections, bankTransactions, ledgerAccounts, ledgerPostings, ledgerTransactions, teamMembers} from '@penge/domain/schema'
import {ensureLedgerAccountForBankAccount} from '@/ledger/repository.server'
import {alias} from 'drizzle-orm/pg-core'
import type {GoCardlessAccountDetails} from './gocardless/types'
import type {BankAccountSyncRepository} from './sync'
import type {NormalizedBankTransaction} from './transactions'

export async function createBankConnection(input: {
  teamId: string
  providerInstitutionId: string
  providerInstitutionName?: string | null
  providerInstitutionLogoUrl?: string | null
  providerRequisitionId: string
  reference: string
}) {
  const now = new Date()
  await db.insert(bankConnections).values({
    id: crypto.randomUUID(),
    teamId: input.teamId,
    provider: 'gocardless',
    providerInstitutionId: input.providerInstitutionId,
    providerInstitutionName: input.providerInstitutionName ?? null,
    providerInstitutionLogoUrl: input.providerInstitutionLogoUrl ?? null,
    providerRequisitionId: input.providerRequisitionId,
    reference: input.reference,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  })
}

export async function findBankConnectionByReference(reference: string) {
  const [connection] = await db
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.provider, 'gocardless'), eq(bankConnections.reference, reference)))
    .limit(1)
  return connection ?? null
}

export async function markBankConnectionLinked(connectionId: string) {
  await db.update(bankConnections).set({status: 'linked', updatedAt: new Date()}).where(eq(bankConnections.id, connectionId))
}

const MANUAL_ACCOUNT_TYPES = ['checking', 'savings', 'credit-card', 'loan', 'cash'] as const

type ManualAccountType = typeof MANUAL_ACCOUNT_TYPES[number]
type BankingCommandTransaction = Pick<BankingSyncTransaction, 'select' | 'insert' | 'update' | 'delete'>
type DomainCategorizationTransaction = Parameters<typeof ensureUncategorizedBankImportInterpretation>[0]

export async function createManualBankAccount(tx: BankingCommandTransaction, input: {
  userId: string
  id: string
  ledgerAccountId: string
  teamId: string
  name: string
  accountType: string
  currency: string
  notes: string
}) {
  await requireTeamAccess(tx, input.teamId, input.userId)
  const name = requireNonEmpty(input.name, 'Account name is required')
  const accountType = requireManualAccountType(input.accountType)
  const currency = requireCurrency(input.currency)
  const notes = input.notes.trim()
  const now = new Date()

  await tx.insert(bankAccounts).values({
    id: requireNonEmpty(input.id, 'Bank account id is required'),
    teamId: input.teamId,
    bankConnectionId: null,
    provider: 'manual',
    providerInstitutionId: 'manual',
    providerRequisitionId: `manual:${input.teamId}`,
    providerAccountId: `manual:${input.id}`,
    name,
    iban: null,
    currency,
    providerAccountRaw: {source: 'manual', accountType, notes},
    status: 'linked',
    syncStatus: 'idle',
    syncError: null,
    syncStartedAt: null,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  await ensureLedgerAccountForBankAccount(tx, {
    id: requireNonEmpty(input.ledgerAccountId, 'Ledger account id is required'),
    teamId: input.teamId,
    bankAccountId: input.id,
    name,
    description: notes,
    now,
  })
}

export async function createManualTransaction(tx: BankingCommandTransaction, input: {
  userId: string
  id: string
  bankAccountId: string
  date: string
  description: string
  amount: string
}) {
  const account = await loadAccessibleBankAccountForManualTransaction(tx, input.bankAccountId, input.userId)
  if (account.provider !== 'manual') throw new Error('Manual transactions can only be added to manual accounts')
  const currency = requireCurrency(account.currency ?? '')
  const bookingDate = requireIsoDate(input.date)
  const description = requireNonEmpty(input.description, 'Description is required')
  const amount = parseDecimalMoneyToAmount(input.amount)
  if (amount === 0) throw new Error('Amount must be non-zero')

  const now = new Date()
  await tx.insert(bankTransactions).values({
    id: requireNonEmpty(input.id, 'Transaction id is required'),
    bankAccountId: account.id,
    providerTransactionId: `manual:${input.id}`,
    status: 'booked',
    bookingDate,
    valueDate: null,
    amount,
    currency,
    description,
    counterpartyName: null,
    raw: {source: 'manual'},
    aiConfidence: null,
    aiReasoning: null,
    createdAt: now,
    updatedAt: now,
  })
  await ensureUncategorizedBankImportInterpretation(tx as DomainCategorizationTransaction, {bankTransactionId: input.id, now})
}

async function requireTeamAccess(tx: BankingCommandTransaction, teamId: string, userId: string) {
  const [membership] = await tx
    .select({id: teamMembers.id})
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1)
  if (!membership) throw new Error('Team not found')
}

async function loadAccessibleBankAccountForManualTransaction(tx: BankingCommandTransaction, bankAccountId: string, userId: string) {
  const [account] = await tx
    .select({
      id: bankAccounts.id,
      provider: bankAccounts.provider,
      currency: bankAccounts.currency,
    })
    .from(bankAccounts)
    .innerJoin(teamMembers, eq(teamMembers.teamId, bankAccounts.teamId))
    .where(and(eq(bankAccounts.id, bankAccountId), eq(teamMembers.userId, userId)))
    .limit(1)

  if (!account) throw new Error('Bank account not found')
  return account
}

function requireNonEmpty(value: string, message: string) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(message)
  return trimmed
}

function requireManualAccountType(value: string): ManualAccountType {
  if (!(MANUAL_ACCOUNT_TYPES as readonly string[]).includes(value)) throw new Error('Invalid account type')
  return value as ManualAccountType
}

function requireCurrency(value: string) {
  const currency = value.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency')
  return currency
}

function requireIsoDate(value: string) {
  const date = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date')
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Invalid date')
  return date
}

export async function upsertLinkedAccounts(input: {
  teamId: string
  bankConnectionId: string
  providerInstitutionId: string
  providerRequisitionId: string
  providerAccounts: Array<{providerAccountId: string; details?: GoCardlessAccountDetails}>
}) {
  const now = new Date()

  await db.transaction(async tx => {
    for (const providerAccount of input.providerAccounts) {
      const details = bankAccountDetailsForStorage(providerAccount.details)
      const [account] = await tx
        .insert(bankAccounts)
        .values({
          id: crypto.randomUUID(),
          teamId: input.teamId,
          bankConnectionId: input.bankConnectionId,
          provider: 'gocardless',
          providerInstitutionId: input.providerInstitutionId,
          providerRequisitionId: input.providerRequisitionId,
          providerAccountId: providerAccount.providerAccountId,
          name: details.name,
          iban: details.iban,
          currency: details.currency,
          providerAccountRaw: details.raw,
          status: 'linked',
          syncStatus: 'idle',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [bankAccounts.provider, bankAccounts.teamId, bankAccounts.providerAccountId],
          set: {
            teamId: input.teamId,
            bankConnectionId: input.bankConnectionId,
            providerInstitutionId: input.providerInstitutionId,
            providerRequisitionId: input.providerRequisitionId,
            name: details.name,
            iban: details.iban,
            currency: details.currency,
            providerAccountRaw: details.raw,
            status: 'linked',
            updatedAt: now,
          },
        })
        .returning({id: bankAccounts.id, name: bankAccounts.name})

      await ensureLedgerAccountForBankAccount(tx, {
        teamId: input.teamId,
        bankAccountId: account.id,
        name: account.name,
        now,
      })
    }
  })
}

export async function requireAccessibleBankAccount(bankAccountId: string, userId: string) {
  const [account] = await db
    .select({
      id: bankAccounts.id,
      providerAccountId: bankAccounts.providerAccountId,
      name: bankAccounts.name,
    })
    .from(bankAccounts)
    .innerJoin(teamMembers, eq(teamMembers.teamId, bankAccounts.teamId))
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.provider, 'gocardless'), eq(teamMembers.userId, userId)))
    .limit(1)

  if (!account) {
    throw new Error('Bank account not found')
  }

  return account
}

export async function listAccessibleBankAccountsForSync(userId: string) {
  return db
    .select({
      id: bankAccounts.id,
      name: bankAccounts.name,
      providerAccountId: bankAccounts.providerAccountId,
    })
    .from(bankAccounts)
    .innerJoin(teamMembers, eq(teamMembers.teamId, bankAccounts.teamId))
    .where(and(eq(teamMembers.userId, userId), eq(bankAccounts.status, 'linked'), eq(bankAccounts.provider, 'gocardless')))
    .orderBy(bankAccounts.name)
}

export async function claimBankAccountSync(bankAccountId: string) {
  const now = new Date()
  const [claimed] = await db
    .update(bankAccounts)
    .set({
      syncStatus: 'syncing',
      syncError: null,
      syncStartedAt: now,
      updatedAt: now,
    })
    .where(and(eq(bankAccounts.id, bankAccountId), ne(bankAccounts.syncStatus, 'syncing')))
    .returning({id: bankAccounts.id})

  return Boolean(claimed)
}

export async function updateBankAccountDetails(bankAccountId: string, details: GoCardlessAccountDetails) {
  const storedDetails = bankAccountDetailsForStorage(details)
  const now = new Date()

  await db
    .update(bankAccounts)
    .set({
      name: storedDetails.name,
      iban: storedDetails.iban,
      currency: storedDetails.currency,
      providerAccountRaw: storedDetails.raw,
      updatedAt: now,
    })
    .where(eq(bankAccounts.id, bankAccountId))

  const [bankAccount] = await db
    .select({teamId: bankAccounts.teamId})
    .from(bankAccounts)
    .where(eq(bankAccounts.id, bankAccountId))
    .limit(1)

  if (bankAccount) {
    await ensureLedgerAccountForBankAccount(db, {teamId: bankAccount.teamId, bankAccountId, name: storedDetails.name, now})
  }
}

function bankAccountDetailsForStorage(details?: GoCardlessAccountDetails) {
  const account = details?.account
  return {
    name: account?.displayName ?? account?.name ?? account?.product ?? account?.iban ?? 'Linked bank account',
    iban: account?.iban ?? null,
    currency: account?.currency ?? null,
    raw: details ?? null,
  }
}

type BankingSyncTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

const bankLinkedPostings = alias(ledgerPostings, 'bank_linked_postings')
const uncategorizedPostings = alias(ledgerPostings, 'uncategorized_postings')
const uncategorizedAccounts = alias(ledgerAccounts, 'uncategorized_accounts')

async function guardProviderFactsAfterReconciliation(
  tx: BankingSyncTransaction,
  bankAccount: {id: string; teamId: string; provider: string},
  transaction: NormalizedBankTransaction,
): Promise<{id: string; factsChanged: boolean} | null> {
  const [existing] = await tx
    .select({
      id: bankTransactions.id,
      bankAccountId: bankTransactions.bankAccountId,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      ledgerTransactionId: ledgerTransactions.id,
      uncategorizedPostingId: uncategorizedPostings.id,
      uncategorizedSystemKey: uncategorizedAccounts.systemKey,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .leftJoin(bankLinkedPostings, eq(bankLinkedPostings.bankTransactionId, bankTransactions.id))
    .leftJoin(ledgerTransactions, eq(ledgerTransactions.id, bankLinkedPostings.ledgerTransactionId))
    .leftJoin(uncategorizedPostings, and(eq(uncategorizedPostings.ledgerTransactionId, ledgerTransactions.id), isNull(uncategorizedPostings.bankTransactionId)))
    .leftJoin(uncategorizedAccounts, eq(uncategorizedAccounts.id, uncategorizedPostings.accountId))
    .where(and(eq(bankAccounts.teamId, bankAccount.teamId), eq(bankAccounts.provider, bankAccount.provider), eq(bankTransactions.providerTransactionId, transaction.providerTransactionId)))
    .limit(1)

  if (!existing) return null

  const bankAccountChanged = existing.bankAccountId !== bankAccount.id
  const amountChanged = existing.amount !== transaction.amount
  const currencyChanged = existing.currency !== transaction.currency
  const factsChanged = bankAccountChanged || amountChanged || currencyChanged
  if (!existing.ledgerTransactionId) return {id: existing.id, factsChanged}

  const isUncategorized = existing.uncategorizedSystemKey === 'uncategorized'
  if (!isUncategorized && factsChanged) {
    throw new Error('Imported bank transaction facts changed after reconciliation')
  }
  return {id: existing.id, factsChanged}
}

async function updateExistingProviderBankTransaction(
  tx: BankingSyncTransaction,
  bankTransactionId: string,
  bankAccountId: string,
  transaction: NormalizedBankTransaction,
  now: Date,
) {
  const [bankTransaction] = await tx
    .update(bankTransactions)
    .set({
      bankAccountId,
      status: transaction.status,
      bookingDate: transaction.bookingDate,
      valueDate: transaction.valueDate,
      amount: transaction.amount,
      currency: transaction.currency,
      description: transaction.description,
      counterpartyName: transaction.counterpartyName,
      raw: transaction.raw,
      updatedAt: now,
    })
    .where(eq(bankTransactions.id, bankTransactionId))
    .returning({id: bankTransactions.id})
  if (!bankTransaction) throw new Error('Bank transaction not found')
  return bankTransaction
}

async function insertProviderBankTransaction(
  tx: BankingSyncTransaction,
  bankAccountId: string,
  transaction: NormalizedBankTransaction,
  now: Date,
) {
  const [bankTransaction] = await tx
    .insert(bankTransactions)
    .values({
      id: crypto.randomUUID(),
      bankAccountId,
      providerTransactionId: transaction.providerTransactionId,
      status: transaction.status,
      bookingDate: transaction.bookingDate,
      valueDate: transaction.valueDate,
      amount: transaction.amount,
      currency: transaction.currency,
      description: transaction.description,
      counterpartyName: transaction.counterpartyName,
      raw: transaction.raw,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [bankTransactions.bankAccountId, bankTransactions.providerTransactionId],
      set: {
        status: transaction.status,
        bookingDate: transaction.bookingDate,
        valueDate: transaction.valueDate,
        amount: transaction.amount,
        currency: transaction.currency,
        description: transaction.description,
        counterpartyName: transaction.counterpartyName,
        raw: transaction.raw,
        updatedAt: now,
      },
    })
    .returning({id: bankTransactions.id})
  if (!bankTransaction) throw new Error('Bank transaction not found')
  return bankTransaction
}

export const drizzleBankingSyncRepository: BankAccountSyncRepository = {
  claimBankAccountSync,
  updateBankAccountDetails,
  async latestTransactionDate(bankAccountId) {
    const [latest] = await db
      .select({date: bankTransactions.bookingDate})
      .from(bankTransactions)
      .where(and(eq(bankTransactions.bankAccountId, bankAccountId), isNotNull(bankTransactions.bookingDate)))
      .orderBy(desc(bankTransactions.bookingDate))
      .limit(1)
    return latest?.date ?? null
  },
  async upsertTransactions(bankAccountId, transactions: NormalizedBankTransaction[]) {
    return db.transaction(async tx => {
      const [bankAccount] = await tx
        .select({
          id: bankAccounts.id,
          teamId: bankAccounts.teamId,
          name: bankAccounts.name,
          provider: bankAccounts.provider,
          ledgerAccountId: ledgerAccounts.id,
        })
        .from(bankAccounts)
        .leftJoin(ledgerAccounts, eq(ledgerAccounts.linkedBankAccountId, bankAccounts.id))
        .where(eq(bankAccounts.id, bankAccountId))
        .limit(1)

      if (!bankAccount) {
        throw new Error('Bank account not found')
      }

      const bankLedgerAccountId =
        bankAccount.ledgerAccountId ??
        (await ensureLedgerAccountForBankAccount(tx, {
          teamId: bankAccount.teamId,
          bankAccountId: bankAccount.id,
          name: bankAccount.name,
        }))
      void bankLedgerAccountId

      const now = new Date()
      for (const transaction of transactions) {
        const existingBankTransaction = await guardProviderFactsAfterReconciliation(tx, bankAccount, transaction)

        const bankTransaction = existingBankTransaction
          ? await updateExistingProviderBankTransaction(tx, existingBankTransaction.id, bankAccount.id, transaction, now)
          : await insertProviderBankTransaction(tx, bankAccount.id, transaction, now)

        await ensureUncategorizedBankImportInterpretation(tx, {bankTransactionId: bankTransaction.id, now})
        const refreshed = await refreshUncategorizedBankImportInterpretation(tx, {bankTransactionId: bankTransaction.id, now})
        if (existingBankTransaction?.factsChanged && !refreshed) {
          throw new Error('Imported bank transaction facts changed after reconciliation')
        }
      }

      return transactions.length
    })
  },
  async markAccountSynced(bankAccountId) {
    const now = new Date()
    await db
      .update(bankAccounts)
      .set({
        syncStatus: 'idle',
        syncError: null,
        syncStartedAt: null,
        lastSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(bankAccounts.id, bankAccountId))
  },
  async markAccountSyncFailed(bankAccountId, message) {
    await db
      .update(bankAccounts)
      .set({
        syncStatus: 'error',
        syncError: message,
        syncStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(bankAccounts.id, bankAccountId))
  },
}
