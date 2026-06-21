import '@tanstack/react-start/server-only'

import {and, desc, eq, isNotNull, ne} from 'drizzle-orm'
import {db} from '@/db/client'
import {bankAccounts, bankConnections, bankTransactions, ledgerAccounts, ledgerPostings, teamMembers} from '@/db/schema'
import {parseMoneyToScaledUnits} from '@/ledger/categorization'
import {ensureLedgerAccountForBankAccount} from '@/ledger/repository.server'
import type {GoCardlessAccountDetails} from './gocardless/types'
import type {BankAccountSyncRepository} from './sync'
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

  await db.transaction(async tx => {
    for (const providerAccountId of input.providerAccountIds) {
      const [account] = await tx
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
    .where(and(eq(bankAccounts.id, bankAccountId), eq(teamMembers.userId, userId)))
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
    .where(and(eq(teamMembers.userId, userId), eq(bankAccounts.status, 'linked')))
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
  const name = account?.displayName ?? account?.name ?? account?.product ?? account?.iban ?? 'Linked bank account'
  const now = new Date()

  await db
    .update(bankAccounts)
    .set({
      name,
      iban: account?.iban ?? null,
      currency: account?.currency ?? null,
      updatedAt: now,
    })
    .where(eq(bankAccounts.id, bankAccountId))

  const [bankAccount] = await db
    .select({teamId: bankAccounts.teamId})
    .from(bankAccounts)
    .where(eq(bankAccounts.id, bankAccountId))
    .limit(1)

  if (bankAccount) {
    await ensureLedgerAccountForBankAccount(db, {teamId: bankAccount.teamId, bankAccountId, name, now})
  }
}

type BankingSyncTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function guardProviderFactsAfterReconciliation(
  tx: BankingSyncTransaction,
  bankAccount: {id: string; teamId: string; provider: string},
  transaction: NormalizedBankTransaction,
) {
  // Provider transaction ids are scoped by provider/team here so a reconciled bank transaction cannot silently move across bank accounts.
  const [existing] = await tx
    .select({
      id: bankTransactions.id,
      bankAccountId: bankTransactions.bankAccountId,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      reconciledPostingId: ledgerPostings.id,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
    .leftJoin(ledgerPostings, eq(ledgerPostings.bankTransactionId, bankTransactions.id))
    .where(and(eq(bankAccounts.teamId, bankAccount.teamId), eq(bankAccounts.provider, bankAccount.provider), eq(bankTransactions.providerTransactionId, transaction.providerTransactionId)))
    .limit(1)

  if (!existing?.reconciledPostingId) return

  const bankAccountChanged = existing.bankAccountId !== bankAccount.id
  const amountChanged = parseMoneyToScaledUnits(existing.amount) !== parseMoneyToScaledUnits(transaction.amount)
  const currencyChanged = existing.currency !== transaction.currency
  if (bankAccountChanged || amountChanged || currencyChanged) {
    throw new Error('Imported bank transaction facts changed after reconciliation')
  }
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
        await guardProviderFactsAfterReconciliation(tx, bankAccount, transaction)

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
        void bankTransaction
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
