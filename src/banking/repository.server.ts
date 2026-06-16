import '@tanstack/react-start/server-only'

import {and, desc, eq, isNotNull, ne} from 'drizzle-orm'
import {db} from '@/db/client'
import {bankAccounts, bankConnections, bankTransactions, teamMembers} from '@/db/schema'
import type {GoCardlessAccountDetails} from './gocardless/types'
import type {BankingSyncRepository} from './sync'
import type {NormalizedBankTransaction} from './transactions'

export async function userCanAccessTeam(teamId: string, userId: string) {
  const [membership] = await db
    .select({id: teamMembers.id})
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1)
  return Boolean(membership)
}

export async function createBankConnection(input: {
  teamId: string
  providerInstitutionId: string
  providerRequisitionId: string
  reference: string
}) {
  const now = new Date()
  await db.insert(bankConnections).values({
    id: crypto.randomUUID(),
    teamId: input.teamId,
    provider: 'gocardless',
    providerInstitutionId: input.providerInstitutionId,
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

export async function upsertLinkedAccounts(input: {
  teamId: string
  bankConnectionId: string
  providerInstitutionId: string
  providerRequisitionId: string
  providerAccountIds: string[]
}) {
  const now = new Date()

  for (const providerAccountId of input.providerAccountIds) {
    await db
      .insert(bankAccounts)
      .values({
        id: crypto.randomUUID(),
        teamId: input.teamId,
        bankConnectionId: input.bankConnectionId,
        provider: 'gocardless',
        providerInstitutionId: input.providerInstitutionId,
        providerRequisitionId: input.providerRequisitionId,
        providerAccountId,
        name: 'Linked bank account',
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
          status: 'linked',
          updatedAt: now,
        },
      })
  }
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
    .where(and(eq(bankAccounts.id, bankAccountId), eq(teamMembers.userId, userId)))
    .limit(1)

  if (!account) {
    throw new Error('Bank account not found')
  }

  return account
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

export async function listBankAccountsForTeam(teamId: string, userId: string) {
  if (!(await userCanAccessTeam(teamId, userId))) {
    throw new Error('Team not found')
  }

  return db
    .select({
      id: bankAccounts.id,
      name: bankAccounts.name,
      iban: bankAccounts.iban,
      currency: bankAccounts.currency,
      status: bankAccounts.status,
      syncStatus: bankAccounts.syncStatus,
      syncError: bankAccounts.syncError,
      syncStartedAt: bankAccounts.syncStartedAt,
      lastSyncedAt: bankAccounts.lastSyncedAt,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.teamId, teamId))
    .orderBy(bankAccounts.name)
}

export async function listTransactionsForTeam(teamId: string, userId: string) {
  if (!(await userCanAccessTeam(teamId, userId))) {
    throw new Error('Team not found')
  }

  return db
    .select({
      id: bankTransactions.id,
      bankAccountId: bankTransactions.bankAccountId,
      accountName: bankAccounts.name,
      status: bankTransactions.status,
      bookingDate: bankTransactions.bookingDate,
      valueDate: bankTransactions.valueDate,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      description: bankTransactions.description,
      counterpartyName: bankTransactions.counterpartyName,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .where(eq(bankAccounts.teamId, teamId))
    .orderBy(desc(bankTransactions.bookingDate), desc(bankTransactions.createdAt))
    .limit(100)
}

export async function updateBankAccountDetails(bankAccountId: string, details: GoCardlessAccountDetails) {
  const account = details.account
  await db
    .update(bankAccounts)
    .set({
      name: account?.displayName ?? account?.name ?? account?.product ?? account?.iban ?? 'Linked bank account',
      iban: account?.iban ?? null,
      currency: account?.currency ?? null,
      updatedAt: new Date(),
    })
    .where(eq(bankAccounts.id, bankAccountId))
}

export const drizzleBankingSyncRepository: BankingSyncRepository = {
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
    const now = new Date()
    for (const transaction of transactions) {
      await db
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
    }
    return transactions.length
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
