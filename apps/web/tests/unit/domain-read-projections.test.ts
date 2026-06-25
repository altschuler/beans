import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {db} from '@/db/client'
import {bankAccounts, bankTransactions, ledgerAccountGroups, ledgerAccounts, teamMembers, teams, user} from '@penge/domain/schema'
import {closeDatabase, migrateDatabase, resetDatabase} from '@/tests/helpers/db'
import {searchBankTransactions} from '@penge/domain/read-projections'

const now = new Date('2026-06-25T10:00:00.000Z')

beforeAll(async () => {
  await migrateDatabase()
})

beforeEach(async () => {
  await resetDatabase()
  await seedProjectionFixture()
})

afterAll(async () => {
  await closeDatabase()
})

describe('domain read projections', () => {
  it('scopes bank transaction search by trusted user and team and returns compact fields', async () => {
    const rows = await searchBankTransactions(db, {
      userId: 'user-1',
      teamId: 'team-1',
      filters: {reviewStatus: 'any', limit: 10},
    })

    expect(rows.map(row => row.id)).toEqual(['bank-transaction-1'])
    expect(rows[0]).toMatchObject({
      id: 'bank-transaction-1',
      bankAccountId: 'bank-account-1',
      bankAccountName: 'Checking',
      date: '2026-06-25',
      amount: -1_000_000,
      currency: 'DKK',
      description: 'Supermarket purchase',
      counterpartyName: 'Supermarket',
      reviewStatus: 'uncategorized',
      categorizationRevision: 7,
      canWrite: true,
    })
    expect(rows[0]).not.toHaveProperty('raw')
  })

  it('marks rows outside target constraints as not writable while still readable', async () => {
    const rows = await searchBankTransactions(db, {
      userId: 'user-1',
      teamId: 'team-1',
      targetBankTransactionIds: ['some-other-target'],
      filters: {reviewStatus: 'any', limit: 10},
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.canWrite).toBe(false)
  })
})

async function seedProjectionFixture() {
  await db.insert(user).values([
    {id: 'user-1', name: 'Test User', email: 'test@example.com', emailVerified: true, image: null, createdAt: now, updatedAt: now},
    {id: 'user-2', name: 'Other User', email: 'other@example.com', emailVerified: true, image: null, createdAt: now, updatedAt: now},
  ])
  await db.insert(teams).values([
    {id: 'team-1', name: 'Team', personalOwnerUserId: 'user-1', createdAt: now, updatedAt: now},
    {id: 'team-2', name: 'Other Team', personalOwnerUserId: 'user-2', createdAt: now, updatedAt: now},
  ])
  await db.insert(teamMembers).values([
    {id: 'member-1', teamId: 'team-1', userId: 'user-1', role: 'owner', createdAt: now, updatedAt: now},
    {id: 'member-2', teamId: 'team-2', userId: 'user-2', role: 'owner', createdAt: now, updatedAt: now},
  ])
  await db.insert(ledgerAccountGroups).values([
    {id: 'group-1', teamId: 'team-1', systemKey: null, name: 'Accounts', sortOrder: 0, createdAt: now, updatedAt: now},
    {id: 'group-2', teamId: 'team-2', systemKey: null, name: 'Accounts', sortOrder: 0, createdAt: now, updatedAt: now},
  ])
  await db.insert(bankAccounts).values([
    bankAccount('bank-account-1', 'team-1', 'Checking'),
    bankAccount('bank-account-2', 'team-2', 'Other Checking'),
  ])
  await db.insert(ledgerAccounts).values([
    ledgerAccount('bank-ledger-account-1', 'team-1', 'bank', 'Checking', {linkedBankAccountId: 'bank-account-1'}),
    ledgerAccount('groceries', 'team-1', 'expense', 'Groceries'),
    ledgerAccount('bank-ledger-account-2', 'team-2', 'bank', 'Other Checking', {linkedBankAccountId: 'bank-account-2', groupId: 'group-2'}),
  ])
  await db.insert(bankTransactions).values([
    bankTransaction('bank-transaction-1', 'bank-account-1', 'Supermarket purchase', 'Supermarket', 7),
    bankTransaction('bank-transaction-2', 'bank-account-2', 'Other team purchase', 'Other merchant', 3),
  ])
}

function bankAccount(id: string, teamId: string, name: string) {
  return {
    id,
    teamId,
    bankConnectionId: null,
    provider: 'gocardless',
    providerInstitutionId: `institution-${id}`,
    providerRequisitionId: `requisition-${id}`,
    providerAccountId: `provider-${id}`,
    name,
    iban: null,
    currency: 'DKK',
    status: 'linked',
    syncStatus: 'idle',
    syncError: null,
    syncStartedAt: null,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function ledgerAccount(
  id: string,
  teamId: string,
  type: string,
  name: string,
  options: {linkedBankAccountId?: string | null; groupId?: string} = {},
) {
  return {
    id,
    teamId,
    groupId: options.groupId ?? 'group-1',
    linkedBankAccountId: options.linkedBankAccountId ?? null,
    systemKey: null,
    type,
    normalBalance: type === 'bank' ? 'debit' : 'credit',
    name,
    description: '',
    status: 'active',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function bankTransaction(id: string, bankAccountId: string, description: string, counterpartyName: string, categorizationRevision: number) {
  return {
    id,
    bankAccountId,
    providerTransactionId: `provider-${id}`,
    status: 'booked',
    bookingDate: '2026-06-25',
    valueDate: null,
    amount: -1_000_000,
    currency: 'DKK',
    description,
    counterpartyName,
    raw: {secretProviderPayload: true},
    aiConfidence: null,
    aiProcessingStartedAt: null,
    aiReasoning: null,
    categorizationRevision,
    createdAt: now,
    updatedAt: now,
  }
}
